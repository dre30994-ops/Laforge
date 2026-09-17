// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {StakingFactory} from "./StakingFactory.sol";
import {StakingPool} from "./StakingPool.sol";

/// Minimal token for tests. Not deployed in production.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Hardhat 3 / Foundry-style cheatcodes (bundled, no extra package).
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
}

contract StakingFactoryTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant BRONZE = 0.01 ether;
    uint256 internal constant ECO = 0.03 ether;
    uint256 internal constant MKT = 0.06 ether;
    uint256 internal constant FUNDING = 1_000_000 ether;
    uint256 internal constant MIN_STAKE = 1 ether;
    uint256 internal constant STAKE_AMT = 100 ether;

    StakingFactory internal factory;
    MockERC20 internal token;
    address internal launcher;
    address internal staker;
    address internal feeSink;

    function setUp() public {
        launcher = address(0xA11CE);
        staker = address(0xB0B);
        feeSink = address(0xFEE);

        vm.deal(launcher, 10 ether);
        factory = new StakingFactory(BRONZE, ECO, MKT, feeSink);
        token = new MockERC20();
        token.mint(launcher, FUNDING * 10);
        token.mint(staker, FUNDING);
    }

    function _createPool(uint256 durationDays) internal returns (StakingPool pool) {
        vm.startPrank(launcher);
        token.approve(address(factory), FUNDING);
        address poolAddr = factory.createPool{value: ECO}(
            IERC20(address(token)),
            address(0),
            durationDays,
            0,
            0,
            FUNDING,
            MIN_STAKE,
            StakingFactory.Tier.Ecosystem
        );
        vm.stopPrank();
        pool = StakingPool(poolAddr);
    }

    function test_CreatePoolStartsAndRecords() public {
        StakingPool pool = _createPool(14);
        require(pool.started(), "not started");
        require(factory.poolOf(address(token)) == address(pool), "poolOf");
        require(factory.poolCount() == 1, "count");
        require(pool.baseRatePerPeriod() > 0, "zero rate");
    }

    function test_RejectsZeroMinStake() public {
        vm.startPrank(launcher);
        token.approve(address(factory), FUNDING);
        try factory.createPool{value: ECO}(
            IERC20(address(token)),
            address(0),
            14,
            0,
            0,
            FUNDING,
            0,
            StakingFactory.Tier.Ecosystem
        ) {
            revert("expected ZeroMinStake");
        } catch {}
        vm.stopPrank();
    }

    function test_RejectsBronzeOverTwoDays() public {
        vm.startPrank(launcher);
        token.approve(address(factory), FUNDING);
        try factory.createPool{value: BRONZE}(
            IERC20(address(token)),
            address(0),
            3,
            0,
            0,
            FUNDING,
            MIN_STAKE,
            StakingFactory.Tier.Bronze
        ) {
            revert("expected BadDuration");
        } catch {}
        vm.stopPrank();
    }

    function test_StakeUnstakeRoundTrip() public {
        StakingPool pool = _createPool(14);
        vm.startPrank(staker);
        token.approve(address(pool), STAKE_AMT);
        pool.stake(STAKE_AMT);
        uint256 before = token.balanceOf(staker);
        pool.unstake(STAKE_AMT);
        vm.stopPrank();
        require(token.balanceOf(staker) - before == STAKE_AMT, "principal");
        require(pool.totalStaked() == 0, "tvl");
        require(pool.rampingStake() == 0, "ramping");
    }

    /// C-1: full unstake must unregister the maturing bucket so crank 72h later cannot underflow.
    function test_UnstakeAllThenCrank72h() public {
        StakingPool pool = _createPool(14);
        vm.startPrank(staker);
        token.approve(address(pool), STAKE_AMT);
        pool.stake(STAKE_AMT);
        (,,,,,,,, uint256 maturingIndex,) = pool.positions(staker);
        require(maturingIndex != 0, "bucket not set");
        pool.unstake(STAKE_AMT);
        (,,,,,,,, maturingIndex,) = pool.positions(staker);
        require(maturingIndex == 0, "bucket not cleared");
        vm.stopPrank();

        vm.warp(block.timestamp + 72 hours);
        pool.crank(0);
        require(pool.rampingStake() == 0, "ghost ramping");
    }

    /// C-1: restake then crank through the old + new buckets.
    function test_RestakeThenCrank() public {
        StakingPool pool = _createPool(14);
        vm.startPrank(staker);
        token.approve(address(pool), STAKE_AMT * 2);
        pool.stake(STAKE_AMT);
        vm.stopPrank();

        vm.warp(block.timestamp + 10 hours);
        pool.crank(0);

        vm.startPrank(staker);
        pool.stake(STAKE_AMT / 2);
        vm.stopPrank();
        require(pool.rampingStake() == STAKE_AMT + STAKE_AMT / 2, "ramping after restake");

        vm.warp(block.timestamp + 72 hours);
        pool.crank(0);
        pool.crank(0);
    }

    /// C-1: one of two stakers fully exits; the other can still unstake after 72h.
    function test_TwoStakersOneExit() public {
        StakingPool pool = _createPool(14);

        vm.startPrank(staker);
        token.approve(address(pool), STAKE_AMT);
        pool.stake(STAKE_AMT);
        vm.stopPrank();

        vm.startPrank(launcher);
        token.approve(address(pool), STAKE_AMT);
        pool.stake(STAKE_AMT);
        vm.stopPrank();
        require(pool.rampingStake() == STAKE_AMT * 2, "both ramping");

        vm.prank(staker);
        pool.unstake(STAKE_AMT);
        require(pool.rampingStake() == STAKE_AMT, "after one exit");

        vm.warp(block.timestamp + 72 hours);
        pool.crank(0);
        pool.crank(0);

        vm.prank(launcher);
        pool.unstake(STAKE_AMT);
        require(pool.totalStaked() == 0, "tvl after both out");
    }

    function test_StakeRevertsAfterEnd() public {
        StakingPool pool = _createPool(1);
        vm.warp(block.timestamp + 1 days + 1);
        pool.crank(0);

        vm.startPrank(staker);
        token.approve(address(pool), STAKE_AMT);
        try pool.stake(STAKE_AMT) {
            revert("expected ProgramEnded");
        } catch {}
        vm.stopPrank();
    }

    function test_UnstakeWorksAfterEnd() public {
        StakingPool pool = _createPool(1);
        vm.startPrank(staker);
        token.approve(address(pool), STAKE_AMT);
        pool.stake(STAKE_AMT);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(staker);
        pool.unstake(STAKE_AMT);
        require(pool.totalStaked() == 0, "unstake after end");
    }

    function test_SetMinStakeCap() public {
        StakingPool pool = _createPool(14);
        vm.prank(launcher);
        try pool.setMinStake(MIN_STAKE * 11) {
            revert("expected MinStakeTooHigh");
        } catch {}
    }

    function test_WithdrawUnallocatedWhileStakedReverts() public {
        StakingPool pool = _createPool(1);
        vm.startPrank(staker);
        token.approve(address(pool), STAKE_AMT);
        pool.stake(STAKE_AMT);
        vm.stopPrank();

        vm.warp(block.timestamp + 8 days);
        vm.prank(launcher);
        try pool.withdrawUnallocated(1) {
            revert("expected RemainingStake");
        } catch {}
    }
}
