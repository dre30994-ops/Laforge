use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StakingError;
use crate::state::{Pool, Schedule, StakePosition};

/// Unstake tokens. Partial or full withdrawal.
///
/// Effects:
/// 1. Settle pending rewards.
/// 2. Full tenure reset to 1.0x (weighted_deposit_ts = now).
/// 3. Remove old weight and cohort entry.
/// 4. Transfer from stake_vault to user.
/// 5. Re-register at 1.0x weight if position remains non-zero.
///
/// Unstake is always allowed, even while paused. No minimum stake enforcement
/// on withdrawal — users can exit to zero.
pub fn handler(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Phase 1: settle and update state (needs schedule borrow).
    let new_amount = {
        let schedule = ctx.accounts.schedule.load()?;
        let pool = &mut ctx.accounts.pool;
        let position = &mut ctx.accounts.position;

        require!(pool.started, StakingError::NotStarted);
        require!(amount > 0, StakingError::Overflow);
        require!(amount <= position.amount, StakingError::Overflow);

        // Staleness check.
        let elapsed_since_update = now.saturating_sub(pool.last_update_ts);
        require!(
            elapsed_since_update < pool.tenure_step_seconds as i64,
            StakingError::PoolStale
        );

        // Settle pending.
        let accrued = compute_pending(pool, position, &schedule)?;
        position.pending_rewards = position
            .pending_rewards
            .checked_add(accrued as u64)
            .ok_or(error!(StakingError::Overflow))?;

        // Remove old weight.
        let old_amount = position.amount as u128;
        let old_k = tenure_steps(pool, position, now);
        let old_weight = old_amount
            .checked_mul(staking_math::weight_numerator(old_k))
            .ok_or(error!(StakingError::Overflow))?;
        pool.total_weight = pool
            .total_weight
            .checked_sub(old_weight)
            .ok_or(error!(StakingError::Overflow))?;

        if old_k < staking_math::TENURE_RAMP_STEPS {
            pool.ramping_stake = pool
                .ramping_stake
                .checked_sub(old_amount)
                .ok_or(error!(StakingError::Overflow))?;
        }

        // Update position amount and pool totals.
        let new_amount = position
            .amount
            .checked_sub(amount)
            .ok_or(error!(StakingError::Overflow))?;
        position.amount = new_amount;
        pool.total_staked = pool
            .total_staked
            .checked_sub(amount as u128)
            .ok_or(error!(StakingError::Overflow))?;

        // Record the timestamp. While stake remains, this keeps advancing (pool
        // active); when this unstake empties the pool, it marks the start of the
        // 3h empty-sweep window.
        pool.last_nonzero_stake_ts = now;

        // Full tenure reset.
        position.weighted_deposit_ts = now;

        new_amount
        // schedule borrow dropped here
    };

    // Phase 2: CPI transfers (no schedule borrow needed).
    //
    // A 5% tax is taken from the unstaked principal and sent to the treasury.
    // The floored remainder goes to the user. Flooring the tax favors the user
    // (the treasury never receives more than 5%).
    let mint_key = ctx.accounts.pool.mint;
    let pool_bump = ctx.accounts.pool.bump;
    let decimals = ctx.accounts.mint.decimals;
    let signer_seeds: &[&[&[u8]]] = &[&[Pool::SEED, mint_key.as_ref(), &[pool_bump]]];

    // tax = amount * 500 / 10_000, floored. user_amount = amount - tax.
    let tax = (amount as u128)
        .checked_mul(crate::UNSTAKE_TAX_BPS as u128)
        .ok_or(error!(StakingError::Overflow))?
        .checked_div(crate::BPS_DENOM as u128)
        .ok_or(error!(StakingError::Overflow))? as u64;
    let user_amount = amount
        .checked_sub(tax)
        .ok_or(error!(StakingError::Overflow))?;

    // Transfer the post-tax principal to the user.
    if user_amount > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.stake_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_ctx, user_amount, decimals)?;
    }

    // Transfer the 5% tax to the treasury token account.
    if tax > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.stake_vault.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_ctx, tax, decimals)?;

        msg!("unstake: tax {} routed to treasury", tax);
    }

    // Phase 3: Re-register weight if position is non-zero (needs schedule for cohort).
    {
        let mut schedule = ctx.accounts.schedule.load_mut()?;
        let pool = &mut ctx.accounts.pool;
        let position = &mut ctx.accounts.position;

        if new_amount > 0 {
            // Re-register at 1.0x (k=0).
            let new_weight = (new_amount as u128)
                .checked_mul(staking_math::weight_numerator(0))
                .ok_or(error!(StakingError::Overflow))?;
            pool.total_weight = pool
                .total_weight
                .checked_add(new_weight)
                .ok_or(error!(StakingError::Overflow))?;

            pool.ramping_stake = pool
                .ramping_stake
                .checked_add(new_amount as u128)
                .ok_or(error!(StakingError::Overflow))?;

            // Register maturity cohort.
            let current_boundary = pool.next_boundary_index.saturating_sub(1);
            let maturity_idx = current_boundary as u64 + staking_math::TENURE_RAMP_STEPS;
            if (maturity_idx as usize) < Schedule::MATURING_CAPACITY {
                schedule.maturing[maturity_idx as usize] = schedule.maturing
                    [maturity_idx as usize]
                    .checked_add(new_amount)
                    .ok_or(error!(StakingError::Overflow))?;
            }
        }

        // Snapshot at k=0 with the consistent g_0 baseline keyed on the current
        // boundary (see AUDIT.md H-1).
        position.deposit_boundary_index = pool.next_boundary_index.saturating_sub(1);
        crate::instructions::accrual_helpers::write_snapshot(pool, &schedule, position, 0);
    }

    Ok(())
}

/// Compute the tenure steps for a position at time `now`.
/// Compute the tenure steps for a position at time `now`.
fn tenure_steps(pool: &Pool, position: &StakePosition, now: i64) -> u64 {
    crate::instructions::accrual_helpers::tenure_steps(pool, position, now)
}

use crate::instructions::accrual_helpers::compute_pending;

#[derive(Accounts)]
pub struct Unstake<'info> {
    /// The staker (position owner).
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = mint,
        has_one = stake_vault,
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
    pub position: Box<Account<'info, StakePosition>>,

    #[account(mut)]
    pub schedule: AccountLoader<'info, Schedule>,

    /// Stake vault PDA (pool is authority).
    #[account(
        mut,
        seeds = [b"stake_vault", pool.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    /// The staking mint.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The user's token account to receive unstaked tokens.
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The treasury's token account, which receives the 5% unstake tax. Must be
    /// owned by the hardcoded treasury wallet and hold the pool's mint.
    #[account(
        mut,
        constraint = treasury_token_account.owner == crate::TREASURY @ StakingError::InvalidTreasury,
        constraint = treasury_token_account.mint == pool.mint @ StakingError::InvalidTreasury,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}


