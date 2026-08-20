//! O(1) per-user reward accrual.
//!
//! # Setup
//!
//! `A` is the accumulated-reward-per-unit-weight accumulator. `G_n` is the
//! running sum of `A` sampled at every hourly boundary:
//! `G_n = sum_{i=0}^{n} A_i`.
//!
//! A position's reward is `integral of weight_i(t) dA`. Since
//! `weight_i = stake * (72 + k(t))` and `k` steps up by one at each hourly
//! boundary after the deposit boundary `n0`:
//!
//! ```text
//! integral (72 + k) dA = 72*(A_now - A_s) + sum_{j=1..k} (A_now - A_{n0+j})
//!                      = (72+k)*A_now - 72*A_s - (G_{n0+k} - G_{n0})
//! ```
//!
//! No iteration over users, no iteration over steps.
//!
//! # The generalization the naive formula needs
//!
//! The form above is only valid when the snapshot was taken **at deposit**,
//! where `k = 0`. A `claim` settles mid-life, at which point the position's
//! tenure step is already `k_s > 0`. Re-snapshotting `A` while still using the
//! coefficient `72` and the baseline `G_{n0}` would double-count the tenure
//! that had already been paid for.
//!
//! Integrating from an arbitrary settle point gives the general form:
//!
//! ```text
//! accrual = stake * [ (72+k)*A_now - (72+k_s)*A_s - (G_{n0+k} - G_{n0+k_s}) ]
//! ```
//!
//! so each position must persist the tenure step at its last settlement
//! (`snapshot_k`) alongside `A_s` and `G_{n0+k_s}`. With `k_s = 0` this reduces
//! to the deposit-time form, and at `k_s = k = 72` it reduces to
//! `144 * (A_now - A_s)`, the correct constant-weight case for a matured
//! position.
//!
//! # Rounding
//!
//! The bracket is an exact integer scaled by [`ACC_SCALE`]. The single division
//! by `ACC_SCALE` floors, which favours the pool.

use crate::constants::*;
use crate::error::{Checked, MathError, MathResult};
use crate::weight::capped_steps;

/// The snapshot a position carries to make accrual O(1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Snapshot {
    /// `A` at the moment of the last settlement.
    pub acc: u128,
    /// `G_{n0 + snapshot_k}` — the boundary-sum baseline.
    pub sum_acc: u128,
    /// Tenure step at the last settlement. Zero for a fresh deposit.
    pub k: u64,
}

/// The bracket term, in [`ACC_SCALE`]-scaled reward-per-stake units.
///
/// `k` is the position's current tenure step (uncapped; capped internally).
/// `g_k` is `G_{n0+min(k,72)}`, `snap.sum_acc` is `G_{n0+snap.k}`.
pub fn accrual_bracket(snap: &Snapshot, k: u64, acc_now: u128, g_k: u128) -> MathResult<u128> {
    let k_now = capped_steps(k);
    let k_snap = capped_steps(snap.k);
    if k_now < k_snap {
        return Err(MathError::Underflow);
    }

    let coeff_now = TENURE_RAMP_STEPS as u128 + k_now as u128;
    let coeff_snap = TENURE_RAMP_STEPS as u128 + k_snap as u128;

    let grown = coeff_now.c_mul(acc_now)?;
    let base = coeff_snap.c_mul(snap.acc)?;
    let boundary_correction = g_k.c_sub(snap.sum_acc)?;

    grown.c_sub(base)?.c_sub(boundary_correction)
}

/// Reward accrued by a position since its last settlement, in base units.
pub fn accrual(stake: u128, snap: &Snapshot, k: u64, acc_now: u128, g_k: u128) -> MathResult<u128> {
    if stake == 0 {
        return Ok(0);
    }
    let bracket = accrual_bracket(snap, k, acc_now, g_k)?;
    stake.c_mul(bracket)?.c_div(ACC_SCALE)
}

/// Advance `A` by one interval's emission spread over `total_weight`.
///
/// Returns the delta applied to `A`. A zero-weight interval returns zero: the
/// caller must divert that emission to the `unallocated` counter, since
/// emissions with no stakers cannot be divided.
pub fn advance_acc(emission: u128, total_weight: u128) -> MathResult<u128> {
    if total_weight == 0 || emission == 0 {
        return Ok(0);
    }
    emission.c_mul(ACC_SCALE)?.c_div(total_weight)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The plan's hand-verified k=1 case:
    /// `stake * [73*A_now - A_1 - 72*A_0]`, with the deposit at boundary 0.
    #[test]
    fn reduces_to_verified_k1_case() {
        let a0 = 0u128; // A at deposit (boundary 0)
        let a1 = 5_000u128; // A at boundary 1
        let a_now = 9_000u128;
        let g0 = a0; // G_0 = A_0
        let g1 = g0 + a1; // G_1 = A_0 + A_1

        let snap = Snapshot {
            acc: a0,
            sum_acc: g0,
            k: 0,
        };
        let got = accrual_bracket(&snap, 1, a_now, g1).unwrap();
        let expected = 73 * a_now - 72 * a0 - a1;
        assert_eq!(got, expected);
    }

    /// A matured position must collapse to constant weight 144.
    #[test]
    fn matured_position_is_constant_weight() {
        let snap = Snapshot {
            acc: 1_000,
            sum_acc: 77_777,
            k: 72,
        };
        // g_k == snap.sum_acc because the boundary index no longer advances.
        let got = accrual_bracket(&snap, 72, 4_000, 77_777).unwrap();
        assert_eq!(got, 144 * (4_000 - 1_000));
    }

    /// Beyond the cap, extra steps must not add weight.
    #[test]
    fn cap_freezes_growth() {
        let snap = Snapshot {
            acc: 0,
            sum_acc: 0,
            k: 72,
        };
        let a = accrual_bracket(&snap, 72, 1_000, 0).unwrap();
        let b = accrual_bracket(&snap, 500, 1_000, 0).unwrap();
        assert_eq!(a, b);
    }

    /// Settling mid-life then continuing must equal one settlement over the
    /// whole span. This is the property the naive formula violates.
    #[test]
    fn split_settlement_equals_single_settlement() {
        // Boundary series: A_n = 100*n, so G_n = 100*(n*(n+1)/2).
        let a = |n: u64| 100u128 * n as u128;
        let g = |n: u64| 100u128 * (n as u128 * (n as u128 + 1) / 2);

        let stake = 1_000_000u128 * ACC_SCALE / 1_000_000; // keep it simple
        let n0 = 0u64;

        // One shot: deposit at boundary 0, settle at k = 10.
        let fresh = Snapshot {
            acc: a(0),
            sum_acc: g(0),
            k: 0,
        };
        let single = accrual(stake, &fresh, 10, a(10), g(n0 + 10)).unwrap();

        // Split: settle at k = 4, re-snapshot, then settle at k = 10.
        let first = accrual(stake, &fresh, 4, a(4), g(n0 + 4)).unwrap();
        let mid = Snapshot {
            acc: a(4),
            sum_acc: g(n0 + 4),
            k: 4,
        };
        let second = accrual(stake, &mid, 10, a(10), g(n0 + 10)).unwrap();

        assert_eq!(first + second, single, "claiming must not change total pay");
    }

    #[test]
    fn zero_stake_accrues_nothing() {
        let snap = Snapshot::default();
        assert_eq!(accrual(0, &snap, 50, 12_345, 0).unwrap(), 0);
    }

    #[test]
    fn advance_acc_handles_empty_pool() {
        assert_eq!(advance_acc(1_000, 0).unwrap(), 0);
        assert_eq!(advance_acc(0, 1_000).unwrap(), 0);
    }

    #[test]
    fn advance_acc_floors_in_pool_favour() {
        // 10 emission over weight 3 -> 3.33 per weight, floored.
        let d = advance_acc(10, 3).unwrap();
        assert_eq!(d, 10 * ACC_SCALE / 3);
        assert!(d * 3 <= 10 * ACC_SCALE);
    }

    #[test]
    fn going_backwards_in_tenure_is_rejected() {
        let snap = Snapshot {
            acc: 0,
            sum_acc: 0,
            k: 10,
        };
        assert_eq!(
            accrual_bracket(&snap, 5, 1_000, 0),
            Err(MathError::Underflow)
        );
    }
}
