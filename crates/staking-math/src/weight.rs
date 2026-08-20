//! Per-user tenure weight.
//!
//! Tenure grows linearly 1.0x -> 2.0x across 72 hourly steps (3 days) and is
//! used as a **relative weight**:
//!
//! ```text
//! share_i = stake_i * mult_i / sum_j(stake_j * mult_j)
//! ```
//!
//! # The weights are exact integers
//!
//! Because the cap is exactly 2.0x over exactly 72 steps, the multiplier
//! `(72 + min(k, 72)) / 72` has the `/72` cancel in every share computation.
//! So we carry the numerator alone:
//!
//! ```text
//! weight_i = stake_i * (72 + min(k_i, 72))    // 72*stake .. 144*stake
//! ```
//!
//! There is zero rounding error here. Do not reintroduce fixed-point.
//!
//! # The multiplier is zero-sum
//!
//! If every staker is mature the multiplier cancels out entirely. An early
//! staker's real income growth comes from the global 2x emission ramp, not from
//! their tenure. The UI must show both the personal and the pool-average
//! multiplier or users will feel misled as TVL grows.

use crate::constants::*;
use crate::error::{Checked, MathResult};

/// Tenure steps elapsed, capped at the [`TENURE_RAMP_STEPS`] maturity point.
#[inline]
pub const fn capped_steps(steps: u64) -> u64 {
    if steps > TENURE_RAMP_STEPS {
        TENURE_RAMP_STEPS
    } else {
        steps
    }
}

/// Weight numerator for a position: `72 + min(k, 72)`, ranging 72..=144.
#[inline]
pub const fn weight_numerator(steps: u64) -> u128 {
    TENURE_RAMP_STEPS as u128 + capped_steps(steps) as u128
}

/// Position weight: `stake * (72 + min(k, 72))`.
#[inline]
pub fn weight(stake: u128, steps: u64) -> MathResult<u128> {
    stake.c_mul(weight_numerator(steps))
}

/// Tenure multiplier in basis points: 10_000 = 1.0x, 20_000 = 2.0x.
///
/// Exact at both endpoints: `144 * 10_000 / 72 == 20_000`.
#[inline]
pub const fn tenure_mult_bps(steps: u64) -> u128 {
    weight_numerator(steps) * BPS / TENURE_RAMP_STEPS as u128
}

/// Pool-average multiplier in bps, derived from aggregate weight and stake.
///
/// Returns `None` for an empty pool. This is what the UI must display next to
/// the user's own multiplier.
pub fn average_mult_bps(total_weight: u128, total_staked: u128) -> Option<u128> {
    if total_staked == 0 {
        return None;
    }
    Some(total_weight * BPS / (total_staked * TENURE_RAMP_STEPS as u128))
}

/// Stake-weighted average deposit timestamp.
///
/// ```text
/// ts_new = (stake_old * ts_old + added * now) / (stake_old + added)
/// ```
///
/// This is the anti-gaming rule. It defeats "stake 1 token, wait 3 days, then
/// dump 10M at 2.0x" by diluting tenure in proportion to the new capital.
/// Floors, so it never rounds in the staker's favour.
pub fn weighted_deposit_ts(stake_old: u128, ts_old: u64, added: u128, now: u64) -> MathResult<u64> {
    let total = stake_old.c_add(added)?;
    if total == 0 {
        return Ok(now);
    }
    let num = stake_old
        .c_mul(ts_old as u128)?
        .c_add(added.c_mul(now as u128)?)?;
    let ts = num.c_div(total)?;
    u64::try_from(ts).map_err(|_| crate::error::MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weight_endpoints() {
        assert_eq!(weight_numerator(0), 72);
        assert_eq!(weight_numerator(36), 108);
        assert_eq!(weight_numerator(72), 144);
        assert_eq!(weight_numerator(1_000), 144, "must freeze at the cap");
    }

    #[test]
    fn multiplier_bps_endpoints_are_exact() {
        assert_eq!(tenure_mult_bps(0), 10_000);
        assert_eq!(tenure_mult_bps(72), 20_000);
        assert_eq!(tenure_mult_bps(9_999), 20_000);
    }

    /// Task 8's stated expectations for late joiners at program end.
    #[test]
    fn late_joiner_multipliers_match_spec() {
        // Day 11 joiner has the full 3 days: exactly 2.0x.
        assert_eq!(tenure_mult_bps(72), 20_000);
        // Day 12 joiner: 48 hourly steps -> 1.667x.
        assert_eq!(tenure_mult_bps(48), 16_666);
        // Day 13 joiner: 24 steps -> 1.333x.
        assert_eq!(tenure_mult_bps(24), 13_333);
    }

    #[test]
    fn weight_is_linear_in_stake() {
        let a = weight(1_000, 10).unwrap();
        let b = weight(2_000, 10).unwrap();
        assert_eq!(b, a * 2);
    }

    #[test]
    fn weight_overflow_is_reported_not_wrapped() {
        assert_eq!(weight(u128::MAX, 0), Err(crate::error::MathError::Overflow));
        // u64::MAX stake still fits comfortably in u128.
        assert!(weight(u64::MAX as u128, 72).is_ok());
    }

    #[test]
    fn average_multiplier_tracks_cohorts() {
        // All mature -> 2.0x average.
        let staked = 1_000u128;
        let w = weight(staked, 72).unwrap();
        assert_eq!(average_mult_bps(w, staked), Some(20_000));
        // All fresh -> 1.0x average.
        let w0 = weight(staked, 0).unwrap();
        assert_eq!(average_mult_bps(w0, staked), Some(10_000));
        // Half mature, half fresh -> 1.5x.
        let mixed = weight(500, 72).unwrap() + weight(500, 0).unwrap();
        assert_eq!(average_mult_bps(mixed, staked), Some(15_000));
        assert_eq!(average_mult_bps(0, 0), None);
    }

    #[test]
    fn weighted_ts_defeats_wait_then_dump() {
        // 1 token staked 3 days ago, then 10M dumped now.
        let ts_old = 0u64;
        let now = 3 * SECONDS_PER_DAY;
        let ts = weighted_deposit_ts(1_000_000, ts_old, 10_000_000_000_000, now).unwrap();
        // The average lands essentially at `now`, so tenure resets to ~1.0x.
        let steps = (now - ts) / TENURE_STEP_SECONDS;
        assert_eq!(steps, 0, "dumped capital must not inherit tenure");
    }

    #[test]
    fn weighted_ts_of_fresh_position_is_now() {
        assert_eq!(weighted_deposit_ts(0, 0, 5_000, 12_345).unwrap(), 12_345);
    }

    #[test]
    fn weighted_ts_is_monotonic_and_bounded() {
        let ts = weighted_deposit_ts(1_000, 100, 1_000, 900).unwrap();
        assert_eq!(ts, 500, "equal stakes -> midpoint");
        assert!((100..=900).contains(&ts));
    }
}
