// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title StakingMath
/// @notice Pure emission / weight / accrual math for the staking farm.
///         A faithful Solidity port of the Rust `staking-math` crate.
///
/// All amounts are in base units of the token. Solidity 0.8 has checked
/// arithmetic by default, which mirrors the Rust `checked_*` semantics: any
/// overflow or underflow reverts rather than wrapping.
///
/// # The two facts worth internalising (from the reference)
///
/// * The tenure multiplier is zero-sum. A staker's share is
///   `stake_i * mult_i / sum(stake_j * mult_j)`. Real income growth comes from
///   the global 2x emission ramp, not personal tenure.
/// * Rounding always floors toward the pool. Emission floors once against a
///   cumulative numerator; accrual floors once per settlement.
library StakingMath {
    // -------------------------------------------------------------------------
    // Constants (exact copies of crates/staking-math/src/constants.rs)
    // -------------------------------------------------------------------------

    /// One emission period: 20 minutes. 72 periods per day.
    uint256 internal constant PERIOD_SECONDS = 1_200;
    /// One global emission step: 2 hours.
    uint256 internal constant EMISSION_STEP_SECONDS = 7_200;
    /// Ramping emission steps: 12 x 2h = 1 day, linear 1.0x -> 2.0x.
    uint256 internal constant EMISSION_RAMP_STEPS = 12;
    /// One per-user tenure step: 1 hour.
    uint256 internal constant TENURE_STEP_SECONDS = 3_600;
    /// Tenure steps to reach the 2.0x cap: 72 x 1h = 3 days.
    uint256 internal constant TENURE_RAMP_STEPS = 72;
    /// Denominator of the emission multiplier: multiplier = numerator / 12.
    uint256 internal constant MULT_DENOM = 12;
    /// Emission multiplier numerator once the ramp has plateaued (2.0x).
    uint256 internal constant PLATEAU_NUMERATOR = 24;
    /// `sum(12 + s)` for `s` in `0..12` — the ramp's multiplier-numerator sum.
    uint256 internal constant RAMP_NUMERATOR_SUM = 210;
    /// Periods in one 2-hour emission step: `7_200 / 1_200`.
    uint256 internal constant PERIODS_PER_EMISSION_STEP = 6;
    /// Periods in one 1-hour tenure step: `3_600 / 1_200`.
    uint256 internal constant PERIODS_PER_TENURE_STEP = 3;
    /// Default total period-units for the full 14-day program.
    /// Ramp (1 day): `PERIODS_PER_EMISSION_STEP * RAMP_NUMERATOR_SUM / MULT_DENOM`
    ///             = `6 * 210 / 12 = 105`.
    /// Plateau (13 days): `13 * 72 * 2 = 1_872`. Total: `105 + 1_872 = 1_977`.
    /// Pools with a shorter duration derive their own denom via
    /// `denomForDuration`.
    uint256 internal constant DENOM = 1_977;
    /// Default program duration in days. Pools may choose 1..=MAX_DURATION_DAYS.
    uint256 internal constant DURATION_DAYS = 14;
    /// Maximum selectable pool duration in days.
    uint256 internal constant MAX_DURATION_DAYS = 30;
    /// Minimum selectable pool duration in days.
    uint256 internal constant MIN_DURATION_DAYS = 1;
    /// Hourly checkpoint slots. Must exceed the largest boundary index any
    /// position can read: a 30-day pool reaches 30*24 = 720 hourly boundaries,
    /// and a position's checkpoint read index is `depositBoundaryIndex +
    /// min(k,72)` (up to ~720 + 72 = 792). Sized to 816 (720 + 72 + 24 buffer)
    /// so accrual stays exact for the full 30-day maximum.
    uint256 internal constant CHECKPOINT_CAPACITY = 816;
    /// Cohort-maturity slots: `CHECKPOINT_CAPACITY + 72 + 8` buffer.
    uint256 internal constant MATURING_CAPACITY = 896;
    /// Fixed-point scale for the accumulated-reward-per-weight accumulator `A`.
    uint256 internal constant ACC_SCALE = 1e18;
    /// Basis points denominator.
    uint256 internal constant BPS = 10_000;
    /// Seconds per day.
    uint256 internal constant SECONDS_PER_DAY = 86_400;
    /// Suggested `max_steps` per crank call.
    uint256 internal constant DEFAULT_MAX_CRANK_STEPS = 250;

    // -------------------------------------------------------------------------
    // Emission (crates/staking-math/src/emission.rs)
    // -------------------------------------------------------------------------

    /// Multiplier numerator for emission `step`; denominator is `MULT_DENOM`.
    /// step 0 -> 12 (1.0x), step 11 -> 23, step >= 12 -> 24 (2.0x plateau).
    /// Note the cap is `min(step, 12)`, NOT `min(step, 11)`.
    function emissionMultNumerator(uint256 step) internal pure returns (uint256) {
        uint256 capped = step > EMISSION_RAMP_STEPS ? EMISSION_RAMP_STEPS : step;
        return MULT_DENOM + capped;
    }

    /// Emission multiplier in basis points: 10_000 = 1.0x, 20_000 = 2.0x.
    function emissionMultBps(uint256 step) internal pure returns (uint256) {
        return (emissionMultNumerator(step) * BPS) / MULT_DENOM;
    }

    /// Total emission for one complete 2-hour step, in base units.
    function emissionForStep(uint256 baseRate, uint256 step) internal pure returns (uint256) {
        return (baseRate * PERIODS_PER_EMISSION_STEP * emissionMultNumerator(step)) / MULT_DENOM;
    }

    /// Cumulative emission numerator over `elapsed` seconds, counting only whole
    /// 20-minute periods. Units are period-units x MULT_DENOM.
    function cumulativeNumerator(uint256 elapsed) internal pure returns (uint256) {
        uint256 periods = elapsed / PERIOD_SECONDS;
        uint256 fullSteps = periods / PERIODS_PER_EMISSION_STEP;
        uint256 remPeriods = periods % PERIODS_PER_EMISSION_STEP;
        uint256 rampSteps = EMISSION_RAMP_STEPS;

        uint256 stepsTotal;
        if (fullSteps <= rampSteps) {
            // sum_{s=0}^{f-1} 6 * (12 + s) = 6 * (12f + f(f-1)/2)
            uint256 triangular = fullSteps == 0 ? 0 : (fullSteps * (fullSteps - 1)) / 2;
            stepsTotal = PERIODS_PER_EMISSION_STEP * (MULT_DENOM * fullSteps + triangular);
        } else {
            uint256 ramp = PERIODS_PER_EMISSION_STEP * RAMP_NUMERATOR_SUM;
            uint256 plateauSteps = fullSteps - rampSteps;
            uint256 plateau = PERIODS_PER_EMISSION_STEP * PLATEAU_NUMERATOR * plateauSteps;
            stepsTotal = ramp + plateau;
        }

        uint256 partialUnits = remPeriods * emissionMultNumerator(fullSteps);
        return stepsTotal + partialUnits;
    }

    /// Cumulative emission over `elapsed` seconds since start, in base units.
    /// Flooring happens once here, against the cumulative total.
    function cumulativeEmitted(uint256 baseRate, uint256 elapsed) internal pure returns (uint256) {
        return (baseRate * cumulativeNumerator(elapsed)) / MULT_DENOM;
    }

    /// Emission between two elapsed offsets. `to` must be >= `from`.
    function emissionBetween(uint256 baseRate, uint256 from, uint256 to) internal pure returns (uint256) {
        require(to >= from, "MATH: reversed range");
        return cumulativeEmitted(baseRate, to) - cumulativeEmitted(baseRate, from);
    }

    /// Remaining period-units (MULT_DENOM-scaled) from `elapsed` to program end.
    /// At t=0 this equals `DENOM * MULT_DENOM = 23_724`.
    function remainingPeriodUnits(uint256 elapsed) internal pure returns (uint256) {
        return remainingPeriodUnitsFor(elapsed, DURATION_DAYS);
    }

    /// Derive the base emission rate: `funded / DENOM` (floored).
    function deriveBaseRate(uint256 funded) internal pure returns (uint256) {
        return funded / DENOM;
    }

    // ---- Duration-parameterized variants (1..=30 days) --------------------
    //
    // The emission SHAPE is fixed: a 1-day ramp (1.0x -> 2.0x over twelve 2-hour
    // steps) followed by a flat 2.0x plateau to the end. Only the plateau length
    // flexes with the chosen duration. `cumulativeNumerator` already computes the
    // correct value for any elapsed time (partial ramp, full ramp, plateau), so a
    // pool's total denom is simply the cumulative numerator at its end time.
    //
    // For durations < 1 day the ramp is truncated (the schedule ends mid-ramp);
    // the math still holds — such a pool simply never reaches the 2.0x emission
    // multiplier. Minimum selectable duration is 1 day.

    /// Total program period-units (MULT_DENOM-scaled) for a given duration.
    /// For 14 days this equals `DENOM * MULT_DENOM = 23_724`.
    function totalNumeratorForDuration(uint256 durationDays) internal pure returns (uint256) {
        return cumulativeNumerator(durationDays * SECONDS_PER_DAY);
    }

    /// The per-pool denom (period-units, i.e. MULT_DENOM-divided) for a duration.
    /// For 14 days this equals DENOM (1_977). Used as `funded / denom` base rate.
    function denomForDuration(uint256 durationDays) internal pure returns (uint256) {
        return totalNumeratorForDuration(durationDays) / MULT_DENOM;
    }

    /// Remaining period-units (MULT_DENOM-scaled) from `elapsed` to the end of a
    /// program of `durationDays`.
    function remainingPeriodUnitsFor(uint256 elapsed, uint256 durationDays)
        internal
        pure
        returns (uint256)
    {
        uint256 total = totalNumeratorForDuration(durationDays);
        uint256 soFar = cumulativeNumerator(elapsed);
        // Past the end, nothing remains (avoid underflow for elapsed > duration).
        return soFar >= total ? 0 : total - soFar;
    }

    /// Derive the base emission rate for a pool of `durationDays`:
    /// `funded / denomForDuration(durationDays)` (floored).
    function deriveBaseRateForDuration(uint256 funded, uint256 durationDays)
        internal
        pure
        returns (uint256)
    {
        return funded / denomForDuration(durationDays);
    }

    // -------------------------------------------------------------------------
    // Weight (crates/staking-math/src/weight.rs)
    // -------------------------------------------------------------------------

    /// Tenure steps elapsed, capped at TENURE_RAMP_STEPS.
    function cappedSteps(uint256 steps) internal pure returns (uint256) {
        return steps > TENURE_RAMP_STEPS ? TENURE_RAMP_STEPS : steps;
    }

    /// Weight numerator: `72 + min(k, 72)`, ranging 72..=144.
    function weightNumerator(uint256 steps) internal pure returns (uint256) {
        return TENURE_RAMP_STEPS + cappedSteps(steps);
    }

    /// Position weight: `stake * (72 + min(k, 72))`.
    function weight(uint256 stake, uint256 steps) internal pure returns (uint256) {
        return stake * weightNumerator(steps);
    }

    /// Tenure multiplier in basis points: 10_000 = 1.0x, 20_000 = 2.0x.
    function tenureMultBps(uint256 steps) internal pure returns (uint256) {
        return (weightNumerator(steps) * BPS) / TENURE_RAMP_STEPS;
    }

    /// Stake-weighted average deposit timestamp (anti-gaming). Floors.
    /// ts_new = (stake_old * ts_old + added * now) / (stake_old + added)
    function weightedDepositTs(
        uint256 stakeOld,
        uint256 tsOld,
        uint256 added,
        uint256 nowTs
    ) internal pure returns (uint256) {
        uint256 total = stakeOld + added;
        if (total == 0) {
            return nowTs;
        }
        uint256 num = stakeOld * tsOld + added * nowTs;
        return num / total;
    }

    // -------------------------------------------------------------------------
    // Accrual (crates/staking-math/src/accrual.rs)
    // -------------------------------------------------------------------------

    /// Snapshot carried by a position to make accrual O(1).
    struct Snapshot {
        uint256 acc; // `A` at the last settlement
        uint256 sumAcc; // `G_{n0 + k}` boundary-sum baseline at last settlement
        uint256 k; // tenure step at last settlement
    }

    /// The bracket term, in ACC_SCALE-scaled reward-per-stake units.
    /// `k` is the current tenure step (uncapped; capped internally).
    /// `gK` is `G_{n0+min(k,72)}`; `snap.sumAcc` is `G_{n0+snap.k}`.
    function accrualBracket(
        Snapshot memory snap,
        uint256 k,
        uint256 accNow,
        uint256 gK
    ) internal pure returns (uint256) {
        uint256 kNow = cappedSteps(k);
        uint256 kSnap = cappedSteps(snap.k);
        require(kNow >= kSnap, "MATH: tenure went backwards");

        uint256 coeffNow = TENURE_RAMP_STEPS + kNow;
        uint256 coeffSnap = TENURE_RAMP_STEPS + kSnap;

        uint256 grown = coeffNow * accNow;
        uint256 base = coeffSnap * snap.acc;
        uint256 boundaryCorrection = gK - snap.sumAcc;

        // grown - base - boundaryCorrection (each subtraction is checked)
        return (grown - base) - boundaryCorrection;
    }

    /// Reward accrued by a position since its last settlement, in base units.
    function accrual(
        uint256 stake,
        Snapshot memory snap,
        uint256 k,
        uint256 accNow,
        uint256 gK
    ) internal pure returns (uint256) {
        if (stake == 0) {
            return 0;
        }
        uint256 bracket = accrualBracket(snap, k, accNow, gK);
        return (stake * bracket) / ACC_SCALE;
    }

    /// Advance `A` by one interval's emission spread over `totalWeight`.
    /// A zero-weight or zero-emission interval returns zero.
    function advanceAcc(uint256 emission, uint256 totalWeight) internal pure returns (uint256) {
        if (totalWeight == 0 || emission == 0) {
            return 0;
        }
        return (emission * ACC_SCALE) / totalWeight;
    }
}
