use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::StakingError;
use crate::state::Pool;

/// Permissionless sync: credits any vault surplus above `funded_amount` and
/// re-prices the remaining schedule upward. Anyone can call this after a bare
/// `spl-token transfer` into the reward vault.
///
/// Pre-start: just accumulates. Post-start: requires the pool to be cranked
/// current (within one tenure step), then re-prices.
///
/// Idempotent: if the vault balance == funded_amount, this is a no-op.
pub fn handler(ctx: Context<SyncRewards>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Reload the vault to get the freshest balance.
    ctx.accounts.reward_vault.reload()?;
    let vault_balance = ctx.accounts.reward_vault.amount;

    // Surplus = tokens in the vault that we haven't accounted for yet.
    let surplus = vault_balance
        .checked_sub(pool.funded_amount)
        .unwrap_or(0);

    if surplus == 0 {
        // No new funds to credit — idempotent no-op.
        return Ok(());
    }

    // Credit the surplus.
    pool.funded_amount = pool
        .funded_amount
        .checked_add(surplus)
        .ok_or(error!(StakingError::Overflow))?;

    // --- Post-start re-pricing ---
    if pool.started {
        let clock = Clock::get()?;

        // Staleness check: pool must have been cranked current.
        let elapsed_since_update = clock
            .unix_timestamp
            .saturating_sub(pool.last_update_ts);
        require!(
            elapsed_since_update < pool.tenure_step_seconds as i64,
            StakingError::PoolStale
        );

        // Elapsed seconds since start, capped at program duration.
        let max_elapsed = staking_math::DURATION_DAYS * staking_math::SECONDS_PER_DAY;
        let raw_elapsed = (clock.unix_timestamp.saturating_sub(pool.start_ts)) as u64;
        let elapsed = raw_elapsed.min(max_elapsed);

        // Remaining funds after emissions so far.
        let remaining_funds = (pool.funded_amount as u128)
            .checked_sub(pool.total_emitted)
            .ok_or(error!(StakingError::Overflow))?;

        // Remaining schedule units (MULT_DENOM-scaled).
        let remaining_units = staking_math::remaining_period_units(elapsed)
            .map_err(|_| error!(StakingError::Overflow))?;

        require!(remaining_units > 0, StakingError::Overflow);

        // new_base_rate = remaining_funds * MULT_DENOM / remaining_units
        let new_rate = remaining_funds
            .checked_mul(staking_math::MULT_DENOM)
            .ok_or(error!(StakingError::Overflow))?
            .checked_div(remaining_units)
            .ok_or(error!(StakingError::Overflow))?;

        let new_rate_u64 =
            u64::try_from(new_rate).map_err(|_| error!(StakingError::Overflow))?;

        // Rate can only increase.
        require!(
            new_rate_u64 >= pool.base_rate_per_period,
            StakingError::RateDecreased
        );

        pool.base_rate_per_period = new_rate_u64;

        msg!(
            "sync_rewards: re-priced rate={}, surplus={}, funded={}",
            new_rate_u64,
            surplus,
            pool.funded_amount
        );
    } else {
        msg!(
            "sync_rewards: pre-start accumulate, surplus={}, funded={}",
            surplus,
            pool.funded_amount
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SyncRewards<'info> {
    /// Anyone can call sync_rewards (permissionless).
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = mint,
        has_one = reward_vault,
        seeds = [Pool::SEED, mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// The reward vault PDA (read-only for balance check).
    #[account(
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// The staking/reward mint.
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}
