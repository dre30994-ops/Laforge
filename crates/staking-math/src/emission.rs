//! Global emission schedule.
//!
//! Emissions ramp linearly 1.0x -> 2.0x across twelve 6-hour steps (3 days),
//! then plateau flat for the remainder of the program.
//!
//! # Why a cumulative numerator
//!
//! Per-step emission is `18 * R0 * (12 + s) / 12`, which is *not* divisible by
//! 12 for every `s`. Flooring each interval independently would leak dust on
//! every crank and let the total drift away from 200M.
//!
//! Instead we accumulate an exact integer **numerator** (period-units x 12) and
//! floor exactly once, against the cumulative total:
//!
//! ```text
//! cumulative_emitted(t) = R0 * cumulative_numerator(t) / 12
//! ```
//!
//! Interval emission is then a difference of two cumulative values, so nothing
//! drifts, and the 14-day total lands on `R0 * 1_899` exactly because the total
//! numerator `22_788` is divisible by 12.

use crate::constants::*;
use crate::error::{Checked, MathError, MathResult};

/// Multiplier numerator for emission step `step`; denominator is [`MULT_DENOM`].
///
/// * `step` 0 -> 12 (1.0x)
/// * `step` 11 -> 23 (1.9167x, last ramp step)
/// * `step` >= 12 -> 24 (2.0x, plateau)
///
/// Note the cap is `min(step, 12)`, **not** `min(step, 11)`. Capping at 11
/// would plateau at 1.9167x and the 14-day total would fall short of 200M.
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
/// Exact: `18 * num / 12` reduces to `3 * num / 2`, and [`R0`] is even.
pub fn emission_for_step(step: u64) -> MathResult<u128> {
    R0.c_mul(PERIODS_PER_EMISSION_STEP)?
        .c_mul(emission_mult_numerator(step))?
        .c_div(MULT_DENOM)
}

/// Cumulative emission numerator over `elapsed` seconds, counting only whole
/// 20-minute periods.
///
/// Units are period-units x [`MULT_DENOM`]. Divide by 12 to get period-units.
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
pub fn cumulative_emitted(elapsed: u64) -> MathResult<u128> {
    R0.c_mul(cumulative_numerator(elapsed)?)?.c_div(MULT_DENOM)
}

/// Emission between two elapsed offsets. `to` must be >= `from`.
pub fn emission_between(from: u64, to: u64) -> MathResult<u128> {
    if to < from {
        return Err(MathError::Underflow);
    }
    cumulative_emitted(to)?.c_sub(cumulative_emitted(from)?)
}

/// Whole periods needed to emit `target` numerator units.
fn periods_for_numerator(target: u128) -> MathResult<u128> {
    let ramp_total = PERIODS_PER_EMISSION_STEP.c_mul(RAMP_NUMERATOR_SUM)?;
    let ramp_periods = PERIODS_PER_EMISSION_STEP.c_mul(EMISSION_RAMP_STEPS as u128)?;

    if target >= ramp_total {
        // Past the ramp: every further period is worth PLATEAU_NUMERATOR.
        let rest = target.c_sub(ramp_total)?;
        return ramp_periods.c_add(rest.c_div(PLATEAU_NUMERATOR)?);
    }

    // Inside the ramp: walk at most 12 steps.
    let mut consumed = 0u128;
    let mut periods = 0u128;
    for s in 0..EMISSION_RAMP_STEPS {
        let num = emission_mult_numerator(s);
        let step_total = PERIODS_PER_EMISSION_STEP.c_mul(num)?;
        if consumed.c_add(step_total)? > target {
            let leftover = target.c_sub(consumed)?;
            return periods.c_add(leftover.c_div(num)?);
        }
        consumed = consumed.c_add(step_total)?;
        periods = periods.c_add(PERIODS_PER_EMISSION_STEP)?;
    }
    Ok(periods)
}

/// Program duration in seconds that `funded` base units buys, at the fixed
/// base rate. Floors, so the pool can never be over-drawn.
///
/// This is the `funded / rate` derivation: duration is derived, never fixed at
/// init. 200,000,000 tokens yields exactly 14 days.
pub fn duration_secs_for_funding(funded: u128) -> MathResult<u64> {
    let target = funded.c_mul(MULT_DENOM)?.c_div(R0)?;
    let periods = periods_for_numerator(target)?;
    let secs = periods.c_mul(PERIOD_SECONDS as u128)?;
    u64::try_from(secs).map_err(|_| MathError::Overflow)
}

/// Emission over a whole day, 1-indexed. Convenience for the golden table.
pub fn emission_for_day(day: u64) -> MathResult<u128> {
    if day == 0 {
        return Err(MathError::Underflow);
    }
    emission_between((day - 1) * SECONDS_PER_DAY, day * SECONDS_PER_DAY)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let base = emission_for_step(0).unwrap();
        let plateau = emission_for_step(12).unwrap();
        assert_eq!(plateau, base * 2);
        assert_eq!(base, R0 * 18);
    }

    #[test]
    fn step_emission_is_exact_despite_odd_numerators() {
        // 18 * 13 / 12 = 19.5 periods worth; R0 is even so this stays exact.
        for s in 0..14 {
            let num = emission_mult_numerator(s);
            let got = emission_for_step(s).unwrap();
            assert_eq!(got * MULT_DENOM, R0 * PERIODS_PER_EMISSION_STEP * num);
        }
    }

    #[test]
    fn cumulative_counts_whole_periods_only() {
        assert_eq!(cumulative_emitted(0).unwrap(), 0);
        // Nothing accrues until the first full 20-minute period closes.
        assert_eq!(cumulative_emitted(PERIOD_SECONDS - 1).unwrap(), 0);
        assert_eq!(cumulative_emitted(PERIOD_SECONDS).unwrap(), R0);
    }

    #[test]
    fn ramp_boundary_totals_315_period_units() {
        let three_days = 3 * SECONDS_PER_DAY;
        let num = cumulative_numerator(three_days).unwrap();
        assert_eq!(num, 3_780); // 18 * 210
        assert_eq!(num / MULT_DENOM, 315); // period-units
        assert_eq!(cumulative_emitted(three_days).unwrap(), R0 * 315);
    }

    #[test]
    fn full_program_numerator_is_divisible_by_denom() {
        let num = cumulative_numerator(DURATION_DAYS * SECONDS_PER_DAY).unwrap();
        assert_eq!(num, 22_788);
        assert_eq!(num % MULT_DENOM, 0);
        assert_eq!(num / MULT_DENOM, DENOM);
    }

    #[test]
    fn two_hundred_million_buys_exactly_fourteen_days() {
        let secs = duration_secs_for_funding(TOTAL_REWARD_POOL).unwrap();
        assert_eq!(secs, DURATION_DAYS * SECONDS_PER_DAY);
        assert_eq!(secs, 1_209_600);
    }

    #[test]
    fn one_plateau_day_costs_one_days_emission() {
        let full = TOTAL_REWARD_POOL;
        let day15 = duration_secs_for_funding(full + 15_165_876_777_120).unwrap();
        assert_eq!(day15, 15 * SECONDS_PER_DAY);
    }

    /// Funding below the ramp total must resolve inside the ramp.
    #[test]
    fn partial_ramp_funding_lands_inside_ramp() {
        let ramp_total = R0 * 315;
        let secs = duration_secs_for_funding(ramp_total / 2).unwrap();
        assert!(secs < 3 * SECONDS_PER_DAY, "got {secs}");
        assert!(secs > 0);
        // And it must not over-promise.
        assert!(cumulative_emitted(secs).unwrap() <= ramp_total / 2);
    }

    #[test]
    fn emission_between_rejects_reversed_range() {
        assert_eq!(emission_between(100, 0), Err(MathError::Underflow));
    }
}
