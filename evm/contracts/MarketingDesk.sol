// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILaforgePool {
    function factory() external view returns (address);
}

/// @title MarketingDesk
/// @notice Sidecar for already-deployed `StakingFactory` instances.
///         Anyone may pay this chain's marketing fee for a factory pool at any
///         time. Payment unlocks Marketing privileges on the pool (banner,
///         socials, 12-hour trending). Repeat payments extend trending.
///         Branding and the verified badge stay with the operator off-chain.
///         The pool's on-chain `tier` is not mutated.
contract MarketingDesk is ReentrancyGuard {
    uint256 public immutable FEE;
    address public immutable FEE_RECIPIENT;
    /// Factory whose pools this desk accepts. Pools from any other factory revert.
    address public immutable FACTORY;
    uint256 public constant SLOT_SECONDS = 12 hours;

    mapping(address => uint256) public unlockedAt;
    mapping(address => uint256) public trendingUntil;

    event MarketingPurchased(
        address indexed pool,
        address indexed buyer,
        uint256 trendingUntil_,
        bool firstUnlock
    );

    error ZeroAddress();
    error ZeroFee();
    error BadFee();
    error UnknownPool();
    error FeeTransferFailed();

    constructor(uint256 fee_, address recipient_, address factory_) {
        if (fee_ == 0) revert ZeroFee();
        if (recipient_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        FEE = fee_;
        FEE_RECIPIENT = recipient_;
        FACTORY = factory_;
    }

    function hasMarketing(address pool) public view returns (bool) {
        return unlockedAt[pool] != 0;
    }

    function isTrending(address pool) external view returns (bool) {
        return trendingUntil[pool] > block.timestamp;
    }

    /// Pay `FEE` in this chain's native token to unlock (or refresh) Marketing.
    /// Anyone may pay for a pool created by `FACTORY`. This is a boost, not a stake.
    function buyMarketing(address pool) external payable nonReentrant {
        if (pool == address(0)) revert ZeroAddress();
        if (msg.value != FEE) revert BadFee();

        ILaforgePool p = ILaforgePool(pool);
        if (p.factory() != FACTORY) revert UnknownPool();

        bool first = unlockedAt[pool] == 0;
        if (first) unlockedAt[pool] = block.timestamp;

        uint256 start = trendingUntil[pool] > block.timestamp ? trendingUntil[pool] : block.timestamp;
        uint256 until_ = start + SLOT_SECONDS;
        trendingUntil[pool] = until_;

        emit MarketingPurchased(pool, msg.sender, until_, first);

        (bool ok,) = FEE_RECIPIENT.call{value: msg.value}("");
        if (!ok) revert FeeTransferFailed();
    }
}
