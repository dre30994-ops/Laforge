//! Shared per-position accrual helpers.
//!
//! These were previously duplicated verbatim in `stake`, `unstake`, `claim`,
//! and `compound`. The duplication hid a real bug (see AUDIT.md H-1): the
//! re-snapshot stored the *global* boundary sum `sum_acc_at_boundaries` instead
//! of the checkpoint baseline `G_{n0 + min(k, 72)}` that `compute_pending`
//! reads back. For a matured position (k frozen at 72 while the global boundary
//! index keeps advancing) the two differ, and the boundary-correction term in
//! the accrual formula fails to telescope to zero — so a repeat settlement
//! (e.g. a second `claim` with no elapsed time) pays out again and can drain the
//! reward vault.
//!
//! Centralising the logic makes the snapshot baseline and the read-back
//! provably use the same `g_k`.

use anchor_lang::prelude::*;

use crate::error::StakingError;
use crate::state::{Pool, Schedule, StakePosition};

/// Tenure steps for a position at time `now` (capped at the maturity point).
pub fn tenure_steps(pool: &Pool, position: &StakePosition, now: i64) -> u64 {
    if position.amount == 0 {
        return 0;
    }
    let elapsed = (now.saturating_sub(position.weighted_deposit_ts)) as u64;
    let steps = elapsed / pool.tenure_step_seconds;
    steps.min(staking_math::TENURE_RAMP_STEPS)
}

/// The hourly boundary index that contains the position's weighted_deposit_ts.
pub fn tenure_boundary_index(pool: &Pool, position: &StakePosition) -> u32 {
    let offset = (position.weighted_deposit_ts.saturating_sub(pool.start_ts)) as u64;
    (offset / pool.tenure_step_seconds) as u32
}

/// The tenure step `k` implied by the pool's last cranked timestamp.
pub fn k_at_last_update(pool: &Pool, position: &StakePosition) -> u64 {
    let elapsed = (pool.last_update_ts.saturating_sub(position.weighted_deposit_ts)) as u64;
    let steps = elapsed / pool.tenure_step_seconds;
    steps.min(staking_math::TENURE_RAMP_STEPS)
}

/// The boundary-sum baseline `G_{deposit_boundary_index + min(k, 72)}`.
///
/// This is the single source of truth for the accrual baseline. It is used BOTH
/// when computing pending rewards AND when writing `sum_acc_snapshot`, so a
/// re-settlement with no elapsed time telescopes the boundary-correction term
/// to exactly zero (the double-claim fix, AUDIT.md H-1).
///
/// Falls back to the global `sum_acc_at_boundaries` only when the target
/// boundary has not been recorded yet (out of range or not yet cranked), which
/// matches the on-chain checkpoint availability.
pub fn boundary_sum_baseline(
    pool: &Pool,
    schedule: &Schedule,
    deposit_boundary_index: u32,
    k: u64,
) -> u128 {
    let g_idx = deposit_boundary_index as u64 + staking_math::capped_steps(k);
    if (g_idx as usize) < Schedule::CHECKPOINT_CAPACITY && (g_idx as u32) < pool.next_boundary_index
    {
        schedule.checkpoints[g_idx as usize].sum_acc
    } else {
        pool.sum_acc_at_boundaries
    }
}

/// Compute pending rewards accrued since the position's last settlement, using
/// the O(1) accrual formula. Reads the baseline via [`boundary_sum_baseline`].
pub fn compute_pending(
    pool: &Pool,
    position: &StakePosition,
    schedule: &Schedule,
) -> Result<u128> {
    if position.amount == 0 {
        return Ok(0);
    }

    let stake = position.amount as u128;
    let k_now = k_at_last_update(pool, position);

    let snap = staking_math::Snapshot {
        acc: position.acc_snapshot,
        sum_acc: position.sum_acc_snapshot,
        k: position.snapshot_k as u64,
    };

    let g_k = boundary_sum_baseline(pool, schedule, position.deposit_boundary_index, k_now);

    staking_math::accrual(stake, &snap, k_now, pool.acc_reward_per_weight, g_k)
        .map_err(|_| error!(StakingError::Overflow))
}

/// Write a position's snapshot at tenure step `k`, using the consistent
/// boundary baseline. Callers must have already set
/// `position.deposit_boundary_index` to the value they want the baseline keyed
/// on (the deposit boundary for stake/compound; the current boundary for a
/// k=0 reset in unstake).
pub fn write_snapshot(
    pool: &Pool,
    schedule: &Schedule,
    position: &mut StakePosition,
    k: u64,
) {
    position.snapshot_k = k as u32;
    position.acc_snapshot = pool.acc_reward_per_weight;
    position.sum_acc_snapshot =
        boundary_sum_baseline(pool, schedule, position.deposit_boundary_index, k);
}
