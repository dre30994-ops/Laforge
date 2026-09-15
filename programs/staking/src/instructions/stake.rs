use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StakingError;
use crate::state::{Pool, Schedule, StakePosition};

/// Stake tokens into the pool.
///
/// Mandatory ordering:
/// 1. Pool must be cranked current (checked, not performed here).
/// 2. Settle the position's pending rewards.
/// 3. Remove old weight + old cohort entry.
/// 4. CPI transfer, measure vault balance delta.
/// 5. Weighted-average deposit timestamp.
/// 6. Enforce min_stake on the resulting position, add new weight, snapshot A and G,
///    register in the maturity cohort.
pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Load schedule (read-only for settle; the mutable reborrow for cohort
    // registration happens after the CPI).
    let schedule = ctx.accounts.schedule.load()?;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;

    require!(pool.started, StakingError::NotStarted);
    require!(!pool.paused, StakingError::Paused);

    // Staleness check.
    let elapsed_since_update = now.saturating_sub(pool.last_update_ts);
    require!(
        elapsed_since_update < pool.tenure_step_seconds as i64,
        StakingError::PoolStale
    );

    // Initialize position fields if this is a fresh account.
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.owner.key();
        position.pool = pool.key();
        position.bump = ctx.bumps.position;
    }

    // --- Settle existing position (if any) ---
    let old_amount = position.amount as u128;
    if old_amount > 0 {
        let pending = compute_pending(pool, position, &schedule)?;
        position.pending_rewards = position
            .pending_rewards
            .checked_add(pending as u64)
            .ok_or(error!(StakingError::Overflow))?;

        // Remove old weight.
        let old_k = tenure_steps(pool, position, now);
        let old_weight = old_amount
            .checked_mul(staking_math::weight_numerator(old_k))
            .ok_or(error!(StakingError::Overflow))?;
        pool.total_weight = pool
            .total_weight
            .checked_sub(old_weight)
            .ok_or(error!(StakingError::Overflow))?;

        // If position was still ramping, remove from ramping_stake.
        if old_k < staking_math::TENURE_RAMP_STEPS {
            pool.ramping_stake = pool
                .ramping_stake
                .checked_sub(old_amount)
                .ok_or(error!(StakingError::Overflow))?;
        }
    }

    // Drop schedule borrow temporarily for the CPI.
    drop(schedule);

    // --- CPI transfer with balance-delta ---
    let balance_before = ctx.accounts.stake_vault.amount;

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.stake_vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        cpi_accounts,
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    ctx.accounts.stake_vault.reload()?;
    let balance_after = ctx.accounts.stake_vault.amount;
    let delta = balance_after
        .checked_sub(balance_before)
        .ok_or(error!(StakingError::Overflow))?;

    // Re-borrow schedule for cohort registration.
    let mut schedule = ctx.accounts.schedule.load_mut()?;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;

    // --- Weighted-average deposit timestamp ---
    let new_ts = staking_math::weighted_deposit_ts(
        old_amount,
        position.weighted_deposit_ts as u64,
        delta as u128,
        now as u64,
    )
    .map_err(|_| error!(StakingError::Overflow))?;
    position.weighted_deposit_ts = new_ts as i64;

    // New total amount.
    let new_amount = position
        .amount
        .checked_add(delta)
        .ok_or(error!(StakingError::Overflow))?;
    position.amount = new_amount;

    // --- Enforce min_stake on resulting position ---
    require!(
        new_amount as u128 >= pool.min_stake as u128,
        StakingError::BelowMinimumStake
    );

    // --- Compute new tenure steps and weight ---
    let new_k = tenure_steps(pool, position, now);
    let new_weight = (new_amount as u128)
        .checked_mul(staking_math::weight_numerator(new_k))
        .ok_or(error!(StakingError::Overflow))?;

    pool.total_weight = pool
        .total_weight
        .checked_add(new_weight)
        .ok_or(error!(StakingError::Overflow))?;
    pool.total_staked = pool
        .total_staked
        .checked_add(delta as u128)
        .ok_or(error!(StakingError::Overflow))?;

    // Pool has active stake; pin the timestamp so the 3h empty-sweep window
    // only begins once total_staked returns to zero.
    pool.last_nonzero_stake_ts = now;

    // If still ramping, register in ramping_stake and maturity cohort.
    if new_k < staking_math::TENURE_RAMP_STEPS {
        pool.ramping_stake = pool
            .ramping_stake
            .checked_add(new_amount as u128)
            .ok_or(error!(StakingError::Overflow))?;

        // Maturity boundary index = current boundary + (72 - new_k).
        let current_boundary = pool.next_boundary_index.saturating_sub(1);
        let maturity_idx = current_boundary as u64 + (staking_math::TENURE_RAMP_STEPS - new_k);
        if (maturity_idx as usize) < Schedule::MATURING_CAPACITY {
            schedule.maturing[maturity_idx as usize] = schedule.maturing[maturity_idx as usize]
                .checked_add(new_amount)
                .ok_or(error!(StakingError::Overflow))?;
        }
    }

    // --- Snapshot A and G for the O(1) accrual formula ---
    // sum_acc_snapshot must be the g_k baseline consistent with new_k (see
    // AUDIT.md H-1); write_snapshot keys it on deposit_boundary_index.
    position.deposit_boundary_index = tenure_boundary_index(pool, position);
    crate::instructions::accrual_helpers::write_snapshot(pool, &schedule, position, new_k);

    Ok(())
}

/// Compute the tenure steps for a position at time `now`.
/// Compute the tenure steps for a position at time `now`.
fn tenure_steps(pool: &Pool, position: &StakePosition, now: i64) -> u64 {
    crate::instructions::accrual_helpers::tenure_steps(pool, position, now)
}

/// The hourly boundary index that contains the position's weighted_deposit_ts.
fn tenure_boundary_index(pool: &Pool, position: &StakePosition) -> u32 {
    crate::instructions::accrual_helpers::tenure_boundary_index(pool, position)
}

use crate::instructions::accrual_helpers::compute_pending;

#[derive(Accounts)]
pub struct Stake<'info> {
    /// The staker.
    #[account(mut)]
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

    /// The user's stake position. Created on first stake.
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + StakePosition::INIT_SPACE,
        seeds = [StakePosition::SEED, pool.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, StakePosition>>,

    /// The Schedule account for checkpoint/cohort access.
    #[account(mut)]
    pub schedule: AccountLoader<'info, Schedule>,

    /// Stake vault PDA.
    #[account(
        mut,
        seeds = [b"stake_vault", pool.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    /// The staking mint.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The user's token account.
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}


