// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StakingPool} from "./StakingPool.sol";

/// @title StakingFactory
/// @notice Deploys one isolated `StakingPool` per ERC-20 token. Any token can
///         permissionlessly create its own staking farm (1..30 days) by paying
///         a fixed per-tier launch fee and funding the pool up front.
///
/// Per-pool trust model (set once, at creation, then immutable in the pool):
/// - `operator`  = the launcher (`msg.sender`): identity only.
/// - `treasury`  = launcher-selected; receives the stake/unstake taxes. Optional
///                 — if zero, both taxes must be zero.
/// - `authority` = the launcher: pool admin (pause, min-stake, withdraw-unallocated).
///
/// Funding is atomic with creation. One live pool per token; a new pool may be
/// created for a token only after its previous pool has ended.
///
/// The launch fee (per tier) is forwarded to a fixed collector address.
contract StakingFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Pricing tiers a launcher can select at creation. Each charges a fixed
    /// native-token fee. Banner / socials / "verified" perks are off-chain.
    /// - Bronze:    capped at 48h (2 days).
    /// - Ecosystem: full duration range.
    /// - Marketing: full duration range; extra perks applied off-chain only.
    enum Tier {
        Bronze,
        Ecosystem,
        Marketing
    }

    uint256 public immutable BRONZE_FEE;
    uint256 public immutable ECOSYSTEM_FEE;
    uint256 public immutable MARKETING_FEE;

    uint256 public constant BRONZE_MAX_DURATION_DAYS = 2;
    address public immutable FEE_RECIPIENT;

    uint256 public constant MAX_TAX_BPS = 1_000;
    uint256 public constant MIN_DURATION_DAYS = 1;
    uint256 public constant MAX_DURATION_DAYS = 30;

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

    mapping(address => address) public poolOf;
    address[] public allPools;

    function feeForTier(Tier tier) public view returns (uint256) {
        if (tier == Tier.Bronze) return BRONZE_FEE;
        if (tier == Tier.Ecosystem) return ECOSYSTEM_FEE;
        return MARKETING_FEE;
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
    error ZeroMinStake();

    /// Deploy, fund, and start a staking pool for `token` in a single
    /// transaction. The caller becomes the pool operator and admin.
    ///
    /// @param token         The ERC-20 to stake. Must implement `decimals()`.
    /// @param treasury      Tax recipient. Zero address ⇒ both taxes must be 0.
    /// @param durationDays  Program length in days (1..=30).
    /// @param stakeTaxBps   Tax on deposits, bps (<= MAX_TAX_BPS).
    /// @param unstakeTaxBps Tax on withdrawals, bps (<= MAX_TAX_BPS).
    /// @param fundingAmount Reward tokens to fund the pool with (one-time, > 0).
    /// @param minStake      Minimum per-position stake (must be > 0).
    /// @param tier          Pricing tier. `msg.value` must equal `feeForTier(tier)`.
    function createPool(
        IERC20 token,
        address treasury,
        uint256 durationDays,
        uint256 stakeTaxBps,
        uint256 unstakeTaxBps,
        uint256 fundingAmount,
        uint256 minStake,
        Tier tier
    ) external payable nonReentrant returns (address pool) {
        if (msg.value != feeForTier(tier)) revert BadLaunchFee();
        if (address(token) == address(0)) revert ZeroAddress();
        if (fundingAmount == 0) revert ZeroFunding();
        if (minStake == 0) revert ZeroMinStake();
        if (durationDays < MIN_DURATION_DAYS || durationDays > MAX_DURATION_DAYS) revert BadDuration();
        if (tier == Tier.Bronze && durationDays > BRONZE_MAX_DURATION_DAYS) revert BadDuration();

        address existing = poolOf[address(token)];
        if (existing != address(0) && !_hasEnded(existing)) revert PoolExists();

        if (stakeTaxBps > MAX_TAX_BPS || unstakeTaxBps > MAX_TAX_BPS) revert TaxTooHigh();
        if (treasury == address(0) && (stakeTaxBps != 0 || unstakeTaxBps != 0)) {
            revert TaxWithoutTreasury();
        }

        uint8 dec = IERC20Metadata(address(token)).decimals();

        StakingPool p = new StakingPool(
            token,
            msg.sender,
            msg.sender,
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

        token.safeTransferFrom(msg.sender, pool, fundingAmount);
        StakingPool(pool).initializeFunded(fundingAmount);

        emit PoolCreated(
            address(token),
            pool,
            msg.sender,
            treasury,
            durationDays,
            stakeTaxBps,
            unstakeTaxBps,
            fundingAmount,
            minStake,
            tier
        );

        // Forward the launch fee last. `nonReentrant` blocks a recipient hook
        // from reentering `createPool`. A reverting recipient still rolls the
        // whole create back — FEE_RECIPIENT must accept native transfers.
        (bool ok,) = FEE_RECIPIENT.call{value: msg.value}("");
        if (!ok) revert FeeTransferFailed();
    }

    /// True if a previously-deployed pool's program has ended (`now >= endTs`).
    function _hasEnded(address poolAddr) internal view returns (bool) {
        uint256 end = StakingPool(poolAddr).endTs();
        return end != 0 && block.timestamp >= end;
    }

    function poolCount() external view returns (uint256) {
        return allPools.length;
    }
}
