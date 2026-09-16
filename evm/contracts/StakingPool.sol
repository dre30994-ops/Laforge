// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StakingMath} from "./StakingMath.sol";

/// @title StakingPool
/// @notice Liquidity-bootstrap staking farm (1..30 days) for a single ERC-20
///         token, a faithful EVM port of the Solana/Anchor `staking` program.
///
/// One pool per token, deployed by `StakingFactory`. The pool contract itself
/// custodies all tokens; two internal accounting balances
/// (`stakeVaultBalance`, `rewardVaultBalance`) replace the two Solana vault PDAs.
///
/// # Behavior
/// * Ramped 1.0x -> 2.0x emissions over the first day, plateau to end.
/// * Per-user tenure weighting 1.0x -> 2.0x over 72 hourly steps (3 days).
/// * Stake-weighted deposit timestamp (anti-gaming dilution).
/// * O(1) accrual via checkpoint history and cohort maturity buckets.
/// * Configurable per-pool stake and unstake taxes (each <= 10%), taken from
///   principal and routed to a launcher-selected treasury via pull-payment.
///   Compounding pays no tax.
/// * One-time funding at creation (factory-only `initializeFunded`).
/// * Permissionless crank. User actions auto-crank first so a stale pool
///   cannot trap exits. `stake`/`compound` require the program still be running;
///   `unstake`/`claim` remain available after the pool has been cranked to end.
/// * Pause, bounded min-stake adjustment, two-party authority transfer.
contract StakingPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant MAX_TAX_BPS = 1_000;
    uint256 public constant MAX_MIN_STAKE_MULTIPLIER = 10;
    uint256 public constant UNALLOCATED_GRACE_SECONDS = 7 * 24 * 60 * 60;
    uint256 private constant MAX_SYNC_CHUNKS = 8;

    IERC20 public immutable token;
    address public immutable factory;
    address public immutable operator;
    address public immutable treasury;
    uint8 public immutable decimals;
    uint8 public immutable tier;
    uint256 public immutable durationDays;
    uint256 public immutable stakeTaxBps;
    uint256 public immutable unstakeTaxBps;
    uint256 public immutable initialMinStake;

    address public authority;
    address public pendingAuthority;

    bool public started;
    bool public paused;
    bool public remainderSwept;

    uint256 public startTs;
    uint256 public endTs;
    uint256 public lastUpdateTs;
    uint256 public nextBoundaryIndex;

    uint256 public minStake;
    uint256 public fundedAmount;
    uint256 public baseRatePerPeriod;

    uint256 public stakeVaultBalance;
    uint256 public rewardVaultBalance;
    uint256 public owedToTreasury;

    uint256 public totalStaked;
    uint256 public totalWeight;
    uint256 public rampingStake;
    uint256 public accRewardPerWeight;
    uint256 public sumAccAtBoundaries;

    uint256 public totalEmitted;
    uint256 public totalClaimed;
    uint256 public unallocated;

    struct Checkpoint {
        uint256 acc;
        uint256 sumAcc;
    }

    mapping(uint256 => Checkpoint) public checkpoints;
    mapping(uint256 => uint256) public maturing;

    struct Position {
        uint256 amount;
        uint256 weightedDepositTs;
        uint256 depositBoundaryIndex;
        uint256 snapshotK;
        uint256 accSnapshot;
        uint256 sumAccSnapshot;
        uint256 pendingRewards;
        uint256 totalClaimed;
        uint256 maturingIndex;
        bool exists;
    }

    mapping(address => Position) public positions;

    event PoolStarted(uint256 baseRate, uint256 startTs, uint256 endTs, uint256 funded);
    event Cranked(uint256 toBoundary, uint256 stepsTaken);
    event Staked(address indexed user, uint256 amount, uint256 newAmount);
    event Unstaked(address indexed user, uint256 amount, uint256 userAmount, uint256 tax);
    event Claimed(address indexed user, uint256 amount);
    event Compounded(address indexed user, uint256 amount, uint256 newAmount);
    event PausedSet(bool paused);
    event MinStakeSet(uint256 minStake);
    event AuthorityTransferStarted(address indexed from, address indexed to);
    event AuthorityTransferred(address indexed from, address indexed to);
    event UnallocatedWithdrawn(uint256 amount, uint256 remaining);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);

    error Overflow();
    error BelowMinimumStake();
    error PoolStale();
    error Paused();
    error NotStarted();
    error WithdrawTooEarly();
    error InsufficientUnallocated();
    error AlreadyStarted();
    error Unauthorized();
    error OnlyFactory();
    error NotTreasury();
    error NothingToWithdraw();
    error ZeroAmount();
    error InexactTransfer();
    error ProgramEnded();
    error MinStakeTooHigh();
    error RemainingStake();
    error ZeroRate();

    constructor(
        IERC20 token_,
        address authority_,
        address operator_,
        address treasury_,
        uint8 decimals_,
        uint256 durationDays_,
        uint256 stakeTaxBps_,
        uint256 unstakeTaxBps_,
        uint256 minStake_,
        uint8 tier_
    ) {
        require(address(token_) != address(0), "token=0");
        require(authority_ != address(0), "authority=0");
        require(operator_ != address(0), "operator=0");
        require(minStake_ > 0, "minStake=0");
        require(
            durationDays_ >= StakingMath.MIN_DURATION_DAYS
                && durationDays_ <= StakingMath.MAX_DURATION_DAYS,
            "duration 1..30"
        );
        require(stakeTaxBps_ <= MAX_TAX_BPS && unstakeTaxBps_ <= MAX_TAX_BPS, "tax>max");
        require(
            treasury_ != address(0) || (stakeTaxBps_ == 0 && unstakeTaxBps_ == 0),
            "tax w/o treasury"
        );

        token = token_;
        factory = msg.sender;
        authority = authority_;
        operator = operator_;
        treasury = treasury_;
        decimals = decimals_;
        tier = tier_;
        durationDays = durationDays_;
        stakeTaxBps = stakeTaxBps_;
        unstakeTaxBps = unstakeTaxBps_;
        minStake = minStake_;
        initialMinStake = minStake_;

        nextBoundaryIndex = 1;
    }

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized();
        _;
    }

    function _pullExact(address from, uint256 amount) internal {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        uint256 delta = token.balanceOf(address(this)) - before;
        if (delta != amount) revert InexactTransfer();
    }

    function _satSub(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    function initializeFunded(uint256 amount) external nonReentrant {
        if (msg.sender != factory) revert OnlyFactory();
        if (started) revert AlreadyStarted();
        if (amount == 0) revert ZeroAmount();

        uint256 bal = token.balanceOf(address(this));
        if (bal < amount) revert InexactTransfer();

        rewardVaultBalance = amount;
        fundedAmount = amount;

        baseRatePerPeriod = StakingMath.deriveBaseRateForDuration(amount, durationDays);
        if (baseRatePerPeriod == 0) revert ZeroRate();

        startTs = block.timestamp;
        endTs = block.timestamp + durationDays * StakingMath.SECONDS_PER_DAY;
        lastUpdateTs = block.timestamp;
        started = true;

        emit PoolStarted(baseRatePerPeriod, startTs, endTs, amount);
    }

    function crank(uint256 maxSteps) external nonReentrant {
        _crank(maxSteps);
    }

    function _crank(uint256 maxSteps) internal {
        if (!started) revert NotStarted();

        uint256 effectiveNow = block.timestamp < endTs ? block.timestamp : endTs;
        uint256 elapsed = effectiveNow > startTs ? effectiveNow - startTs : 0;
        uint256 targetBoundary = elapsed / StakingMath.TENURE_STEP_SECONDS;

        uint256 steps = maxSteps == 0 ? StakingMath.DEFAULT_MAX_CRANK_STEPS : maxSteps;

        uint256 stepsTaken;
        uint256 baseRate = baseRatePerPeriod;

        while (nextBoundaryIndex <= targetBoundary && stepsTaken < steps) {
            uint256 n = nextBoundaryIndex;

            uint256 hoursPerEmissionStep =
                StakingMath.EMISSION_STEP_SECONDS / StakingMath.TENURE_STEP_SECONDS;
            uint256 emissionStep = (n - 1) / hoursPerEmissionStep;
            if (emissionStep > StakingMath.EMISSION_RAMP_STEPS) {
                emissionStep = StakingMath.EMISSION_RAMP_STEPS;
            }
            uint256 multNumerator = StakingMath.emissionMultNumerator(emissionStep);
            uint256 emission =
                (baseRate * StakingMath.PERIODS_PER_TENURE_STEP * multNumerator) / StakingMath.MULT_DENOM;

            totalEmitted += emission;

            if (totalWeight > 0) {
                accRewardPerWeight += (emission * StakingMath.ACC_SCALE) / totalWeight;
            } else {
                unallocated += emission;
            }

            sumAccAtBoundaries += accRewardPerWeight;

            if (n < StakingMath.CHECKPOINT_CAPACITY) {
                checkpoints[n] = Checkpoint({acc: accRewardPerWeight, sumAcc: sumAccAtBoundaries});
            }

            totalWeight += rampingStake;

            if (n < StakingMath.MATURING_CAPACITY) {
                uint256 graduating = maturing[n];
                if (graduating > 0) {
                    rampingStake = _satSub(rampingStake, graduating);
                    maturing[n] = 0;
                }
            }

            nextBoundaryIndex = n + 1;
            stepsTaken++;
        }

        uint256 crankedTo = startTs + nextBoundaryIndex * StakingMath.TENURE_STEP_SECONDS;
        lastUpdateTs = crankedTo < effectiveNow ? crankedTo : effectiveNow;

        if (!remainderSwept && lastUpdateTs >= endTs) {
            uint256 remainder = fundedAmount > totalEmitted ? fundedAmount - totalEmitted : 0;
            if (remainder > 0) {
                unallocated += remainder;
            }
            remainderSwept = true;
        }

        emit Cranked(nextBoundaryIndex, stepsTaken);
    }

    function _sync() internal {
        if (!started) revert NotStarted();
        uint256 i;
        while (i < MAX_SYNC_CHUNKS) {
            if (lastUpdateTs >= endTs) break;
            if (block.timestamp - lastUpdateTs < StakingMath.TENURE_STEP_SECONDS) break;
            uint256 before = nextBoundaryIndex;
            _crank(StakingMath.DEFAULT_MAX_CRANK_STEPS);
            if (nextBoundaryIndex == before) break;
            unchecked {
                ++i;
            }
        }
    }

    function _requireFresh() internal view {
        if (block.timestamp - lastUpdateTs >= StakingMath.TENURE_STEP_SECONDS) revert PoolStale();
    }

    function _requireFreshOrEnded() internal view {
        if (
            block.timestamp - lastUpdateTs >= StakingMath.TENURE_STEP_SECONDS
                && lastUpdateTs < endTs
        ) revert PoolStale();
    }

    function _unregisterMaturing(Position storage pos, uint256 amount) internal {
        uint256 idx = pos.maturingIndex;
        pos.maturingIndex = 0;
        if (idx == 0 || amount == 0) return;
        uint256 bucket = maturing[idx];
        maturing[idx] = bucket > amount ? bucket - amount : 0;
    }

    function _registerMaturing(Position storage pos, uint256 amount, uint256 k) internal {
        pos.maturingIndex = 0;
        if (amount == 0 || k >= StakingMath.TENURE_RAMP_STEPS) return;
        uint256 currentBoundary = nextBoundaryIndex - 1;
        uint256 maturityIdx = currentBoundary + (StakingMath.TENURE_RAMP_STEPS - k);
        if (maturityIdx != 0 && maturityIdx < StakingMath.MATURING_CAPACITY) {
            maturing[maturityIdx] += amount;
            pos.maturingIndex = maturityIdx;
        }
    }

    function stake(uint256 amount) external nonReentrant {
        _sync();
        if (block.timestamp >= endTs) revert ProgramEnded();
        _requireFresh();
        if (paused) revert Paused();

        Position storage pos = positions[msg.sender];
        if (!pos.exists) {
            pos.exists = true;
        }

        uint256 nowTs = lastUpdateTs;
        uint256 oldAmount = pos.amount;

        if (oldAmount > 0) {
            pos.pendingRewards += _computePending(pos);

            uint256 oldK = _tenureSteps(pos, nowTs);
            totalWeight -= oldAmount * StakingMath.weightNumerator(oldK);
            if (oldK < StakingMath.TENURE_RAMP_STEPS) {
                rampingStake = _satSub(rampingStake, oldAmount);
            }
            _unregisterMaturing(pos, oldAmount);
        }

        if (amount == 0) revert ZeroAmount();
        _pullExact(msg.sender, amount);

        uint256 stakeTax = (amount * stakeTaxBps) / BPS_DENOM;
        uint256 delta = amount - stakeTax;

        stakeVaultBalance += delta;
        if (stakeTax > 0) {
            owedToTreasury += stakeTax;
        }

        pos.weightedDepositTs =
            StakingMath.weightedDepositTs(oldAmount, pos.weightedDepositTs, delta, nowTs);

        uint256 newAmount = pos.amount + delta;
        pos.amount = newAmount;

        if (newAmount < minStake) revert BelowMinimumStake();

        uint256 newK = _tenureSteps(pos, nowTs);
        totalWeight += newAmount * StakingMath.weightNumerator(newK);
        totalStaked += delta;

        if (newK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake += newAmount;
            _registerMaturing(pos, newAmount, newK);
        }

        pos.depositBoundaryIndex = _tenureBoundaryIndex(pos);
        pos.snapshotK = newK;
        pos.accSnapshot = accRewardPerWeight;
        pos.sumAccSnapshot = _snapshotSumAcc(pos.depositBoundaryIndex, newK);

        emit Staked(msg.sender, delta, newAmount);
    }

    function unstake(uint256 amount) external nonReentrant {
        _sync();
        _requireFreshOrEnded();

        Position storage pos = positions[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > pos.amount) revert Overflow();

        uint256 nowTs = lastUpdateTs;

        pos.pendingRewards += _computePending(pos);

        uint256 oldAmount = pos.amount;
        uint256 oldK = _tenureSteps(pos, nowTs);
        totalWeight -= oldAmount * StakingMath.weightNumerator(oldK);
        if (oldK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake = _satSub(rampingStake, oldAmount);
        }
        _unregisterMaturing(pos, oldAmount);

        uint256 newAmount = pos.amount - amount;
        pos.amount = newAmount;
        totalStaked -= amount;

        pos.weightedDepositTs = nowTs;

        uint256 tax = (amount * unstakeTaxBps) / BPS_DENOM;
        uint256 userAmount = amount - tax;

        stakeVaultBalance -= amount;

        if (tax > 0) {
            owedToTreasury += tax;
        }
        if (userAmount > 0) {
            token.safeTransfer(msg.sender, userAmount);
        }

        if (newAmount > 0) {
            totalWeight += newAmount * StakingMath.weightNumerator(0);
            rampingStake += newAmount;
            _registerMaturing(pos, newAmount, 0);
        }

        pos.snapshotK = 0;
        pos.depositBoundaryIndex = nextBoundaryIndex - 1;
        pos.accSnapshot = accRewardPerWeight;
        pos.sumAccSnapshot = _snapshotSumAcc(pos.depositBoundaryIndex, 0);

        emit Unstaked(msg.sender, amount, userAmount, tax);
    }

    function claim() external nonReentrant {
        _sync();
        _requireFreshOrEnded();

        Position storage pos = positions[msg.sender];

        pos.pendingRewards += _computePending(pos);

        uint256 kNow = _tenureSteps(pos, lastUpdateTs);
        pos.snapshotK = kNow;
        pos.accSnapshot = accRewardPerWeight;
        pos.sumAccSnapshot = _snapshotSumAcc(pos.depositBoundaryIndex, kNow);

        uint256 payout = pos.pendingRewards;
        if (payout == 0) {
            return;
        }

        pos.pendingRewards = 0;
        pos.totalClaimed += payout;
        totalClaimed += payout;
        rewardVaultBalance -= payout;

        token.safeTransfer(msg.sender, payout);

        emit Claimed(msg.sender, payout);
    }

    function compound() external nonReentrant {
        _sync();
        if (block.timestamp >= endTs) revert ProgramEnded();
        _requireFresh();
        if (paused) revert Paused();

        Position storage pos = positions[msg.sender];
        uint256 nowTs = lastUpdateTs;

        pos.pendingRewards += _computePending(pos);

        uint256 compoundAmount = pos.pendingRewards;
        if (compoundAmount == 0) {
            uint256 k = _tenureSteps(pos, nowTs);
            pos.snapshotK = k;
            pos.accSnapshot = accRewardPerWeight;
            pos.sumAccSnapshot = _snapshotSumAcc(pos.depositBoundaryIndex, k);
            return;
        }

        uint256 oldAmount = pos.amount;
        uint256 oldK = _tenureSteps(pos, nowTs);
        totalWeight -= oldAmount * StakingMath.weightNumerator(oldK);
        if (oldK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake = _satSub(rampingStake, oldAmount);
        }
        _unregisterMaturing(pos, oldAmount);

        rewardVaultBalance -= compoundAmount;
        stakeVaultBalance += compoundAmount;

        pos.pendingRewards = 0;
        uint256 newAmount = pos.amount + compoundAmount;

        pos.weightedDepositTs =
            StakingMath.weightedDepositTs(oldAmount, pos.weightedDepositTs, compoundAmount, nowTs);
        pos.amount = newAmount;

        pos.totalClaimed += compoundAmount;
        totalClaimed += compoundAmount;
        totalStaked += compoundAmount;

        uint256 newK = _tenureSteps(pos, nowTs);
        totalWeight += newAmount * StakingMath.weightNumerator(newK);
        if (newK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake += newAmount;
            _registerMaturing(pos, newAmount, newK);
        }

        pos.depositBoundaryIndex = _tenureBoundaryIndex(pos);
        pos.snapshotK = newK;
        pos.accSnapshot = accRewardPerWeight;
        pos.sumAccSnapshot = _snapshotSumAcc(pos.depositBoundaryIndex, newK);

        emit Compounded(msg.sender, compoundAmount, newAmount);
    }

    function withdrawTreasury() external nonReentrant {
        if (treasury == address(0)) revert NotTreasury();
        uint256 amount = owedToTreasury;
        if (amount == 0) revert NothingToWithdraw();

        owedToTreasury = 0;
        token.safeTransfer(treasury, amount);

        emit TreasuryWithdrawn(treasury, amount);
    }

    function setPaused(bool paused_) external onlyAuthority {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setMinStake(uint256 minStake_) external onlyAuthority {
        if (minStake_ == 0) revert ZeroAmount();
        if (minStake_ > initialMinStake * MAX_MIN_STAKE_MULTIPLIER) revert MinStakeTooHigh();
        minStake = minStake_;
        emit MinStakeSet(minStake_);
    }

    function transferAuthority(address newAuthority) external onlyAuthority {
        require(newAuthority != address(0), "newAuthority=0");
        pendingAuthority = newAuthority;
        emit AuthorityTransferStarted(authority, newAuthority);
    }

    function acceptAuthority() external {
        if (msg.sender != pendingAuthority) revert Unauthorized();
        address old = authority;
        authority = pendingAuthority;
        pendingAuthority = address(0);
        emit AuthorityTransferred(old, authority);
    }

    function withdrawUnallocated(uint256 amount) external onlyAuthority nonReentrant {
        if (!started) revert NotStarted();
        uint256 gate = endTs + UNALLOCATED_GRACE_SECONDS;
        if (block.timestamp <= gate) revert WithdrawTooEarly();
        if (totalStaked != 0) revert RemainingStake();
        if (amount > unallocated) revert InsufficientUnallocated();

        unallocated -= amount;
        rewardVaultBalance -= amount;
        token.safeTransfer(authority, amount);

        emit UnallocatedWithdrawn(amount, unallocated);
    }

    function pendingRewards(address user) external view returns (uint256) {
        Position storage pos = positions[user];
        return pos.pendingRewards + _computePending(pos);
    }

    function averageMultBps() external view returns (uint256) {
        if (totalStaked == 0) return 0;
        return (totalWeight * StakingMath.BPS) / (totalStaked * StakingMath.TENURE_RAMP_STEPS);
    }

    function _tenureSteps(Position storage pos, uint256 nowTs) internal view returns (uint256) {
        if (pos.amount == 0) return 0;
        uint256 elapsed = nowTs > pos.weightedDepositTs ? nowTs - pos.weightedDepositTs : 0;
        uint256 steps = elapsed / StakingMath.TENURE_STEP_SECONDS;
        return steps > StakingMath.TENURE_RAMP_STEPS ? StakingMath.TENURE_RAMP_STEPS : steps;
    }

    function _tenureBoundaryIndex(Position storage pos) internal view returns (uint256) {
        uint256 offset = pos.weightedDepositTs > startTs ? pos.weightedDepositTs - startTs : 0;
        return offset / StakingMath.TENURE_STEP_SECONDS;
    }

    function _snapshotSumAcc(uint256 depositBoundaryIndex, uint256 k) internal view returns (uint256) {
        uint256 gIdx = depositBoundaryIndex + StakingMath.cappedSteps(k);
        if (gIdx < StakingMath.CHECKPOINT_CAPACITY && gIdx < nextBoundaryIndex) {
            return checkpoints[gIdx].sumAcc;
        }
        return sumAccAtBoundaries;
    }

    function _computePending(Position storage pos) internal view returns (uint256) {
        if (pos.amount == 0) return 0;

        uint256 stakeAmt = pos.amount;

        uint256 elapsed =
            lastUpdateTs > pos.weightedDepositTs ? lastUpdateTs - pos.weightedDepositTs : 0;
        uint256 kNow = elapsed / StakingMath.TENURE_STEP_SECONDS;
        if (kNow > StakingMath.TENURE_RAMP_STEPS) kNow = StakingMath.TENURE_RAMP_STEPS;

        StakingMath.Snapshot memory snap = StakingMath.Snapshot({
            acc: pos.accSnapshot,
            sumAcc: pos.sumAccSnapshot,
            k: pos.snapshotK
        });

        uint256 gIdx = pos.depositBoundaryIndex + StakingMath.cappedSteps(kNow);
        uint256 gK;
        if (gIdx < StakingMath.CHECKPOINT_CAPACITY && gIdx < nextBoundaryIndex) {
            gK = checkpoints[gIdx].sumAcc;
        } else {
            gK = sumAccAtBoundaries;
        }

        return StakingMath.accrual(stakeAmt, snap, kNow, accRewardPerWeight, gK);
    }
}