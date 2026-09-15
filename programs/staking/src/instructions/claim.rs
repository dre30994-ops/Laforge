use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StakingError;
use crate::state::{Pool, Schedule, StakePosition};

/// Claim accumulated rewards without touching tenure or principal.
///
/// Settles any accrued rewards into pending_rewards, then transfers the
/// full pending amount from reward_vault to the user's token account.
/// Claiming never resets tenure. Double-claim pays zero.
pub fn handler(ctx: Context<Claim>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let schedule = ctx.accounts.schedule.load()?;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;

    require!(pool.started, StakingError::NotStarted);

    // Staleness check (claim is allowed while paused, so no pause check).
    let elapsed_since_update = now.saturating_sub(pool.last_update_ts);
    require!(
        elapsed_since_update < pool.tenure_step_seconds as i64,
        StakingError::PoolStale
    );

    // Settle pending rewards using the O(1) formula.
    let accrued = compute_pending(pool, position, &schedule)?;
    position.pending_rewards = position
        .pending_rewards
        .checked_add(accrued as u64)
        .ok_or(error!(StakingError::Overflow))?;

    // Re-snapshot without changing tenure. The baseline written here MUST be the
    // same g_k that compute_pending reads for this k, or a repeat claim would
    // pay out again (AUDIT.md H-1). write_snapshot enforces that consistency.
    let k_now = tenure_steps(pool, position, now);
    write_snapshot(pool, &schedule, position, k_now);

    // Transfer pending rewards to the user.
    let payout = position.pending_rewards;
    if payout == 0 {
        return Ok(());
    }

    // PDA signer seeds for the pool (vault authority).
    let mint_key = pool.mint;
    let pool_bump = pool.bump;

    // Update bookkeeping before CPI.
    position.pending_rewards = 0;
    position.total_claimed = position
        .total_claimed
        .checked_add(payout)
        .ok_or(error!(StakingError::Overflow))?;
    pool.total_claimed = pool
        .total_claimed
        .checked_add(payout as u128)
        .ok_or(error!(StakingError::Overflow))?;

    // Drop schedule borrow for CPI.
    drop(schedule);

    let signer_seeds: &[&[&[u8]]] = &[&[Pool::SEED, mint_key.as_ref(), &[pool_bump]]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.reward_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, payout, ctx.accounts.mint.decimals)?;

    Ok(())
}

/// Compute the tenure steps for a position at time `now`.
/// Compute the tenure steps for a position at time `now`.
fn tenure_steps(pool: &Pool, position: &StakePosition, now: i64) -> u64 {
    crate::instructions::accrual_helpers::tenure_steps(pool, position, now)
}

use crate::instructions::accrual_helpers::{compute_pending, write_snapshot};

#[derive(Accounts)]
pub struct Claim<'info> {
    /// The staker (position owner).
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = mint,
        has_one = reward_vault,
        has_one = schedule,
        seeds = [Pool::SEED, mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        has_one = owner,
        has_one = pool,
        seeds = [StakePosition::SEED, pool.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,

    /// The Schedule account (read-only for G lookups).
    pub schedule: AccountLoader<'info, Schedule>,

    /// Reward vault PDA (pool is authority).
    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// The staking/reward mint.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The user's token account to receive rewards.
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}


