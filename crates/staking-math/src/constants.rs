//! Economic constants for the 14-day liquidity-bootstrap farm.
//!
//! All token amounts are in **base units**. The figures here assume 6 decimals
//! (pump.fun standard); the on-chain program reads decimals from the mint at
//! init, so only [`MIN_STAKE`] and [`MIN_FUNDING`] need adjusting for a
//! different mint.
//!
//! # Exactness
//!
//! The whole schedule is built so the arithmetic is integer-exact:
//!
//! * A 6-hour emission step spans exactly `21_600 / 1_200 = 18` periods.
//! * The 3-day ramp sums to exactly `18 * 210 / 12 = 315` period-units.
//! * The 11-day plateau adds `792 * 2 = 1_584` period-units.
//! * Total: `315 + 1_584 = 1_899` = [`DENOM`] period-units.
//!
//! Keeping the emission ramp on 6-hour steps is load-bearing. Moving it to
//! hourly steps would give `DENOM = 1906.5`, a non-integer, destroying this
//! property. Tenure is separately on hourly steps, which is fine because the
//! tenure `/72` cancels in every share computation.
//!
//! # Discretionary funding model
//!
//! The base emission rate `r₀` is **not** a compile-time constant. It is
//! derived at `start_pool` as `funded ÷ DENOM`, and re-derived on each top-up.
//! The 14-day end date is fixed at start and never moves; top-ups only raise
//! the rate.

use crate::error::{Checked, MathResult};

/// One emission period: 20 minutes. 72 periods per day.
pub const PERIOD_SECONDS: u64 = 1_200;

/// One global emission step: 6 hours.
pub const EMISSION_STEP_SECONDS: u64 = 21_600;

/// Ramping emission steps: 12 x 6h = 3 days, linear 1.0x -> 2.0x.
pub const EMISSION_RAMP_STEPS: u64 = 12;

/// One per-user tenure step: 1 hour.
pub const TENURE_STEP_SECONDS: u64 = 3_600;

/// Tenure steps to reach the 2.0x cap: 72 x 1h = 3 days.
pub const TENURE_RAMP_STEPS: u64 = 72;

/// Denominator of the emission multiplier: multiplier = numerator / 12.
///
/// Numerator is `12 + min(step, 12)`: step 0 -> 12 (1.0x), step 11 -> 23,
/// step >= 12 -> 24 (2.0x plateau).
pub const MULT_DENOM: u128 = 12;

/// Emission multiplier numerator once the ramp has plateaued (2.0x).
pub const PLATEAU_NUMERATOR: u128 = 24;

/// `sum(12 + s)` for `s` in `0..12` — the ramp's multiplier-numerator sum.
pub const RAMP_NUMERATOR_SUM: u128 = 210;

/// Periods in one 6-hour emission step: `21_600 / 1_200`.
pub const PERIODS_PER_EMISSION_STEP: u128 = 18;

/// Periods in one 1-hour tenure step: `3_600 / 1_200`.
pub const PERIODS_PER_TENURE_STEP: u128 = 3;

/// Total period-units across the full 14-day program: `315 + 1_584`.
///
/// The base rate is derived as `r₀ = funded ÷ DENOM`. Dust per single
/// funding event is exactly `funded mod DENOM`.
pub const DENOM: u128 = 1_899;

/// Nominal program duration in days.
pub const DURATION_DAYS: u64 = 14;

/// Hourly checkpoint slots: 16 days of hourly boundaries (with buffer over
/// the fixed 336 needed for 14 days).
///
/// Full history, absolute indexing. **Not** a ring buffer.
pub const CHECKPOINT_CAPACITY: usize = 384;

/// Cohort-maturity slots: `384 + 72 + 8` buffer, so a deposit landing in the
/// last checkpoint bucket still has an in-bounds maturity index.
pub const MATURING_CAPACITY: usize = 464;

/// Default minimum stake: 35,000 tokens at 6 decimals. Admin-adjustable,
/// enforced on deposits only.
pub const MIN_STAKE: u128 = 35_000_000_000;

/// Minimum funding to activate (start) a pool: 10,000,000 tokens at 6 decimals.
pub const MIN_FUNDING: u128 = 10_000_000_000_000;

/// Fixed-point scale for the accumulated-reward-per-weight accumulator `A`.
pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000;

/// Basis points denominator, for reporting multipliers to the UI.
pub const BPS: u128 = 10_000;

pub const SECONDS_PER_DAY: u64 = 86_400;

/// Suggested `max_steps` per crank transaction.
///
/// At roughly 300 CU per iteration, a full 384-boundary catch-up is about
/// 115k CU, so two transactions at 250 steps each covers worst-case.
pub const DEFAULT_MAX_CRANK_STEPS: u64 = 250;

/// Derive the base emission rate from the funded amount.
///
/// `r₀ = funded ÷ DENOM` base units per 20-minute period.
///
/// Dust (the unreachable remainder) is `funded mod DENOM`.
#[inline]
pub fn derive_base_rate(funded: u128) -> MathResult<u128> {
    funded.c_div(DENOM)
}

/// Compute the dust (unreachable remainder) for a given funding amount.
#[inline]
pub fn emission_dust(funded: u128) -> u128 {
    funded % DENOM
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_lengths_divide_period_evenly() {
        assert_eq!(
            EMISSION_STEP_SECONDS as u128 / PERIOD_SECONDS as u128,
            PERIODS_PER_EMISSION_STEP
        );
        assert_eq!(
            TENURE_STEP_SECONDS as u128 / PERIOD_SECONDS as u128,
            PERIODS_PER_TENURE_STEP
        );
        assert_eq!(EMISSION_STEP_SECONDS % PERIOD_SECONDS, 0);
        assert_eq!(TENURE_STEP_SECONDS % PERIOD_SECONDS, 0);
    }

    #[test]
    fn ramp_numerator_sum_is_210() {
        let sum: u128 = (0..EMISSION_RAMP_STEPS)
            .map(|s| MULT_DENOM + s as u128)
            .sum();
        assert_eq!(sum, RAMP_NUMERATOR_SUM);
    }

    /// ramp 315 + plateau 1_584 == DENOM 1_899, in period-units.
    #[test]
    fn denom_decomposes_into_ramp_and_plateau() {
        let ramp_period_units = PERIODS_PER_EMISSION_STEP * RAMP_NUMERATOR_SUM / MULT_DENOM;
        assert_eq!(ramp_period_units, 315);

        let plateau_days = DURATION_DAYS as u128 - 3;
        let periods_per_day = SECONDS_PER_DAY as u128 / PERIOD_SECONDS as u128;
        assert_eq!(periods_per_day, 72);
        let plateau_period_units = plateau_days * periods_per_day * 2;
        assert_eq!(plateau_period_units, 1_584);

        assert_eq!(ramp_period_units + plateau_period_units, DENOM);
    }

    #[test]
    fn derive_base_rate_for_known_deposits() {
        // 10M tokens at 6 decimals
        let r0_10m = derive_base_rate(10_000_000_000_000).unwrap();
        assert_eq!(r0_10m, 5_265_929_436);

        // 50M tokens at 6 decimals
        let r0_50m = derive_base_rate(50_000_000_000_000).unwrap();
        assert_eq!(r0_50m, 26_329_647_182);

        // 200M tokens at 6 decimals
        let r0_200m = derive_base_rate(200_000_000_000_000).unwrap();
        assert_eq!(r0_200m, 105_318_588_730);
    }

    #[test]
    fn dust_is_funded_mod_denom() {
        assert_eq!(emission_dust(10_000_000_000_000), 10_000_000_000_000 % DENOM);
        assert_eq!(emission_dust(200_000_000_000_000), 200_000_000_000_000 % DENOM);
        // For 200M: dust = 200_000_000_000_000 mod 1_899 = 1_730
        assert_eq!(emission_dust(200_000_000_000_000), 1_730);
    }

    #[test]
    fn maturing_capacity_covers_last_bucket() {
        let last = CHECKPOINT_CAPACITY as u64 - 1;
        let maturity = last + TENURE_RAMP_STEPS;
        assert_eq!(maturity, 455);
        assert!((maturity as usize) < MATURING_CAPACITY);
    }

    #[test]
    fn min_funding_derives_a_nonzero_rate() {
        let r0 = derive_base_rate(MIN_FUNDING).unwrap();
        assert!(r0 > 0);
    }
}
