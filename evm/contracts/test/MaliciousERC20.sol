// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// A fee-on-transfer token: burns `feeBps` of every transfer. The pool accepts
/// this up to 10% (1000 bps) and credits only the tokens that arrived.
contract FeeOnTransferERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public feeBps;

    constructor(uint8 decimals_, uint256 feeBps_) ERC20("Fee", "FEE") {
        _decimals = decimals_;
        feeBps = feeBps_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeBps(uint256 feeBps_) external {
        require(feeBps_ <= 10_000, "fee");
        feeBps = feeBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0), fee); // burn the fee
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// A token that reverts on transfers to a specific "blocked" address, used to
/// simulate a hostile treasury. With the pull-payment design, stake/unstake must
/// still succeed (the tax only accrues) and only `withdrawTreasury` (the actual
/// transfer to the treasury) should revert.
contract BlockRecipientERC20 is ERC20 {
    uint8 private immutable _decimals;
    address public blocked;

    constructor(uint8 decimals_) ERC20("Block", "BLK") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address a) external {
        blocked = a;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(blocked == address(0) || to != blocked, "recipient blocked");
        super._update(from, to, value);
    }
}

interface IReenterTarget {
    function stake(uint256 amount) external;
    function claim() external;
}

/// A token that attempts to reenter the pool during a transfer. Used to verify
/// the ReentrancyGuard blocks cross-function reentrancy.
contract ReentrantERC20 is ERC20 {
    uint8 private immutable _decimals;
    address public target;
    bool public attackEnabled;

    constructor(uint8 decimals_) ERC20("Reenter", "RENT") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(address t) external {
        target = t;
    }

    function enableAttack(bool on) external {
        attackEnabled = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // Trigger on payouts FROM the target pool (e.g. claim/unstake transfers).
        if (attackEnabled && target != address(0) && from == target) {
            attackEnabled = false; // avoid unbounded recursion if guard is missing
            IReenterTarget(target).claim();
        }
    }
}
