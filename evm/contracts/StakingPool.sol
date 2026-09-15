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
/// One pool per token, deployed by `StakingFactory` (mirrors the Solana
/// "one PDA pool per mint" model). The pool contract itself custodies all
/// tokens; two internal accounting balances (`stakeVaultBalance`,
/// `rewardVaultBalance`) replace the two Solana vault PDAs so that reserved
/// rewards and leftover (zero-TVL) emission are tracked exactly as in the original.
///
/// # Behavior
/// * Ramped 1.0x -> 2.0x emissions over the first day, plateau to end.
/// * Per-user tenure weighting 1.0x -> 2.0x over 72 hourly steps.
/// * Stake-weighted deposit timestamp (anti-gaming dilution).
/// * O(1) accrual via checkpoint history and cohort maturity buckets.
/// * Configurable per-pool stake and unstake taxes (each <= 10%), taken from
///   principal and routed to a launcher-selected treasury. Zero if no treasury.
///   Compounding pays no tax (it moves already-emitted rewards internally).
/// * One-time funding at creation (factory-only `initializeFunded`): the pool is
///   funded and started atomically. There is NO post-creation top-up and NO
///   sweep — the only ways tokens leave a funded pool are staking emissions
///   (claim/compound), unstaking principal, and the authority's
///   `withdrawUnallocated` of zero-TVL leftovers after end + a fixed grace.
/// * Permissionless crank. `stake`/`compound` require a fresh (recently-cranked)
///   pool; `unstake`/`claim` additionally remain available after the pool has
///   been cranked to end, so stakers can always exit (see `freshOrEnded`).
/// * Pause, min-stake adjustment, two-party authority transfer.
contract StakingPool is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StakingMath for uint256;

    // -------------------------------------------------------------------------
    // Constants (mirror programs/staking/src/lib.rs)
    // -------------------------------------------------------------------------

    /// Basis-point denominator.
    uint256 public constant BPS_DENOM = 10_000;
    /// Maximum tax on each side (stake and unstake): 10%.
    uint256 public constant MAX_TAX_BPS = 1_000;

    // -------------------------------------------------------------------------
    // Immutable configuration
    // -------------------------------------------------------------------------

    /// The staking/reward token (a Pons-launched ERC-20).
    IERC20 public immutable token;
    /// The StakingFactory that deployed this pool; the only caller allowed to
    /// perform the one-time `initializeFunded` (funding + start at creation).
    address public immutable factory;
    /// The launcher (identity only). Funding is one-time at creation; there is
    /// no post-creation reward top-up and no sweep.
    address public immutable operator;
    /// Treasury that receives the stake/unstake taxes. Zero if the pool is
    /// tax-free.
    address public immutable treasury;
    /// Token decimals (informational; matches the Solana `decimals` field).
    uint8 public immutable decimals;
    /// Pricing tier this pool was created under (0=Bronze, 1=Ecosystem,
    /// 2=Marketing), set by the factory at creation. Read off-chain to gate
    /// tier-only features (e.g. the Marketing tier's server-side social links).
    uint8 public immutable tier;
    /// Program duration in days (1..=30), chosen at creation.
    uint256 public immutable durationDays;
    /// Tax on deposits, in basis points. Zero if `treasury == address(0)`.
    uint256 public immutable stakeTaxBps;
    /// Tax on withdrawals, in basis points. Zero if `treasury == address(0)`.
    uint256 public immutable unstakeTaxBps;

    // -------------------------------------------------------------------------
    // Admin / lifecycle
    // -------------------------------------------------------------------------

    address public authority;
    address public pendingAuthority;

    bool public started;
    bool public paused;

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
    // Vault accounting (tokens all live in this contract)
    // -------------------------------------------------------------------------

    uint256 public stakeVaultBalance;
    uint256 public rewardVaultBalance;

    /// Taxes accrued to the treasury, held in this contract until the treasury
    /// pulls them via `withdrawTreasury`. Using a pull-payment (rather than
    /// pushing the tax to `treasury` inside stake/unstake) means a hostile or
    /// reverting treasury cannot block a staker's deposit or withdrawal
    /// (audit finding H-1). These tokens are tracked separately and are never
    /// part of `stakeVaultBalance`/`rewardVaultBalance`, so they are never
    /// staker principal, unclaimed rewards, or `unallocated`.
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
    // Schedule (checkpoint history + cohort maturity buckets)
    // -------------------------------------------------------------------------

    struct Checkpoint {
        uint256 acc; // A_n
        uint256 sumAcc; // G_n = sum_{i=0}^{n} A_i
    }

    /// checkpoints[n] = (A_n, G_n). checkpoints[0] = (0, 0) implicitly.
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
        bool exists;
    }

    mapping(address => Position) public positions;

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

    // -------------------------------------------------------------------------
    // Errors (mirror StakingError)
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
    /// The token did not deliver exactly `amount` (fee-on-transfer / rebasing).
    error InexactTransfer();

    // -------------------------------------------------------------------------
    // Constructor (mirrors initialize_pool)
    // -------------------------------------------------------------------------

    /// @param token_ The ERC-20 to stake (a Pons token).
    /// @param authority_ Pool admin (can pause, set min stake, transfer, withdraw).
    /// @param operator_ The launcher (identity only; funding is one-time at
    ///        creation and there is no post-creation top-up or sweep).
    /// @param treasury_ Recipient of the stake/unstake taxes. Zero for a
    ///        tax-free pool (then both tax rates must be zero).
    /// @param decimals_ Token decimals (informational).
    /// @param durationDays_ Program duration in days (1..=30).
    /// @param stakeTaxBps_ Deposit tax in bps (<= MAX_TAX_BPS).
    /// @param unstakeTaxBps_ Withdrawal tax in bps (<= MAX_TAX_BPS).
    /// @param minStake_ Minimum per-position stake (deposits only).
    ///
    /// The deploying `StakingFactory` is recorded as `factory` and is the only
    /// address permitted to call `initializeFunded` (the one-time funding+start).
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
        require(
            durationDays_ >= StakingMath.MIN_DURATION_DAYS
                && durationDays_ <= StakingMath.MAX_DURATION_DAYS,
            "duration 1..30"
        );
        require(stakeTaxBps_ <= MAX_TAX_BPS && unstakeTaxBps_ <= MAX_TAX_BPS, "tax>max");
        // Treasury is optional; but without it, no tax can be collected.
        require(
            treasury_ != address(0) || (stakeTaxBps_ == 0 && unstakeTaxBps_ == 0),
            "tax w/o treasury"
        );

        token = token_;
        factory = msg.sender; // the deploying StakingFactory
        authority = authority_;
        operator = operator_;
        treasury = treasury_;
        decimals = decimals_;
        tier = tier_;
        durationDays = durationDays_;
        stakeTaxBps = stakeTaxBps_;
        unstakeTaxBps = unstakeTaxBps_;
        minStake = minStake_;

        nextBoundaryIndex = 1; // boundary 0 is pre-recorded as (0, 0)
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized();
        _;
    }

    /// Staleness gate: the pool must have been cranked within one tenure step.
    /// Used by `stake` and `compound` (actions that add weight / extend a
    /// position — pointless and disallowed once the program has ended).
    modifier fresh() {
        if (block.timestamp - lastUpdateTs >= StakingMath.TENURE_STEP_SECONDS) revert PoolStale();
        _;
    }

    /// Freshness gate for the fund-recovery paths (`unstake`, `claim`): fresh if
    /// cranked within one tenure step, OR the pool has been fully cranked to end
    /// (`lastUpdateTs >= endTs`). After the program ends no new emissions accrue
    /// and `crank` clamps `lastUpdateTs` to `endTs`, so once cranked to end the
    /// state is the final, correct settlement point and stays valid forever.
    ///
    /// Without this, `unstake`/`claim` would revert permanently ~1h after
    /// `endTs` (crank can never push `lastUpdateTs` past `endTs`), trapping
    /// staker principal and unclaimed rewards (audit finding C-1). `crank` is
    /// permissionless and not fresh-gated, so a staker can always `crank()` to
    /// end and then exit in the same transaction.
    modifier freshOrEnded() {
        if (
            block.timestamp - lastUpdateTs >= StakingMath.TENURE_STEP_SECONDS
                && lastUpdateTs < endTs
        ) revert PoolStale();
        _;
    }

    /// Pull exactly `amount` of `token` from `from` into this contract, reverting
    /// if the received balance delta is not exactly `amount`. This rejects
    /// fee-on-transfer and rebasing tokens (Option A token-safety policy): a
    /// launchpad pool must have exact, predictable accounting or the reward math
    /// and solvency guarantees break. `amount` must be > 0.
    function _pullExact(address from, uint256 amount) internal {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        uint256 delta = token.balanceOf(address(this)) - before;
        if (delta != amount) revert InexactTransfer();
    }

    // -------------------------------------------------------------------------
    // initializeFunded (factory-only, one-time: fund + start atomically)
    // -------------------------------------------------------------------------

    /// One-time funding + start, callable only by the deploying factory during
    /// `createPool`. The factory transfers exactly `amount` reward tokens into
    /// this pool (from the launcher, who approved the factory) and then calls
    /// this to credit the funding, derive the fixed base rate, and start the
    /// program in the same transaction.
    ///
    /// There is no post-creation funding, re-pricing, or sweep: the pool is
    /// funded exactly once, here. `amount` is verified against the pool's actual
    /// received balance so fee-on-transfer / rebasing tokens are rejected (they
    /// would leave `amount` != received and break solvency accounting).
    function initializeFunded(uint256 amount) external nonReentrant {
        if (msg.sender != factory) revert OnlyFactory();
        if (started) revert AlreadyStarted();
        if (amount == 0) revert ZeroAmount();

        // The factory has already transferred the reward tokens into this pool.
        // Require the contract's balance to hold exactly `amount` (no stakes can
        // exist yet, so the entire balance is the reward funding). This rejects
        // fee-on-transfer/rebasing tokens that deliver a different amount.
        uint256 bal = token.balanceOf(address(this));
        if (bal != amount) revert InexactTransfer();

        rewardVaultBalance = amount;
        fundedAmount = amount;

        baseRatePerPeriod = StakingMath.deriveBaseRateForDuration(amount, durationDays);
        startTs = block.timestamp;
        endTs = block.timestamp + durationDays * StakingMath.SECONDS_PER_DAY;
        lastUpdateTs = block.timestamp;
        started = true;

        emit PoolStarted(baseRatePerPeriod, startTs, endTs, amount);
    }

    // -------------------------------------------------------------------------
    // crank (permissionless, resumable)
    // -------------------------------------------------------------------------

    /// Walk hourly boundaries up to `now` (capped at end), advancing A and G,
    /// popping matured cohorts, recording checkpoints. `maxSteps == 0` uses the
    /// default. Chain calls for catch-up.
    function crank(uint256 maxSteps) public {
        if (!started) revert NotStarted();

        uint256 effectiveNow = block.timestamp < endTs ? block.timestamp : endTs;
        uint256 elapsed = effectiveNow > startTs ? effectiveNow - startTs : 0;
        uint256 targetBoundary = elapsed / StakingMath.TENURE_STEP_SECONDS;

        uint256 steps = maxSteps == 0 ? StakingMath.DEFAULT_MAX_CRANK_STEPS : maxSteps;

        uint256 stepsTaken;
        uint256 baseRate = baseRatePerPeriod;

        while (nextBoundaryIndex <= targetBoundary && stepsTaken < steps) {
            uint256 n = nextBoundaryIndex;

            // Ordering matches the reference model: the segment ending at
            // boundary `n` is paid at the weight in force during it (established
            // at n-1). Ramping positions gain their next step only AFTER this
            // boundary's emission is distributed and checkpointed. (See
            // AUDIT.md H-2.)

            // 1. Emission for this hourly interval (3 periods).
            //    A crank boundary is one tenure step (1 hour). The emission step
            //    index is floor((n-1) / hoursPerEmissionStep), where
            //    hoursPerEmissionStep = EMISSION_STEP_SECONDS / TENURE_STEP_SECONDS
            //    (2h / 1h = 2 under the 1-day ramp; was 6 under the old 3-day ramp).
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

            // 2. Distribute or park in unallocated, at the pre-increment weight.
            if (totalWeight > 0) {
                accRewardPerWeight += (emission * StakingMath.ACC_SCALE) / totalWeight;
            } else {
                unallocated += emission;
            }

            // 3. Advance G.
            sumAccAtBoundaries += accRewardPerWeight;

            // 4. Record checkpoint (A_n, G_n) BEFORE weights change.
            if (n < StakingMath.CHECKPOINT_CAPACITY) {
                checkpoints[n] = Checkpoint({acc: accRewardPerWeight, sumAcc: sumAccAtBoundaries});
            }

            // 5. Now ramping positions gain one step of weight for the NEXT
            //    segment...
            totalWeight += rampingStake;

            // 6. ...and this boundary's cohort hits the cap and stops ramping.
            if (n < StakingMath.MATURING_CAPACITY) {
                uint256 graduating = maturing[n];
                if (graduating > 0) {
                    rampingStake -= graduating;
                    maturing[n] = 0;
                }
            }

            nextBoundaryIndex = n + 1;
            stepsTaken++;
        }

        // Update last_update_ts to reflect how far we cranked.
        uint256 crankedTo = startTs + nextBoundaryIndex * StakingMath.TENURE_STEP_SECONDS;
        lastUpdateTs = crankedTo < effectiveNow ? crankedTo : effectiveNow;

        emit Cranked(nextBoundaryIndex, stepsTaken);
    }

    // -------------------------------------------------------------------------
    // stake
    // -------------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant fresh {
        if (!started) revert NotStarted();
        if (paused) revert Paused();

        Position storage pos = positions[msg.sender];
        if (!pos.exists) {
            pos.exists = true;
        }

        uint256 nowTs = block.timestamp;
        uint256 oldAmount = pos.amount;

        // --- Settle existing position ---
        if (oldAmount > 0) {
            pos.pendingRewards += _computePending(pos);

            uint256 oldK = _tenureSteps(pos, nowTs);
            totalWeight -= oldAmount * StakingMath.weightNumerator(oldK);
            if (oldK < StakingMath.TENURE_RAMP_STEPS) {
                rampingStake -= oldAmount;
            }
        }

        // --- Pull exactly `amount`, then take the stake tax from principal ---
        if (amount == 0) revert ZeroAmount();
        _pullExact(msg.sender, amount);

        // Stake tax is taken from the deposited principal (floored, favouring the
        // staker) and routed to the treasury. netStaked becomes principal.
        uint256 stakeTax = (amount * stakeTaxBps) / BPS_DENOM;
        uint256 delta = amount - stakeTax;

        stakeVaultBalance += delta;
        // Accrue the stake tax for the treasury to pull later (pull-payment):
        // never transfer to `treasury` on the staker's critical path, so a
        // hostile/reverting treasury cannot block staking (H-1).
        if (stakeTax > 0) {
            owedToTreasury += stakeTax;
        }

        // --- Weighted-average deposit timestamp ---
        pos.weightedDepositTs =
            StakingMath.weightedDepositTs(oldAmount, pos.weightedDepositTs, delta, nowTs);

        uint256 newAmount = pos.amount + delta;
        pos.amount = newAmount;

        if (newAmount < minStake) revert BelowMinimumStake();

        // --- New weight ---
        uint256 newK = _tenureSteps(pos, nowTs);
        totalWeight += newAmount * StakingMath.weightNumerator(newK);
        totalStaked += delta;

        // --- Cohort registration if still ramping ---
        if (newK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake += newAmount;
            uint256 currentBoundary = nextBoundaryIndex - 1;
            uint256 maturityIdx = currentBoundary + (StakingMath.TENURE_RAMP_STEPS - newK);
            if (maturityIdx < StakingMath.MATURING_CAPACITY) {
                maturing[maturityIdx] += newAmount;
            }
        }

        // --- Snapshot ---
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
    /// reset. 5% tax to treasury (floored, favouring the user).
    function unstake(uint256 amount) external nonReentrant freshOrEnded {
        if (!started) revert NotStarted();
        Position storage pos = positions[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > pos.amount) revert Overflow();

        uint256 nowTs = block.timestamp;

        // Settle pending.
        pos.pendingRewards += _computePending(pos);

        // Remove old weight.
        uint256 oldAmount = pos.amount;
        uint256 oldK = _tenureSteps(pos, nowTs);
        totalWeight -= oldAmount * StakingMath.weightNumerator(oldK);
        if (oldK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake -= oldAmount;
        }

        uint256 newAmount = pos.amount - amount;
        pos.amount = newAmount;
        totalStaked -= amount;

        // Full tenure reset.
        pos.weightedDepositTs = nowTs;

        // Tax split (per-pool rate; floored, favouring the user).
        uint256 tax = (amount * unstakeTaxBps) / BPS_DENOM;
        uint256 userAmount = amount - tax;

        stakeVaultBalance -= amount;

        // Accrue the unstake tax for the treasury to pull later (pull-payment).
        // The staker's principal is sent directly; the treasury is NOT on this
        // critical path, so a hostile/reverting treasury cannot block unstaking
        // and trap principal (H-1).
        if (tax > 0) {
            owedToTreasury += tax;
        }
        if (userAmount > 0) {
            token.safeTransfer(msg.sender, userAmount);
        }

        // Re-register at k=0 if a balance remains.
        if (newAmount > 0) {
            totalWeight += newAmount * StakingMath.weightNumerator(0);
            rampingStake += newAmount;

            uint256 currentBoundary = nextBoundaryIndex - 1;
            uint256 maturityIdx = currentBoundary + StakingMath.TENURE_RAMP_STEPS;
            if (maturityIdx < StakingMath.MATURING_CAPACITY) {
                maturing[maturityIdx] += newAmount;
            }
        }

        // Snapshot at k=0 with the consistent g_0 baseline.
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
    function claim() external nonReentrant freshOrEnded {
        if (!started) revert NotStarted();
        Position storage pos = positions[msg.sender];

        pos.pendingRewards += _computePending(pos);

        // Re-snapshot without changing tenure. sumAccSnapshot must be the g_k
        // baseline consistent with kNow (not the global sumAcc), so a second
        // claim with no time advance pays zero.
        uint256 kNow = _tenureSteps(pos, block.timestamp);
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

    // -------------------------------------------------------------------------
    // compound
    // -------------------------------------------------------------------------

    /// Fold pending rewards into principal. Blocked while paused. Exempt from
    /// min_stake (the position already exists).
    function compound() external nonReentrant fresh {
        if (!started) revert NotStarted();
        if (paused) revert Paused();

        Position storage pos = positions[msg.sender];
        uint256 nowTs = block.timestamp;

        pos.pendingRewards += _computePending(pos);

        uint256 compoundAmount = pos.pendingRewards;
        if (compoundAmount == 0) {
            // Re-snapshot and return.
            uint256 k = _tenureSteps(pos, nowTs);
            pos.snapshotK = k;
            pos.accSnapshot = accRewardPerWeight;
            pos.sumAccSnapshot = _snapshotSumAcc(pos.depositBoundaryIndex, k);
            return;
        }

        // Remove old weight.
        uint256 oldAmount = pos.amount;
        uint256 oldK = _tenureSteps(pos, nowTs);
        totalWeight -= oldAmount * StakingMath.weightNumerator(oldK);
        if (oldK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake -= oldAmount;
        }

        // Move reward -> stake accounting (tokens already in contract).
        rewardVaultBalance -= compoundAmount;
        stakeVaultBalance += compoundAmount;

        pos.pendingRewards = 0;
        uint256 newAmount = pos.amount + compoundAmount;

        // Weighted-average deposit timestamp (tenure dilution).
        pos.weightedDepositTs =
            StakingMath.weightedDepositTs(oldAmount, pos.weightedDepositTs, compoundAmount, nowTs);
        pos.amount = newAmount;

        // Bookkeeping: compounding counts as claimed then re-staked.
        pos.totalClaimed += compoundAmount;
        totalClaimed += compoundAmount;
        totalStaked += compoundAmount;

        // Re-register with new weight.
        uint256 newK = _tenureSteps(pos, nowTs);
        totalWeight += newAmount * StakingMath.weightNumerator(newK);
        if (newK < StakingMath.TENURE_RAMP_STEPS) {
            rampingStake += newAmount;
            uint256 currentBoundary = nextBoundaryIndex - 1;
            uint256 maturityIdx = currentBoundary + (StakingMath.TENURE_RAMP_STEPS - newK);
            if (maturityIdx < StakingMath.MATURING_CAPACITY) {
                maturing[maturityIdx] += newAmount;
            }
        }

        // Snapshot.
        pos.depositBoundaryIndex = _tenureBoundaryIndex(pos);
        pos.snapshotK = newK;
        pos.accSnapshot = accRewardPerWeight;
        pos.sumAccSnapshot = _snapshotSumAcc(pos.depositBoundaryIndex, newK);

        emit Compounded(msg.sender, compoundAmount, newAmount);
    }

    /// Pay out accrued stake/unstake taxes to the treasury (pull-payment).
    /// Permissionless: the destination is the fixed, immutable `treasury`, so
    /// anyone (e.g. a keeper) may trigger the payout — it can only ever send to
    /// the treasury. This is the ONLY path that transfers to `treasury`, keeping
    /// it off the staker's stake/unstake critical path (H-1). Reverts if there
    /// is nothing accrued or (defensively) if no treasury is configured.
    function withdrawTreasury() external nonReentrant {
        if (treasury == address(0)) revert NotTreasury();
        uint256 amount = owedToTreasury;
        if (amount == 0) revert NothingToWithdraw();

        owedToTreasury = 0;
        token.safeTransfer(treasury, amount);

        emit TreasuryWithdrawn(treasury, amount);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setPaused(bool paused_) external onlyAuthority {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setMinStake(uint256 minStake_) external onlyAuthority {
        minStake = minStake_;
        emit MinStakeSet(minStake_);
    }

    /// Two-party authority transfer: current authority proposes, the proposed
    /// address must call `acceptAuthority` (mirrors the Solana two-signer flow).
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

    /// Fixed grace period after `end_ts` before unallocated recovery: 7 days.
    /// Fixed by the protocol, not chosen per-call (AUDIT.md M-1).
    uint256 public constant UNALLOCATED_GRACE_SECONDS = 7 * 24 * 60 * 60;

    /// Withdraw tokens accumulated during zero-TVL intervals, after end + the
    /// fixed grace period.
    function withdrawUnallocated(uint256 amount) external onlyAuthority nonReentrant {
        if (!started) revert NotStarted();
        uint256 gate = endTs + UNALLOCATED_GRACE_SECONDS;
        if (block.timestamp <= gate) revert WithdrawTooEarly();
        if (amount > unallocated) revert InsufficientUnallocated();

        unallocated -= amount;
        rewardVaultBalance -= amount;
        token.safeTransfer(authority, amount);

        emit UnallocatedWithdrawn(amount, unallocated);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// Pending rewards a user could claim if the pool were cranked to now.
    /// (Uses the already-cranked accumulators, matching the on-chain settle.)
    function pendingRewards(address user) external view returns (uint256) {
        Position storage pos = positions[user];
        return pos.pendingRewards + _computePending(pos);
    }

    /// Pool-average multiplier in bps; 0 for an empty pool.
    function averageMultBps() external view returns (uint256) {
        if (totalStaked == 0) return 0;
        return (totalWeight * StakingMath.BPS) / (totalStaked * StakingMath.TENURE_RAMP_STEPS);
    }

    // -------------------------------------------------------------------------
    // Internal helpers (mirror the per-instruction helpers)
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

    /// The boundary-sum baseline `G_{depositBoundary + min(k,72)}` consistent
    /// with tenure step `k`. This is the SAME value `_computePending` reads for
    /// that `k`, so snapshotting it makes a re-settlement with no time advance
    /// telescope the boundary-correction term to zero (double-claim pays zero).
    ///
    /// The reference model snapshots this `g_k`, not the global `sumAcc`. Using
    /// the global `sumAcc` (as an earlier revision did) over-pays a matured
    /// position on repeat settlement because its `k` is frozen at 72 while the
    /// global boundary index keeps advancing.
    function _snapshotSumAcc(uint256 depositBoundaryIndex, uint256 k) internal view returns (uint256) {
        uint256 gIdx = depositBoundaryIndex + StakingMath.cappedSteps(k);
        if (gIdx < StakingMath.CHECKPOINT_CAPACITY && gIdx < nextBoundaryIndex) {
            return checkpoints[gIdx].sumAcc;
        }
        return sumAccAtBoundaries;
    }

    /// O(1) accrual using the position's snapshot and the checkpoint history.
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
