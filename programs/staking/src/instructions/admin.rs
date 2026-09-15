use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StakingError;
use crate::state::Pool;

// ============================================================
// set_paused
// ============================================================

pub fn handler_set_paused(ctx: Context<AdminPool>, paused: bool) -> Result<()> {
    ctx.accounts.pool.paused = paused;
    msg!("admin: paused={}", paused);
    Ok(())
}

// ============================================================
// set_min_stake
// ============================================================

pub fn handler_set_min_stake(ctx: Context<AdminPool>, min_stake: u64) -> Result<()> {
    ctx.accounts.pool.min_stake = min_stake;
    msg!("admin: min_stake={}", min_stake);
    Ok(())
}

// ============================================================
// transfer_authority (two-signer: both old and new sign)
// ============================================================

/// Direct authority transfer — requires both old and new authority to sign.
pub fn handler_transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let new_authority = ctx.accounts.new_authority.key();
    msg!(
        "admin: authority transferred {} -> {}",
        pool.authority,
        new_authority
    );
    pool.authority = new_authority;
    Ok(())
}

// ============================================================
// withdraw_unallocated
// ============================================================

/// Withdraw tokens that accumulated during zero-TVL intervals.
/// Gated on `now > end_ts + grace_period` and limited to `unallocated`.
pub fn handler_withdraw_unallocated(
    ctx: Context<WithdrawUnallocated>,
    amount: u64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    require!(pool.started, StakingError::NotStarted);

    // Must be past end_ts + the FIXED protocol grace period (not a caller-
    // supplied value; see AUDIT.md M-1).
    let gate = pool
        .end_ts
        .checked_add(crate::UNALLOCATED_GRACE_SECONDS)
        .ok_or(error!(StakingError::Overflow))?;
    require!(
        clock.unix_timestamp > gate,
        StakingError::WithdrawTooEarly
    );

    // Cannot exceed unallocated.
    require!(
        (amount as u128) <= pool.unallocated,
        StakingError::InsufficientUnallocated
    );

    // Extract data needed for signer seeds before CPI.
    let mint_key = pool.mint;
    let pool_bump = pool.bump;

    // Update state before CPI.
    pool.unallocated = pool
        .unallocated
        .checked_sub(amount as u128)
        .ok_or(error!(StakingError::Overflow))?;

    // Transfer from reward_vault to admin.
    let signer_seeds: &[&[&[u8]]] = &[&[Pool::SEED, mint_key.as_ref(), &[pool_bump]]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.reward_vault.to_account_info(),
        to: ctx.accounts.authority_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    msg!("admin: withdrew unallocated={} remaining={}", amount, ctx.accounts.pool.unallocated);
    Ok(())
}

// ============================================================
// Account structs
// ============================================================

/// Simple admin action that only needs pool + authority signer.
#[derive(Accounts)]
pub struct AdminPool<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
        seeds = [Pool::SEED, pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,
}

/// Two-signer authority transfer.
#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    /// Current authority.
    pub authority: Signer<'info>,
    /// New authority must also sign.
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
        seeds = [Pool::SEED, pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,
}

/// Withdraw unallocated rewards after end + grace period.
#[derive(Accounts)]
pub struct WithdrawUnallocated<'info> {
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

    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Admin's token account to receive the withdrawal.
    #[account(mut)]
    pub authority_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
