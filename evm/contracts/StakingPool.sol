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
/// * Transfer-fee tokens are allowed up to 10% on the way in. The pool credits
///   and funds only the tokens that arrived. On the way out the pool's balance
///   must fall by exactly the amount sent — the recipient bears a normal fee,
///   and a token that skims extra from the pool is rejected.
/// * Permissionless crank. User actions auto-crank first so a stale pool
///   cannot trap exits. `stake`/`compound` require the program still be running;
///   `unstake`/`claim` remain available after the pool has been cranked to end.
/// * Pause, bounded min-stake adjustment, two-party authority transfer.
contract StakingPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant MAX_TAX_BPS = 1_000;
    /// Largest burn/redirect a token may take on the way in. 10%.
    /// Applied to the amount that actually arrives, separate from stake/unstake tax.
    uint256 public constant MAX_TRANSFER_FEE_BPS = 1_000;
    /// Authority may raise min-stake up to 10x the value set at creation.
    uint256 public constant MAX_MIN_STAKE_MULTIPLIER = 10;
    /// Fixed grace period after `endTs` before unallocated recovery: 7 days.
    uint256 public constant UNALLOCATED_GRACE_SECONDS = 7 * 24 * 60 * 60;
    /// Max crank chunks per `_sync` (8 * 250 = 2000 > 720 hourly steps of a 30d pool).
    uint256 private constant MAX_SYNC_CHUNKS = 8;
    /// Launchpad payouts tracked at once. Bounds the checkpoint loop on stake.
    uint256 public constant MAX_HOLDER_REWARDS = 8;

    // -------------------------------------------------------------------------
    // Immutable configuration
    // -------------------------------------------------------------------------

    IERC20 public immutable token;
    address public immutable factory;
    address public immutable operator;
    address public immutable treasury;
    uint8 public immutable decimals;
    uint8 public immutable tier;
    uint256 public immutable durationDays;
    uint256 public immutable stakeTaxBps;
    uint256 public immutable unstakeTaxBps;
    /// Min-stake at construction; caps later `setMinStake` increases.
    uint256 public immutable initialMinStake;

    // -------------------------------------------------------------------------
    // Admin / lifecycle
    // -------------------------------------------------------------------------

    address public authority;
    address public pendingAuthority;

    bool public started;
    bool public paused;
    /// True once `fundedAmount - totalEmitted` has been folded into `unallocated`.
    bool public remainderSwept;

    // -------------------------------------------------------------------------
    // Timing
    // -------------------------------------------------------------------------

    uint256 public startTs;
    uint256 public endTs;
    uint256 public lastUpdateTs;
    uint256 public nextBoundaryIndex; // starts at 1; boundary 0 is (0,0)

    // -------------------------------------------------------------------------
    // Funding & rate
    // -------------------------------------------------------------------------

    uint256 public minStake;
    uint256 public fundedAmount;
    uint256 public baseRatePerPeriod;

    // -------------------------------------------------------------------------
    // Vault accounting
    // -------------------------------------------------------------------------

    uint256 public stakeVaultBalance;
    uint256 public rewardVaultBalance;
    /// Taxes accrued to the treasury (pull-payment). Never part of the vaults.
    uint256 public owedToTreasury;

    // -------------------------------------------------------------------------
    // Aggregate state
    // -------------------------------------------------------------------------

    uint256 public totalStaked;
    uint256 public totalWeight;
    uint256 public rampingStake;
    uint256 public accRewardPerWeight;
    uint256 public sumAccAtBoundaries;

    uint256 public totalEmitted;
    uint256 public totalClaimed;
    uint256 public unallocated;

    // -------------------------------------------------------------------------
    // Schedule
    // -------------------------------------------------------------------------

    struct Checkpoint {
        uint256 acc; // A_n
        uint256 sumAcc; // G_n
    }

    mapping(uint256 => Checkpoint) public checkpoints;
    /// maturing[n] = stake amount that hits the 72-step cap at boundary n.
    mapping(uint256 => uint256) public maturing;

    // -------------------------------------------------------------------------
    // Positions
    // -------------------------------------------------------------------------

    struct Position {
        uint256 amount;
        uint256 weightedDepositTs;
        uint256 depositBoundaryIndex;
        uint256 snapshotK;
        uint256 accSnapshot;
        uint256 sumAccSnapshot;
        uint256 pendingRewards;
        uint256 totalClaimed;
        /// Cohort bucket this position is registered in, or 0 if not ramping.
        /// Bucket 0 is never written (maturityIdx is always >= 1 for ramping
        /// positions), so 0 is a safe "unregistered" sentinel.
        uint256 maturingIndex;
        bool exists;
    }

    mapping(address => Position) public positions;

    struct HolderReward {
        uint256 accPerStake;
        uint256 accounted;
        bool registered;
    }

    /// Launchpad payouts that landed on this pool, split by raw stake.
    mapping(address => HolderReward) public holderRewards;
    address[] public holderRewardTokens;
    mapping(address => mapping(address => uint256)) public holderDebt;
    mapping(address => mapping(address => uint256)) public holderPending;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

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
    event HolderRewardAdded(address indexed rewardToken);
    event HolderRewardClaimed(address indexed user, address indexed rewardToken, uint256 amount);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

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
    error TransferFeeTooHigh();
    error TooManyHolderRewards();
    error ProgramEnded();
    error MinStakeTooHigh();
    error RemainingStake();
    error ZeroRate();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized();
        _;
    }

    /// Pull `amount` from `from`. Credits the caller the amount that actually
    /// arrived. A token may take at most `MAX_TRANSFER_FEE_BPS` (10%). Anything
    /// above that reverts. A token that delivers *more* than `amount` (mint-on-
    /// transfer, reflection onto an existing balance) also reverts — the pool
    /// would otherwise book rewards it does not hold, or book a surplus it
    /// cannot attribute.
    function _pull(address from, uint256 amount) internal returns (uint256 received) {
        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        received = token.balanceOf(address(this)) - beforeBal;
        if (received > amount) revert InexactTransfer();
        uint256 minReceived = amount - (amount * MAX_TRANSFER_FEE_BPS) / BPS_DENOM;
        if (received < minReceived) revert TransferFeeTooHigh();
    }

    /// Send `amount`. Two checks:
    /// * the pool's balance falls by exactly `amount` (a token that debits the
    ///   sender for more would skim other stakers);
    /// * the recipient's balance rises by at least 90% of `amount` (the transfer
    ///   fee they actually eat is capped at 10%).
    /// A contract recipient that forwards the tokens out inside the transfer
    /// will fail the second check — treasuries must be able to hold the token.
    function _push(address to, uint256 amount) internal {
        uint256 poolBefore = token.balanceOf(address(this));
        uint256 toBefore = token.balanceOf(to);
        token.safeTransfer(to, amount);
        uint256 spent = poolBefore - token.balanceOf(address(this));
        if (spent != amount) revert InexactTransfer();
        uint256 got = token.balanceOf(to) - toBefore;
        uint256 minGot = amount - (amount * MAX_TRANSFER_FEE_BPS) / BPS_DENOM;
        if (got < minGot) revert TransferFeeTooHigh();
    }

    function _satSub(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    // -------------------------------------------------------------------------
    // initializeFunded (factory-only, one-time)
    // -------------------------------------------------------------------------

    function initializeFunded(uint256 amount) external nonReentrant {
        if (msg.sender != factory) revert OnlyFactory();
        if (started) revert AlreadyStarted();
        if (amount == 0) revert ZeroAmount();

        // Account the tokens that actually arrived, capped at `amount`.
        // A pre-existing donation above `amount` stays unaccounted (same as
        // before) so it cannot inflate the emission schedule. A shortfall
        // within the 10% transfer-fee cap is what gets funded — never the
        // nominal amount, which the token already burned.
        uint256 bal = token.balanceOf(address(this));
        uint256 minBal = amount - (amount * MAX_TRANSFER_FEE_BPS) / BPS_DENOM;
        if (bal < minBal) revert TransferFeeTooHigh();
        uint256 funded = bal < amount ? bal : amount;

        rewardVaultBalance = funded;
        fundedAmount = funded;

        baseRatePerPeriod = StakingMath.deriveBaseRateForDuration(funded, durationDays);
        if (baseRatePerPeriod == 0) revert ZeroRate();

        startTs = block.timestamp;
        endTs = block.timestamp + durationDays * StakingMath.SECONDS_PER_DAY;
        lastUpdateTs = block.timestamp;
        started = true;

        emit PoolStarted(baseRatePerPeriod, startTs, endTs, funded);
    }

    // -------------------------------------------------------------------------
    // crank (permissionless, resumable)
    // -------------------------------------------------------------------------

    /// Walk hourly boundaries up to `now` (capped at end). `maxSteps == 0` uses
    /// the default. Chain calls for catch-up; user actions also auto-crank.
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

            // Segment ending at boundary `n` is paid at the weight in force
            // during it (established at n-1). Ramping positions gain their next
            // step only AFTER this boundary's emission is distributed.

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
                    // Saturating: a ghost bucket must not halt the whole pool.
                    rampingStake = _satSub(rampingStake, graduating);
                    maturing[n] = 0;
                }
            }

            nextBoundaryIndex = n + 1;
            stepsTaken++;
        }

        uint256 crankedTo = startTs + nextBoundaryIndex * StakingMath.TENURE_STEP_SECONDS;
        lastUpdateTs = crankedTo < effectiveNow ? crankedTo : effectiveNow;

        // Fold never-scheduled floor leftover (`funded % denom`) into unallocated
        // once the program has been fully cranked to end, so the authority can
        // recover it after the grace period.
        if (!remainderSwept && lastUpdateTs >= endTs) {
            uint256 remainder = fundedAmount > totalEmitted ? fundedAmount - totalEmitted : 0;
            if (remainder > 0) {
                unallocated += remainder;
            }
            remainderSwept = true;
        }

        emit Cranked(nextBoundaryIndex, stepsTaken);
    }

    /// Catch crank up to now / endTs. A neglected 30-day pool is 720 steps;
    /// 8 chunks of 250 covers it in one user transaction.
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

    // -------------------------------------------------------------------------
    // Cohort registration (C-1)
    // -------------------------------------------------------------------------

    /// Remove `amount` from the position's recorded maturing bucket. No-ops if
    /// the position is unregistered or crank already zeroed the bucket.
    function _unregisterMaturing(Position storage pos, uint256 amount) internal {
        uint256 idx = pos.maturingIndex;
        pos.maturingIndex = 0;
        if (idx == 0 || amount == 0) return;
        uint256 bucket = maturing[idx];
        maturing[idx] = bucket > amount ? bucket - amount : 0;
    }

    /// Register `amount` in the cohort that graduates in `(72 - k)` hours.
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

    // -------------------------------------------------------------------------
    // stake
    // -------------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant {
        _sync();
        if (block.timestamp >= endTs) revert ProgramEnded();
        _requireFresh();
        if (paused) revert Paused();

        Position storage pos = positions[msg.sender];
        if (!pos.exists) {
            pos.exists = true;
        }

        // Use crank time so personal k matches global weight (H-1).
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
        uint256 received = _pull(msg.sender, amount);

        uint256 stakeTax = (received * stakeTaxBps) / BPS_DENOM;
        uint256 delta = received - stakeTax;

        stakeVaultBalance += delta;
        if (stakeTax > 0) {
            owedToTreasury += stakeTax;
        }

        pos.weightedDepositTs =
            StakingMath.weightedDepositTs(oldAmount, pos.weightedDepositTs, delta, nowTs);

        uint256 newAmount = pos.amount + delta;
        _settleHolder(msg.sender);
        pos.amount = newAmount;

        if (newAmount < minStake) revert BelowMinimumStake();

        uint256 newK = _tenureSteps(pos, nowTs);
        totalWeight += newAmount * StakingMath.weightNumerator(newK);
        totalStaked += delta;
        _lockHolderDebt(msg.sender);

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

    // -------------------------------------------------------------------------
    // unstake
    // -------------------------------------------------------------------------

    /// Unstake (partial or full). Always allowed, even while paused. Full tenure
    /// reset. Tax is `unstakeTaxBps` (per-pool, <= 10%), floored favouring the user.
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
        _settleHolder(msg.sender);
        pos.amount = newAmount;
        totalStaked -= amount;
        _lockHolderDebt(msg.sender);

        pos.weightedDepositTs = nowTs;

        uint256 tax = (amount * unstakeTaxBps) / BPS_DENOM;
        uint256 userAmount = amount - tax;

        stakeVaultBalance -= amount;

        if (tax > 0) {
            owedToTreasury += tax;
        }
        if (userAmount > 0) {
            _push(msg.sender, userAmount);
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

    // -------------------------------------------------------------------------
    // claim
    // -------------------------------------------------------------------------

    /// Claim accumulated rewards without touching tenure or principal. Allowed
    /// while paused. Double-claim pays zero.
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

        _push(msg.sender, payout);

        emit Claimed(msg.sender, payout);
    }

    // -------------------------------------------------------------------------
    // compound
    // -------------------------------------------------------------------------

    /// Fold pending rewards into principal. Blocked while paused and after end.
    /// Exempt from min-stake (the position already exists). Untaxed.
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
        _settleHolder(msg.sender);
        pos.amount = newAmount;

        pos.weightedDepositTs =
            StakingMath.weightedDepositTs(oldAmount, pos.weightedDepositTs, compoundAmount, nowTs);

        pos.totalClaimed += compoundAmount;
        totalClaimed += compoundAmount;
        totalStaked += compoundAmount;
        _lockHolderDebt(msg.sender);

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

    function holderRewardTokenCount() external view returns (uint256) {
        return holderRewardTokens.length;
    }

    function addHolderReward(address rewardToken) external onlyAuthority {
        _registerHolder(rewardToken, true);
    }

    function syncHolderReward(address rewardToken) external nonReentrant {
        if (rewardToken == address(0)) revert ZeroAmount();
        _registerHolder(rewardToken, false);
        _accrueHolder(rewardToken);
    }

    function pendingHolderReward(address user, address rewardToken) external view returns (uint256) {
        if (!holderRewards[rewardToken].registered) return 0;
        uint256 acc = holderRewards[rewardToken].accPerStake;
        uint256 accounted = holderRewards[rewardToken].accounted;
        uint256 bal = _holderDistributable(rewardToken);
        if (bal > accounted && totalStaked > 0) {
            acc += ((bal - accounted) * StakingMath.ACC_SCALE) / totalStaked;
        }
        uint256 pending = holderPending[user][rewardToken];
        uint256 amt = positions[user].amount;
        if (amt == 0) return pending;
        uint256 accumulated = (amt * acc) / StakingMath.ACC_SCALE;
        uint256 debt = holderDebt[user][rewardToken];
        if (accumulated > debt) pending += accumulated - debt;
        return pending;
    }

    function claimHolderReward(address rewardToken) external nonReentrant {
        if (!holderRewards[rewardToken].registered) revert ZeroAmount();
        _settleHolder(msg.sender);
        _lockHolderDebt(msg.sender);
        uint256 pay = holderPending[msg.sender][rewardToken];
        if (pay == 0) revert NothingToWithdraw();
        holderPending[msg.sender][rewardToken] = 0;
        HolderReward storage r = holderRewards[rewardToken];
        if (pay > r.accounted) pay = r.accounted;
        r.accounted -= pay;
        _payReward(rewardToken, msg.sender, pay);
        emit HolderRewardClaimed(msg.sender, rewardToken, pay);
    }

    function _registerHolder(address rewardToken, bool force) internal {
        if (rewardToken == address(0)) revert ZeroAmount();
        if (holderRewards[rewardToken].registered) return;
        if (!force && _holderDistributable(rewardToken) == 0) revert ZeroAmount();
        if (holderRewardTokens.length >= MAX_HOLDER_REWARDS) revert TooManyHolderRewards();
        holderRewards[rewardToken].registered = true;
        holderRewardTokens.push(rewardToken);
        emit HolderRewardAdded(rewardToken);
    }

    function _holderDistributable(address rewardToken) internal view returns (uint256) {
        uint256 bal = IERC20(rewardToken).balanceOf(address(this));
        if (rewardToken != address(token)) return bal;
        uint256 reserved = stakeVaultBalance + rewardVaultBalance + owedToTreasury;
        return bal > reserved ? bal - reserved : 0;
    }

    function _accrueHolder(address rewardToken) internal {
        HolderReward storage r = holderRewards[rewardToken];
        if (!r.registered) return;
        uint256 bal = _holderDistributable(rewardToken);
        if (bal <= r.accounted || totalStaked == 0) return;
        r.accPerStake += ((bal - r.accounted) * StakingMath.ACC_SCALE) / totalStaked;
        r.accounted = bal;
    }

    function _settleHolder(address user) internal {
        uint256 n = holderRewardTokens.length;
        if (n == 0) return;
        uint256 amt = positions[user].amount;
        for (uint256 i; i < n; ++i) {
            address rewardToken = holderRewardTokens[i];
            _accrueHolder(rewardToken);
            if (amt == 0) continue;
            uint256 accumulated = (amt * holderRewards[rewardToken].accPerStake) / StakingMath.ACC_SCALE;
            uint256 debt = holderDebt[user][rewardToken];
            if (accumulated > debt) {
                holderPending[user][rewardToken] += accumulated - debt;
            }
        }
    }

    function _lockHolderDebt(address user) internal {
        uint256 n = holderRewardTokens.length;
        if (n == 0) return;
        uint256 amt = positions[user].amount;
        for (uint256 i; i < n; ++i) {
            address rewardToken = holderRewardTokens[i];
            holderDebt[user][rewardToken] =
                (amt * holderRewards[rewardToken].accPerStake) / StakingMath.ACC_SCALE;
        }
    }

    function _payReward(address rewardToken, address to, uint256 amount) internal {
        if (rewardToken == address(token)) {
            _push(to, amount);
            return;
        }
        IERC20 t = IERC20(rewardToken);
        uint256 poolBefore = t.balanceOf(address(this));
        uint256 toBefore = t.balanceOf(to);
        t.safeTransfer(to, amount);
        uint256 spent = poolBefore - t.balanceOf(address(this));
        if (spent != amount) revert InexactTransfer();
        uint256 got = t.balanceOf(to) - toBefore;
        uint256 minGot = amount - (amount * MAX_TRANSFER_FEE_BPS) / BPS_DENOM;
        if (got < minGot) revert TransferFeeTooHigh();
    }

    /// Pay out accrued stake/unstake taxes to the treasury (pull-payment).
    /// Permissionless: destination is the immutable `treasury`.
    function withdrawTreasury() external nonReentrant {
        if (treasury == address(0)) revert NotTreasury();
        uint256 amount = owedToTreasury;
        if (amount == 0) revert NothingToWithdraw();

        owedToTreasury = 0;
        _push(treasury, amount);

        emit TreasuryWithdrawn(treasury, amount);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setPaused(bool paused_) external onlyAuthority {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// Set min-stake. Must be > 0 and no more than 10x the constructor value.
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

    /// Withdraw zero-TVL leftover (+ never-scheduled remainder) after end + grace.
    /// Requires the program to have no remaining staked principal.
    function withdrawUnallocated(uint256 amount) external onlyAuthority nonReentrant {
        if (!started) revert NotStarted();
        uint256 gate = endTs + UNALLOCATED_GRACE_SECONDS;
        if (block.timestamp <= gate) revert WithdrawTooEarly();
        if (totalStaked != 0) revert RemainingStake();
        if (amount > unallocated) revert InsufficientUnallocated();

        unallocated -= amount;
        rewardVaultBalance -= amount;
        _push(authority, amount);

        emit UnallocatedWithdrawn(amount, unallocated);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function pendingRewards(address user) external view returns (uint256) {
        Position storage pos = positions[user];
        return pos.pendingRewards + _computePending(pos);
    }

    function averageMultBps() external view returns (uint256) {
        if (totalStaked == 0) return 0;
        return (totalWeight * StakingMath.BPS) / (totalStaked * StakingMath.TENURE_RAMP_STEPS);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

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
