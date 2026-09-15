use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StakingError;
use crate::state::Pool;

/// Sweep the reward-vault **surplus** back to the operator after the pool has
/// had no active stakes for at least 3 hours.
///
/// Permissionless: anyone may call it, but the funds can only ever go to the
/// operator's token account, and only the surplus is moved.
///
/// # Safety
///
/// This never touches the stake vault (user principal) and never sends tokens
/// that stakers can still claim. The sweepable amount is:
///
/// ```text
/// sweepable = reward_vault.balance - (total_emitted - total_claimed)
/// ```
///
/// where `total_emitted - total_claimed` is every reward that has been emitted
/// but not yet withdrawn — this covers both unclaimed `pending_rewards` sitting
/// in (now-idle) positions and the `unallocated` bucket from zero-TVL intervals.
/// Only the balance above that reserved amount is returned to the operator.
///
/// # Conditions
///
/// * `total_staked == 0` — no active stakes.
/// * `now >= last_nonzero_stake_ts + EMPTY_SWEEP_SECONDS` — empty for >= 3h.
/// * Sweepable surplus > 0.
pub fn handler(ctx: Context<SweepToOperator>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Snapshot the values we need for the guards and CPI before mutating.
    let (mint_key, pool_bump, sweepable, mint_decimals) = {
        let pool = &ctx.accounts.pool;

        // 1. No active stakes.
        require!(pool.total_staked == 0, StakingError::StakesActive);

        // 2. Empty for at least 3 hours.
        let gate = pool
            .last_nonzero_stake_ts
            .checked_add(crate::EMPTY_SWEEP_SECONDS)
            .ok_or(error!(StakingError::Overflow))?;
        require!(now >= gate, StakingError::SweepTooEarly);

        // 3. Compute the sweepable surplus: vault balance minus rewards that are
        //    still owed to stakers (emitted but not yet claimed).
        let vault_balance = ctx.accounts.reward_vault.amount as u128;
        let reserved = pool
            .total_emitted
            .checked_sub(pool.total_claimed)
            .ok_or(error!(StakingError::Overflow))?;
        let sweepable = vault_balance.saturating_sub(reserved);

        require!(sweepable > 0, StakingError::NothingToSweep);

        let sweepable_u64 =
            u64::try_from(sweepable).map_err(|_| error!(StakingError::Overflow))?;

        (pool.mint, pool.bump, sweepable_u64, ctx.accounts.mint.decimals)
    };

    // Transfer the surplus from the reward vault to the operator.
    let signer_seeds: &[&[&[u8]]] = &[&[Pool::SEED, mint_key.as_ref(), &[pool_bump]]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.reward_vault.to_account_info(),
        to: ctx.accounts.operator_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, sweepable, mint_decimals)?;

    // Reduce the accounted funding by the swept amount so the pool's internal
    // bookkeeping stays consistent with the (now-smaller) vault balance.
    let pool = &mut ctx.accounts.pool;
    pool.funded_amount = pool.funded_amount.saturating_sub(sweepable);

    msg!(
        "sweep_to_operator: swept {} to operator {}",
        sweepable,
        pool.operator
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SweepToOperator<'info> {
    /// Permissionless caller. Pays tx fees only; funds always route to operator.
    pub caller: Signer<'info>,

    #[account(
        mut,
        has_one = mint,
        has_one = reward_vault,
        seeds = [Pool::SEED, mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// The reward vault PDA (pool is authority).
    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// The staking/reward mint.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The operator's token account. Must be owned by the pool's operator, so
    /// swept funds can only ever land with the operator.
    #[account(
        mut,
        constraint = operator_token_account.owner == pool.operator @ StakingError::NotOperator,
        constraint = operator_token_account.mint == pool.mint @ StakingError::NotOperator,
    )]
    pub operator_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
