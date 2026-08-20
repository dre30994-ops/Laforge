//! Economic constants for the 14-day liquidity-bootstrap farm.
//!
//! All token amounts are in **base units**. The figures here assume 6 decimals
//! (pump.fun standard); the on-chain program reads decimals from the mint at
//! init, so only [`R0`] and [`MIN_STAKE`] need adjusting for a different mint.
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
pub const DENOM: u128 = 1_899;

/// Base emission rate per 20-minute period, in base units at 6 decimals.
///
/// `floor(200_000_000e6 / 1_899)`. The floor is what creates the permanent
/// 1,730 base-unit dust: `1_899 * R0 = 199_999_999_998_270`.
pub const R0: u128 = 105_318_588_730;

/// Nominal reward pool: 200,000,000 tokens (20% of a 1B supply).
pub const TOTAL_REWARD_POOL: u128 = 200_000_000_000_000;

/// Base units that can never be emitted, due to the [`R0`] integer division.
pub const EMISSION_DUST: u128 = 1_730;

/// Nominal program duration in days.
pub const DURATION_DAYS: u64 = 14;

/// Hourly checkpoint slots: 30 days of hourly boundaries.
///
/// This is the hard ceiling on `end_ts` extension via top-ups.
pub const CHECKPOINT_CAPACITY: usize = 720;

/// Cohort-maturity slots: `720 + 72 + buffer`, so a deposit landing in the
/// last checkpoint bucket still has an in-bounds maturity index.
pub const MATURING_CAPACITY: usize = 800;

/// Default minimum stake: 50,000 tokens. Admin-adjustable, deposits only.
pub const MIN_STAKE: u128 = 50_000_000_000;

/// Fixed-point scale for the accumulated-reward-per-weight accumulator `A`.
pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000;

/// Basis points denominator, for reporting multipliers to the UI.
pub const BPS: u128 = 10_000;

pub const SECONDS_PER_DAY: u64 = 86_400;

/// Suggested `max_steps` per crank transaction.
///
/// A worst-case 720-boundary catch-up at roughly 300 CU per iteration is about
/// 216k CU, over the 200k default, so a full catch-up must span ~3 chained
/// transactions.
pub const DEFAULT_MAX_CRANK_STEPS: u64 = 250;

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
    fn r0_is_floor_of_pool_over_denom() {
        assert_eq!(R0, TOTAL_REWARD_POOL / DENOM);
        assert_eq!(TOTAL_REWARD_POOL - DENOM * R0, EMISSION_DUST);
    }

    #[test]
    fn maturing_capacity_covers_last_bucket() {
        let last = CHECKPOINT_CAPACITY as u64 - 1;
        let maturity = last + TENURE_RAMP_STEPS;
        assert_eq!(maturity, 791);
        assert!((maturity as usize) < MATURING_CAPACITY);
    }
}
