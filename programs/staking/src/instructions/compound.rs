use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StakingError;
use crate::state::{Pool, Schedule, StakePosition};

/// Compound: fold pending rewards into principal.
///
/// Transfers the pending reward amount from reward_vault to stake_vault,
/// applies the same weighted-average tenure dilution as a deposit.
/// Exempt from min_stake (the position already exists).
///
/// Blocked while paused (same as stake).
pub fn handler(ctx: Context<Compound>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Phase 1: settle and determine compound amount.
    let (compound_amount, old_amount, _old_k) = {
        let schedule = ctx.accounts.schedule.load()?;
        let pool = &mut ctx.accounts.pool;
        let position = &mut ctx.accounts.position;

        require!(pool.started, StakingError::NotStarted);
        require!(!pool.paused, StakingError::Paused);

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

        let compound_amount = position.pending_rewards;
        if compound_amount == 0 {
            // Re-snapshot with the consistent baseline (AUDIT.md H-1).
            let k_now = tenure_steps(pool, position, now);
            crate::instructions::accrual_helpers::write_snapshot(pool, &schedule, position, k_now);
            return Ok(());
        }

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

        (compound_amount, old_amount, old_k)
        // schedule borrow dropped
    };

    // Phase 2: CPI transfer reward_vault -> stake_vault.
    let mint_key = ctx.accounts.pool.mint;
    let pool_bump = ctx.accounts.pool.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[Pool::SEED, mint_key.as_ref(), &[pool_bump]]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.reward_vault.to_account_info(),
        to: ctx.accounts.stake_vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, compound_amount, ctx.accounts.mint.decimals)?;

    // Phase 3: update position and re-register weight.
    {
        let mut schedule = ctx.accounts.schedule.load_mut()?;
        let pool = &mut ctx.accounts.pool;
        let position = &mut ctx.accounts.position;

        position.pending_rewards = 0;
        let new_amount = position
            .amount
            .checked_add(compound_amount)
            .ok_or(error!(StakingError::Overflow))?;

        // Weighted-average deposit timestamp (tenure dilution).
        let new_ts = staking_math::weighted_deposit_ts(
            old_amount,
            position.weighted_deposit_ts as u64,
            compound_amount as u128,
            now as u64,
        )
        .map_err(|_| error!(StakingError::Overflow))?;
        position.weighted_deposit_ts = new_ts as i64;
        position.amount = new_amount;

        // Bookkeeping.
        position.total_claimed = position
            .total_claimed
            .checked_add(compound_amount)
            .ok_or(error!(StakingError::Overflow))?;
        pool.total_claimed = pool
            .total_claimed
            .checked_add(compound_amount as u128)
            .ok_or(error!(StakingError::Overflow))?;
        pool.total_staked = pool
            .total_staked
            .checked_add(compound_amount as u128)
            .ok_or(error!(StakingError::Overflow))?;

        // Re-register with new weight.
        let new_k = tenure_steps(pool, position, now);
        let new_weight = (new_amount as u128)
            .checked_mul(staking_math::weight_numerator(new_k))
            .ok_or(error!(StakingError::Overflow))?;
        pool.total_weight = pool
            .total_weight
            .checked_add(new_weight)
            .ok_or(error!(StakingError::Overflow))?;

        if new_k < staking_math::TENURE_RAMP_STEPS {
            pool.ramping_stake = pool
                .ramping_stake
                .checked_add(new_amount as u128)
                .ok_or(error!(StakingError::Overflow))?;

            let current_boundary = pool.next_boundary_index.saturating_sub(1);
            let maturity_idx =
                current_boundary as u64 + (staking_math::TENURE_RAMP_STEPS - new_k);
            if (maturity_idx as usize) < Schedule::MATURING_CAPACITY {
                schedule.maturing[maturity_idx as usize] = schedule.maturing
                    [maturity_idx as usize]
                    .checked_add(new_amount)
                    .ok_or(error!(StakingError::Overflow))?;
            }
        }

        // Snapshot with the consistent g_k baseline (AUDIT.md H-1).
        position.deposit_boundary_index =
            crate::instructions::accrual_helpers::tenure_boundary_index(pool, position);
        crate::instructions::accrual_helpers::write_snapshot(pool, &schedule, position, new_k);
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
pub struct Compound<'info> {
    /// The staker (position owner).
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = mint,
        has_one = reward_vault,
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

    /// Reward vault PDA (pool is authority).
    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// Stake vault PDA.
    #[account(
        mut,
        seeds = [b"stake_vault", pool.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    /// The staking/reward mint.
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}


