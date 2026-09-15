use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StakingError;
use crate::state::Pool;

/// Fund the reward pool. Admin push path.
///
/// Pre-start: simply accumulates `funded_amount`.
/// Post-start: requires the pool to be cranked current, then re-prices the
/// remaining schedule upward. The 14-day end date never moves; only the rate
/// changes.
pub fn handler(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let mint_decimals = ctx.accounts.mint.decimals;

    // Only the designated operator may fund the reward pool.
    require_keys_eq!(
        ctx.accounts.authority.key(),
        pool.operator,
        StakingError::NotOperator
    );

    // --- Balance-delta accounting (handles fee-bearing mints) ---
    let balance_before = ctx.accounts.reward_vault.amount;

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.authority_token_account.to_account_info(),
        to: ctx.accounts.reward_vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        cpi_accounts,
    );
    token_interface::transfer_checked(cpi_ctx, amount, mint_decimals)?;

    // Reload vault to read the actual post-transfer balance.
    ctx.accounts.reward_vault.reload()?;
    let balance_after = ctx.accounts.reward_vault.amount;

    let delta = balance_after
        .checked_sub(balance_before)
        .ok_or(error!(StakingError::Overflow))?;

    require!(delta > 0, StakingError::Overflow);

    // Credit the actual received amount.
    pool.funded_amount = pool
        .funded_amount
        .checked_add(delta)
        .ok_or(error!(StakingError::Overflow))?;

    // --- Post-start re-pricing ---
    if pool.started {
        let clock = Clock::get()?;

        // The pool must be cranked current before re-pricing, or the stale
        // `total_emitted` would produce an incorrect remaining_funds figure.
        let elapsed_since_update = clock
            .unix_timestamp
            .saturating_sub(pool.last_update_ts);
        require!(
            elapsed_since_update < pool.tenure_step_seconds as i64,
            StakingError::PoolStale
        );

        // Elapsed seconds since start, capped at the program duration.
        let max_elapsed = staking_math::DURATION_DAYS * staking_math::SECONDS_PER_DAY;
        let raw_elapsed = (clock.unix_timestamp.saturating_sub(pool.start_ts)) as u64;
        let elapsed = raw_elapsed.min(max_elapsed);

        // Remaining funds = total funded - total emitted so far.
        let remaining_funds = (pool.funded_amount as u128)
            .checked_sub(pool.total_emitted)
            .ok_or(error!(StakingError::Overflow))?;

        // Remaining schedule units (MULT_DENOM-scaled). At t=0 this is 22_788.
        let remaining_units = staking_math::remaining_period_units(elapsed)
            .map_err(|_| error!(StakingError::Overflow))?;

        require!(remaining_units > 0, StakingError::Overflow);

        // new_base_rate = remaining_funds * MULT_DENOM / remaining_units
        // This is equivalent to the per-period base rate for the remaining schedule.
        let new_rate = remaining_funds
            .checked_mul(staking_math::MULT_DENOM)
            .ok_or(error!(StakingError::Overflow))?
            .checked_div(remaining_units)
            .ok_or(error!(StakingError::Overflow))?;

        // Invariant: re-pricing can only increase the rate.
        let new_rate_u64 =
            u64::try_from(new_rate).map_err(|_| error!(StakingError::Overflow))?;
        require!(
            new_rate_u64 >= pool.base_rate_per_period,
            StakingError::RateDecreased
        );

        pool.base_rate_per_period = new_rate_u64;

        msg!(
            "fund_rewards: re-priced rate {} -> {}, funded={}, remaining_funds={}",
            pool.base_rate_per_period,
            new_rate_u64,
            pool.funded_amount,
            remaining_funds
        );
    } else {
        msg!(
            "fund_rewards: pre-start accumulate, funded={}",
            pool.funded_amount
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    /// The pool authority (admin).
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
        has_one = mint,
        has_one = reward_vault,
        seeds = [Pool::SEED, mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// The reward vault PDA.
    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// The staking/reward mint.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The authority's token account to transfer from.
    #[account(mut)]
    pub authority_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The token program (SPL Token or Token-2022).
    pub token_program: Interface<'info, TokenInterface>,
}
