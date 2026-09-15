// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StakingPool} from "./StakingPool.sol";

/// @title StakingFactory
/// @notice Deploys one isolated `StakingPool` per ERC-20 token. Any token can
///         permissionlessly create its own staking farm (1..30 days) by paying
///         a fixed per-tier launch fee and funding the pool up front.
///
/// Per-pool trust model (set once, at creation, then immutable in the pool):
/// - `operator`  = the launcher (`msg.sender`): identity only (funding is
///                 one-time at creation; there is no top-up and no sweep).
/// - `treasury`  = launcher-selected; receives the stake/unstake taxes. Optional
///                 — if zero, both taxes must be zero.
/// - `authority` = the launcher: pool admin (pause, min-stake, withdraw-unallocated).
///
/// Funding is atomic with creation: the launcher approves this factory for the
/// reward tokens, and `createPool` pulls them into the new pool and starts it in
/// one transaction. One live pool per token; a new pool may be created for a
/// token only after its previous pool has ended.
///
/// The launch fee (per tier) is forwarded to a fixed collector address.
contract StakingFactory {
    using SafeERC20 for IERC20;

    /// Pricing tiers a launcher can select at creation. Each charges a fixed ETH
    /// fee and unlocks a different set of (mostly off-chain) features:
    /// - Bronze:    0.01 ETH. Capped at 48h (2 days) duration. No banner/socials.
    /// - Ecosystem: 0.03 ETH. Full duration range; banner + social links + a
    ///              dashboard UI (enforced off-chain by the app via pool metadata).
    /// - Marketing: 0.06 ETH. Standalone tier; full duration range plus the
    ///              marketing-boost perks (front-page trending + "verified safe"
    ///              badge), also applied off-chain via pool metadata.
    enum Tier {
        Bronze,
        Ecosystem,
        Marketing
    }

    /// Per-tier fixed launch fees, set once at deployment (immutable). Making
    /// these constructor params — rather than hardcoded constants — lets the
    /// SAME contract be deployed on different chains with chain-appropriate,
    /// native-token-denominated fees (e.g. ETH on Robinhood Chain, BNB on BSC)
    /// without forking the codebase.
    uint256 public immutable BRONZE_FEE;
    uint256 public immutable ECOSYSTEM_FEE;
    uint256 public immutable MARKETING_FEE;

    /// Bronze tier duration cap: 48 hours = 2 days.
    uint256 public constant BRONZE_MAX_DURATION_DAYS = 2;

    /// Recipient of all tier fees, set once at deployment (immutable). A
    /// constructor param so each chain's factory can route fees to a
    /// chain-appropriate collector.
    address public immutable FEE_RECIPIENT;

    /// Maximum tax on each side (stake and unstake): 10%.
    uint256 public constant MAX_TAX_BPS = 1_000;

    /// Selectable pool duration bounds, in days.
    uint256 public constant MIN_DURATION_DAYS = 1;
    uint256 public constant MAX_DURATION_DAYS = 30;

    /// @param bronzeFee    Launch fee for the Bronze tier, in wei of the native
    ///                     gas token (ETH on Robinhood/Base/Arbitrum/Optimism/
    ///                     Ethereum, BNB on BSC, POL on Polygon, etc).
    /// @param ecosystemFee Launch fee for the Ecosystem tier (wei).
    /// @param marketingFee Launch fee for the Marketing tier (wei).
    /// @param feeRecipient Address that receives every tier fee.
    /// Fees must be strictly increasing (bronze < ecosystem < marketing) and
    /// non-zero, matching the tier value ordering.
    constructor(
        uint256 bronzeFee,
        uint256 ecosystemFee,
        uint256 marketingFee,
        address feeRecipient
    ) {
        if (bronzeFee == 0) revert ZeroFee();
        if (!(bronzeFee < ecosystemFee && ecosystemFee < marketingFee)) revert BadFeeOrder();
        if (feeRecipient == address(0)) revert ZeroAddress();
        BRONZE_FEE = bronzeFee;
        ECOSYSTEM_FEE = ecosystemFee;
        MARKETING_FEE = marketingFee;
        FEE_RECIPIENT = feeRecipient;
    }

    /// token => current deployed pool. One live pool per token; once a pool has
    /// ended a fresh pool may be created for the same token (see `createPool`).
    mapping(address => address) public poolOf;
    /// All deployed pools, for enumeration (append-only; includes ended pools).
    address[] public allPools;

    /// The fee for a given tier.
    function feeForTier(Tier tier) public view returns (uint256) {
        if (tier == Tier.Bronze) return BRONZE_FEE;
        if (tier == Tier.Ecosystem) return ECOSYSTEM_FEE;
        return MARKETING_FEE; // Tier.Marketing
    }

    event PoolCreated(
        address indexed token,
        address indexed pool,
        address indexed operator,
        address treasury,
        uint256 durationDays,
        uint256 stakeTaxBps,
        uint256 unstakeTaxBps,
        uint256 fundingAmount,
        uint256 minStake,
        Tier tier
    );

    error PoolExists();
    error ZeroAddress();
    error BadLaunchFee();
    error TaxTooHigh();
    error TaxWithoutTreasury();
    error BadDuration();
    error FeeTransferFailed();
    error ZeroFunding();
    error BadFeeOrder();
    error ZeroFee();

    /// Deploy, fund, and start a staking pool for `token` in a single
    /// transaction. The caller becomes the pool operator and admin.
    ///
    /// Funding is one-time and happens here: the caller must first `approve`
    /// this factory for `fundingAmount` of `token`; the factory transfers those
    /// reward tokens into the new pool and starts it. There is no post-creation
    /// funding, top-up, or sweep — the only way tokens leave a funded pool is via
    /// staking emissions (claims) or the authority's `withdrawUnallocated` for
    /// zero-TVL leftovers after the program ends + grace.
    ///
    /// One live pool per token. If a pool already exists for `token`, a new one
    /// may only be created once the existing pool has ended (its program is over).
    ///
    /// @param token         The ERC-20 to stake (a Pons token). Must implement
    ///                      `decimals()`. Fee-on-transfer / rebasing tokens are
    ///                      rejected by the pool at funding/stake time.
    /// @param treasury      Recipient of the stake/unstake taxes. Pass the zero
    ///                      address for a no-tax pool (then both taxes must be 0).
    /// @param durationDays  Program length in days (1..=30).
    /// @param stakeTaxBps   Tax on deposits, in basis points (<= MAX_TAX_BPS).
    /// @param unstakeTaxBps Tax on withdrawals, in basis points (<= MAX_TAX_BPS).
    /// @param fundingAmount Reward tokens to fund the pool with (one-time, > 0).
    ///                      The caller must approve the factory for this amount.
    /// @param minStake      Minimum per-position stake (enforced on deposits).
    /// @param tier          Pricing tier. `msg.value` must equal `feeForTier(tier)`.
    ///                      Bronze caps `durationDays` at BRONZE_MAX_DURATION_DAYS
    ///                      (2 days / 48h). Ecosystem and Marketing allow the full
    ///                      1..=30 range. Marketing is a standalone tier whose
    ///                      extra perks (trending, verified-safe badge) are applied
    ///                      off-chain via pool metadata.
    /// @return pool The address of the newly deployed pool.
    function createPool(
        IERC20 token,
        address treasury,
        uint256 durationDays,
        uint256 stakeTaxBps,
        uint256 unstakeTaxBps,
        uint256 fundingAmount,
        uint256 minStake,
        Tier tier
    ) external payable returns (address pool) {
        if (msg.value != feeForTier(tier)) revert BadLaunchFee();
        if (address(token) == address(0)) revert ZeroAddress();
        if (fundingAmount == 0) revert ZeroFunding();
        if (durationDays < MIN_DURATION_DAYS || durationDays > MAX_DURATION_DAYS) revert BadDuration();
        // Bronze is capped at 48h (2 days); other tiers allow the full range.
        if (tier == Tier.Bronze && durationDays > BRONZE_MAX_DURATION_DAYS) revert BadDuration();

        // One live pool per token. Allow re-creation only if the prior pool has
        // ended (its program is over). Until then, block duplicates.
        address existing = poolOf[address(token)];
        if (existing != address(0) && !_hasEnded(existing)) revert PoolExists();

        if (stakeTaxBps > MAX_TAX_BPS || unstakeTaxBps > MAX_TAX_BPS) revert TaxTooHigh();
        // No treasury => no taxes are collectible, so they must be zero.
        if (treasury == address(0) && (stakeTaxBps != 0 || unstakeTaxBps != 0)) {
            revert TaxWithoutTreasury();
        }

        uint8 dec = IERC20Metadata(address(token)).decimals();

        StakingPool p = new StakingPool(
            token,
            msg.sender, // authority (admin) = launcher
            msg.sender, // operator = launcher
            treasury,
            dec,
            durationDays,
            stakeTaxBps,
            unstakeTaxBps,
            minStake,
            uint8(tier)
        );

        pool = address(p);
        poolOf[address(token)] = pool;
        allPools.push(pool);

        // One-time funding: pull the reward tokens from the caller straight into
        // the new pool, then start it. The pool verifies its received balance
        // equals `fundingAmount` (rejecting fee-on-transfer/rebasing tokens).
        token.safeTransferFrom(msg.sender, pool, fundingAmount);
        StakingPool(pool).initializeFunded(fundingAmount);

        emit PoolCreated(
            address(token), pool, msg.sender, treasury, durationDays, stakeTaxBps, unstakeTaxBps, fundingAmount, minStake, tier
        );

        // Forward the launch fee to the fixed collector.
        (bool ok, ) = FEE_RECIPIENT.call{value: msg.value}("");
        if (!ok) revert FeeTransferFailed();
    }

    /// True if a previously-deployed pool's program has ended (now > endTs).
    /// A started pool always has a nonzero endTs; created pools start
    /// immediately, so `endTs` is set for every pool this factory deploys.
    function _hasEnded(address poolAddr) internal view returns (bool) {
        uint256 end = StakingPool(poolAddr).endTs();
        return end != 0 && block.timestamp > end;
    }

    /// Number of pools deployed.
    function poolCount() external view returns (uint256) {
        return allPools.length;
    }
}
