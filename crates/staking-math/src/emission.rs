//! Global emission schedule.
//!
//! Emissions ramp linearly 1.0x -> 2.0x across twelve 6-hour steps (3 days),
//! then plateau flat for the remainder of the program.
//!
//! # Why a cumulative numerator
//!
//! Per-step emission is `18 * base_rate * (12 + s) / 12`, which is *not*
//! divisible by 12 for every `s`. Flooring each interval independently would
//! leak dust on every crank and let the total drift away from the pool.
//!
//! Instead we accumulate an exact integer **numerator** (period-units x 12) and
//! floor exactly once, against the cumulative total:
//!
//! ```text
//! cumulative_emitted(base_rate, t) = base_rate * cumulative_numerator(t) / 12
//! ```
//!
//! Interval emission is then a difference of two cumulative values, so nothing
//! drifts, and the 14-day total lands on `base_rate * DENOM` exactly because
//! the total numerator `22_788` is divisible by 12.
//!
//! # Discretionary funding
//!
//! `base_rate` is derived at runtime as `funded ÷ DENOM`. It is passed in to
//! every function rather than referenced as a constant. This makes the math
//! layer agnostic to the deposit size.

use crate::constants::*;
use crate::error::{Checked, MathError, MathResult};

/// Multiplier numerator for emission step `step`; denominator is [`MULT_DENOM`].
///
/// * `step` 0 -> 12 (1.0x)
/// * `step` 11 -> 23 (1.9167x, last ramp step)
/// * `step` >= 12 -> 24 (2.0x, plateau)
///
/// Note the cap is `min(step, 12)`, **not** `min(step, 11)`. Capping at 11
/// would plateau at 1.9167x and the 14-day total would fall short.
#[inline]
pub const fn emission_mult_numerator(step: u64) -> u128 {
    let capped = if step > EMISSION_RAMP_STEPS {
        EMISSION_RAMP_STEPS
    } else {
        step
    };
    MULT_DENOM + capped as u128
}

/// Emission multiplier in basis points: 10_000 = 1.0x, 20_000 = 2.0x.
#[inline]
pub const fn emission_mult_bps(step: u64) -> u128 {
    emission_mult_numerator(step) * BPS / MULT_DENOM
}

/// The emission step index that contains `elapsed` seconds since `start_ts`.
#[inline]
pub const fn emission_step_at(elapsed: u64) -> u64 {
    elapsed / EMISSION_STEP_SECONDS
}

/// Total emission for one complete 6-hour step, in base units.
///
/// Exact: `18 * num / 12` reduces to `3 * num / 2`, and when `base_rate` is
/// even the result is exact. When odd, the floor is applied once here.
pub fn emission_for_step(base_rate: u128, step: u64) -> MathResult<u128> {
    base_rate
        .c_mul(PERIODS_PER_EMISSION_STEP)?
        .c_mul(emission_mult_numerator(step))?
        .c_div(MULT_DENOM)
}

/// Cumulative emission numerator over `elapsed` seconds, counting only whole
/// 20-minute periods.
///
/// Units are period-units x [`MULT_DENOM`]. Divide by 12 to get period-units.
/// This is rate-independent: it depends only on the schedule shape.
pub fn cumulative_numerator(elapsed: u64) -> MathResult<u128> {
    let periods = (elapsed / PERIOD_SECONDS) as u128;
    let full_steps = periods / PERIODS_PER_EMISSION_STEP;
    let rem_periods = periods % PERIODS_PER_EMISSION_STEP;
    let ramp_steps = EMISSION_RAMP_STEPS as u128;

    // Numerator contributed by whole 6-hour steps.
    let steps_total = if full_steps <= ramp_steps {
        // sum_{s=0}^{f-1} 18 * (12 + s) = 18 * (12f + f(f-1)/2)
        let triangular = full_steps.c_mul(full_steps.saturating_sub(1))?.c_div(2)?;
        PERIODS_PER_EMISSION_STEP.c_mul(MULT_DENOM.c_mul(full_steps)?.c_add(triangular)?)?
    } else {
        let ramp = PERIODS_PER_EMISSION_STEP.c_mul(RAMP_NUMERATOR_SUM)?;
        let plateau_steps = full_steps.c_sub(ramp_steps)?;
        let plateau = PERIODS_PER_EMISSION_STEP
            .c_mul(PLATEAU_NUMERATOR)?
            .c_mul(plateau_steps)?;
        ramp.c_add(plateau)?
    };

    // Partial step in progress: whole periods at the current step's rate.
    let partial = rem_periods.c_mul(emission_mult_numerator(full_steps as u64))?;
    steps_total.c_add(partial)
}

/// Cumulative emission over `elapsed` seconds since `start_ts`, in base units.
///
/// A step function: increases only on 20-minute period boundaries. Flooring
/// happens once here, against the cumulative total, so interval differences
/// never drift.
pub fn cumulative_emitted(base_rate: u128, elapsed: u64) -> MathResult<u128> {
    base_rate
        .c_mul(cumulative_numerator(elapsed)?)?
        .c_div(MULT_DENOM)
}

/// Emission between two elapsed offsets. `to` must be >= `from`.
pub fn emission_between(base_rate: u128, from: u64, to: u64) -> MathResult<u128> {
    if to < from {
        return Err(MathError::Underflow);
    }
    cumulative_emitted(base_rate, to)?.c_sub(cumulative_emitted(base_rate, from)?)
}

/// Remaining period-units from `elapsed` seconds to the end of the 14-day
/// program. Used for re-pricing after top-ups.
///
/// Returns the count in MULT_DENOM-scaled units (divide by 12 for raw
/// period-units). At t=0 this equals `DENOM * MULT_DENOM = 22_788`.
pub fn remaining_period_units(elapsed: u64) -> MathResult<u128> {
    let total = cumulative_numerator(DURATION_DAYS * SECONDS_PER_DAY)?;
    let so_far = cumulative_numerator(elapsed)?;
    total.c_sub(so_far)
}

/// Emission over a whole day, 1-indexed. Convenience for golden tables.
pub fn emission_for_day(base_rate: u128, day: u64) -> MathResult<u128> {
    if day == 0 {
        return Err(MathError::Underflow);
    }
    emission_between(base_rate, (day - 1) * SECONDS_PER_DAY, day * SECONDS_PER_DAY)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Use 200M for backward-compat validation of the math.
    const FUNDED_200M: u128 = 200_000_000_000_000;
    const R0_200M: u128 = FUNDED_200M / DENOM; // 105_318_588_730

    #[test]
    fn multiplier_numerator_ramps_then_plateaus() {
        assert_eq!(emission_mult_numerator(0), 12); // 1.0x
        assert_eq!(emission_mult_numerator(6), 18); // 1.5x
        assert_eq!(emission_mult_numerator(11), 23); // last ramp step
        assert_eq!(emission_mult_numerator(12), 24); // plateau 2.0x
        assert_eq!(emission_mult_numerator(1_000), 24); // stays flat
    }

    #[test]
    fn multiplier_bps_endpoints_are_exact() {
        assert_eq!(emission_mult_bps(0), 10_000);
        assert_eq!(emission_mult_bps(12), 20_000);
    }

    /// The plateau must be exactly 2x the base rate, or the pool never drains.
    #[test]
    fn plateau_is_exactly_double_base() {
        let base = emission_for_step(R0_200M, 0).unwrap();
        let plateau = emission_for_step(R0_200M, 12).unwrap();
        assert_eq!(plateau, base * 2);
        assert_eq!(base, R0_200M * 18);
    }

    #[test]
    fn step_emission_is_exact_despite_odd_numerators() {
        for s in 0..14 {
            let num = emission_mult_numerator(s);
            let got = emission_for_step(R0_200M, s).unwrap();
            assert_eq!(got * MULT_DENOM, R0_200M * PERIODS_PER_EMISSION_STEP * num);
        }
    }

    #[test]
    fn cumulative_counts_whole_periods_only() {
        assert_eq!(cumulative_emitted(R0_200M, 0).unwrap(), 0);
        // Nothing accrues until the first full 20-minute period closes.
        assert_eq!(cumulative_emitted(R0_200M, PERIOD_SECONDS - 1).unwrap(), 0);
        assert_eq!(cumulative_emitted(R0_200M, PERIOD_SECONDS).unwrap(), R0_200M);
    }

    #[test]
    fn ramp_boundary_totals_315_period_units() {
        let three_days = 3 * SECONDS_PER_DAY;
        let num = cumulative_numerator(three_days).unwrap();
        assert_eq!(num, 3_780); // 18 * 210
        assert_eq!(num / MULT_DENOM, 315); // period-units
        assert_eq!(
            cumulative_emitted(R0_200M, three_days).unwrap(),
            R0_200M * 315
        );
    }

    #[test]
    fn full_program_numerator_is_divisible_by_denom() {
        let num = cumulative_numerator(DURATION_DAYS * SECONDS_PER_DAY).unwrap();
        assert_eq!(num, 22_788);
        assert_eq!(num % MULT_DENOM, 0);
        assert_eq!(num / MULT_DENOM, DENOM);
    }

    #[test]
    fn remaining_period_units_at_start_equals_full_program() {
        let remaining = remaining_period_units(0).unwrap();
        assert_eq!(remaining, DENOM * MULT_DENOM);
        assert_eq!(remaining, 22_788);
    }

    #[test]
    fn remaining_period_units_at_end_is_zero() {
        let remaining = remaining_period_units(DURATION_DAYS * SECONDS_PER_DAY).unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn remaining_plus_elapsed_equals_total() {
        for hour in 0..=(DURATION_DAYS * 24) {
            let elapsed = hour * TENURE_STEP_SECONDS;
            let so_far = cumulative_numerator(elapsed).unwrap();
            let remaining = remaining_period_units(elapsed).unwrap();
            assert_eq!(so_far + remaining, 22_788, "mismatch at hour {hour}");
        }
    }

    #[test]
    fn emission_between_rejects_reversed_range() {
        assert_eq!(
            emission_between(R0_200M, 100, 0),
            Err(MathError::Underflow)
        );
    }

    /// Verify that base_rate scaling is linear: 2x deposit -> 2x emission.
    #[test]
    fn emission_scales_linearly_with_base_rate() {
        let r0_10m = derive_base_rate(10_000_000_000_000).unwrap();
        let r0_50m = derive_base_rate(50_000_000_000_000).unwrap();

        let day1_10m = emission_for_day(r0_10m, 1).unwrap();
        let day1_50m = emission_for_day(r0_50m, 1).unwrap();

        // 50M / 10M = 5x, but due to integer division in derive_base_rate
        // the ratio is only approximately 5x (off by at most DENOM base units).
        let ratio = day1_50m / day1_10m;
        assert!(ratio == 4 || ratio == 5, "ratio was {ratio}");
        // More precise: the absolute difference from exact 5x is bounded.
        let exact_5x = day1_10m * 5;
        assert!(day1_50m.abs_diff(exact_5x) < DENOM * 100);
    }
}
