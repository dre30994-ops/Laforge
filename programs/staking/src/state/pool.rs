use anchor_lang::prelude::*;

/// The pool account holds all global state for a single staking pool.
///
/// One pool per mint. PDA seeded `["pool", mint.key()]`.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// The pool authority (admin). Can pause, adjust min_stake, transfer authority.
    pub authority: Pubkey,
    /// The sole operator permitted to fund rewards. Hardcoded at init.
    pub operator: Pubkey,
    /// The staking/reward mint.
    pub mint: Pubkey,
    /// The token program (TokenInterface) that owns the mint.
    pub token_program: Pubkey,
    /// Vault holding staked tokens. PDA seeded `["stake_vault", pool.key()]`.
    pub stake_vault: Pubkey,
    /// Vault holding reward tokens. PDA seeded `["reward_vault", pool.key()]`.
    pub reward_vault: Pubkey,
    /// The Schedule account (zero_copy, client-allocated).
    pub schedule: Pubkey,

    // ---- timing ----

    /// Timestamp when start_pool was called. Zero until started.
    pub start_ts: i64,
    /// Fixed end: start_ts + 14 days. Zero until started.
    pub end_ts: i64,

    // ---- schedule parameters (immutable after init) ----

    /// Emission period in seconds (1_200 = 20 minutes).
    pub period_seconds: u64,
    /// Emission step size in seconds (21_600 = 6 hours).
    pub emission_step_seconds: u64,
    /// Number of emission ramp steps (12).
    pub emission_ramp_steps: u64,
    /// Tenure step size in seconds (3_600 = 1 hour).
    pub tenure_step_seconds: u64,
    /// Tenure ramp steps to reach 2.0x cap (72).
    pub tenure_ramp_steps: u64,
    /// Checkpoint capacity of the Schedule account.
    pub checkpoint_capacity: u32,
    /// Mint decimals (read from the mint at init).
    pub decimals: u8,

    // ---- funding & rate ----

    /// Minimum funding required to activate the pool (start_pool gate).
    pub min_funding: u64,
    /// Minimum stake per position (admin-adjustable, deposits only).
    pub min_stake: u64,
    /// Total tokens deposited into reward_vault and acknowledged.
    pub funded_amount: u64,
    /// Derived base emission rate: `funded_amount / DENOM` per period.
    /// Re-derived on each post-start top-up. Zero until started.
    pub base_rate_per_period: u64,

    // ---- pool lifecycle ----

    /// Whether start_pool has been called.
    pub started: bool,
    /// Admin pause flag. Blocks stake/compound; never blocks unstake/claim.
    pub paused: bool,

    // ---- aggregate state (u128 for precision) ----

    /// Total tokens currently staked across all positions.
    pub total_staked: u128,
    /// Sum of `stake_i * (72 + min(k_i, 72))` across all positions.
    pub total_weight: u128,
    /// Stake that has not yet reached the 72-step tenure cap.
    pub ramping_stake: u128,
    /// Accumulated reward per unit weight, scaled by ACC_SCALE.
    pub acc_reward_per_weight: u128,
    /// Running sum of A sampled at every hourly boundary: G_n = sum_{i=0}^{n} A_i.
    pub sum_acc_at_boundaries: u128,

    // ---- emission tracking ----

    /// Timestamp of the last crank/advance.
    pub last_update_ts: i64,
    /// Timestamp of the last moment `total_staked` was nonzero. Updated on every
    /// stake, and set to `now` on unstake. When the pool is empty, this marks the
    /// start of the 12h window after which the reward surplus may be swept to the
    /// operator.
    pub last_nonzero_stake_ts: i64,
    /// Next hourly boundary index not yet crossed.
    pub next_boundary_index: u32,

    /// Total emissions generated so far (sum of all interval emissions).
    pub total_emitted: u128,
    /// Total rewards claimed by users.
    pub total_claimed: u128,
    /// Emissions during zero-TVL intervals that couldn't be distributed.
    pub unallocated: u128,

    // ---- PDA bump ----
    pub bump: u8,
}

impl Pool {
    pub const SEED: &'static [u8] = b"pool";
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn print_pool_size() {
        eprintln!("Pool::INIT_SPACE = {}", Pool::INIT_SPACE);
        eprintln!("8 + Pool::INIT_SPACE = {}", 8 + Pool::INIT_SPACE);
        // 428 (original) + 32 (operator Pubkey) + 8 (last_nonzero_stake_ts i64) = 468
        assert_eq!(Pool::INIT_SPACE, 468);
    }
}
