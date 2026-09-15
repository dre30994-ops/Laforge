use anchor_lang::prelude::*;

/// A user's staking position within a pool.
///
/// PDA seeded `["position", pool.key(), owner.key()]`.
/// One position per user per pool.
#[account]
#[derive(InitSpace)]
pub struct StakePosition {
    /// The position owner (staker).
    pub owner: Pubkey,
    /// The pool this position belongs to.
    pub pool: Pubkey,

    /// Current staked amount in base units.
    pub amount: u64,

    /// Stake-weighted average deposit timestamp (anti-gaming).
    ///
    /// `ts_new = (stake_old * ts_old + added * now) / (stake_old + added)`.
    /// Defeats the "stake 1 token, wait 3 days, then dump at 2.0x" attack.
    pub weighted_deposit_ts: i64,

    /// Hourly boundary index containing `weighted_deposit_ts`.
    ///
    /// Used to look up G_{n0+k} in the Schedule for accrual computation.
    pub deposit_boundary_index: u32,

    /// Tenure step at last settlement (0 for fresh deposit, up to 72 at cap).
    pub snapshot_k: u32,

    /// `A` at the moment of last settlement.
    pub acc_snapshot: u128,
    /// `G_{n0 + snapshot_k}` at the moment of last settlement.
    pub sum_acc_snapshot: u128,

    /// Accumulated rewards not yet claimed.
    pub pending_rewards: u64,
    /// Lifetime rewards claimed by this position.
    pub total_claimed: u64,

    /// PDA bump.
    pub bump: u8,
}

impl StakePosition {
    pub const SEED: &'static [u8] = b"position";
}
