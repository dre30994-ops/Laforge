// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StakingMath} from "../StakingMath.sol";

/// Exposes the internal library functions so tests can assert math parity with
/// the Rust `staking-math` golden values.
contract MathHarness {
    function deriveBaseRate(uint256 funded) external pure returns (uint256) {
        return StakingMath.deriveBaseRate(funded);
    }

    function emissionMultNumerator(uint256 step) external pure returns (uint256) {
        return StakingMath.emissionMultNumerator(step);
    }

    function emissionMultBps(uint256 step) external pure returns (uint256) {
        return StakingMath.emissionMultBps(step);
    }

    function emissionForStep(uint256 baseRate, uint256 step) external pure returns (uint256) {
        return StakingMath.emissionForStep(baseRate, step);
    }

    function cumulativeNumerator(uint256 elapsed) external pure returns (uint256) {
        return StakingMath.cumulativeNumerator(elapsed);
    }

    function cumulativeEmitted(uint256 baseRate, uint256 elapsed) external pure returns (uint256) {
        return StakingMath.cumulativeEmitted(baseRate, elapsed);
    }

    function remainingPeriodUnits(uint256 elapsed) external pure returns (uint256) {
        return StakingMath.remainingPeriodUnits(elapsed);
    }

    function denomForDuration(uint256 durationDays) external pure returns (uint256) {
        return StakingMath.denomForDuration(durationDays);
    }

    function remainingPeriodUnitsFor(uint256 elapsed, uint256 durationDays) external pure returns (uint256) {
        return StakingMath.remainingPeriodUnitsFor(elapsed, durationDays);
    }

    function deriveBaseRateForDuration(uint256 funded, uint256 durationDays) external pure returns (uint256) {
        return StakingMath.deriveBaseRateForDuration(funded, durationDays);
    }

    function weightNumerator(uint256 steps) external pure returns (uint256) {
        return StakingMath.weightNumerator(steps);
    }

    function tenureMultBps(uint256 steps) external pure returns (uint256) {
        return StakingMath.tenureMultBps(steps);
    }

    function weightedDepositTs(
        uint256 stakeOld,
        uint256 tsOld,
        uint256 added,
        uint256 nowTs
    ) external pure returns (uint256) {
        return StakingMath.weightedDepositTs(stakeOld, tsOld, added, nowTs);
    }

    function accrual(
        uint256 stake,
        uint256 snapAcc,
        uint256 snapSumAcc,
        uint256 snapK,
        uint256 k,
        uint256 accNow,
        uint256 gK
    ) external pure returns (uint256) {
        StakingMath.Snapshot memory snap =
            StakingMath.Snapshot({acc: snapAcc, sumAcc: snapSumAcc, k: snapK});
        return StakingMath.accrual(stake, snap, k, accNow, gK);
    }
}
