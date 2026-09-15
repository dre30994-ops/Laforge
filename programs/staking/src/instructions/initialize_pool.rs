use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::StakingError;
use crate::state::{Pool, Schedule};
use crate::validation::validate_mint_extensions;

/// Parameters for pool initialization. These are immutable after init.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializePoolParams {
    /// Minimum funding to start the pool (in base units).
    pub min_funding: u64,
    /// Minimum stake per position (in base units).
    pub min_stake: u64,
}

/// Initialize a new staking pool for a given mint.
///
/// Creates the Pool PDA, stake vault, and reward vault. Links to the
/// client-allocated Schedule account. Reads decimals from the mint.
/// Validates the mint does not carry dangerous extensions.
///
/// The pool is not active until `start_pool` is called with sufficient funding.
pub fn handler(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
    // Collect the fixed 0.5 SOL launch fee from the authority, routed to the
    // hardcoded fee recipient. Mirrors the EVM factory's launch fee. Done first
    // so pool state is only created once the fee is paid.
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        ),
        crate::LAUNCH_FEE_LAMPORTS,
    )?;

    // Validate mint extensions.
    let mint_info = ctx.accounts.mint.to_account_info();
    let mint_data = mint_info.try_borrow_data()?;
    validate_mint_extensions(&mint_data)?;
    drop(mint_data);

    // Validate Schedule is correctly sized.
    let schedule = &ctx.accounts.schedule;
    let schedule_info = schedule.to_account_info();
    require!(
        schedule_info.data_len() >= Schedule::SPACE,
        StakingError::ScheduleTooSmall
    );

    // Read decimals from the mint.
    let decimals = ctx.accounts.mint.decimals;

    // Initialize Pool state.
    let pool = &mut ctx.accounts.pool;
    pool.authority = ctx.accounts.authority.key();
    // Production: the operator is the single hardcoded address. Under the
    // `test-operator` feature, the pool authority becomes the operator so the
    // logic can be exercised in integration tests.
    #[cfg(not(feature = "test-operator"))]
    {
        pool.operator = crate::OPERATOR;
    }
    #[cfg(feature = "test-operator")]
    {
        pool.operator = ctx.accounts.authority.key();
    }
    pool.mint = ctx.accounts.mint.key();
    pool.token_program = ctx.accounts.token_program.key();
    pool.stake_vault = ctx.accounts.stake_vault.key();
    pool.reward_vault = ctx.accounts.reward_vault.key();
    pool.schedule = schedule.key();

    pool.start_ts = 0;
    pool.end_ts = 0;

    // Schedule parameters — use the canonical constants.
    pool.period_seconds = staking_math::PERIOD_SECONDS;
    pool.emission_step_seconds = staking_math::EMISSION_STEP_SECONDS;
    pool.emission_ramp_steps = staking_math::EMISSION_RAMP_STEPS;
    pool.tenure_step_seconds = staking_math::TENURE_STEP_SECONDS;
    pool.tenure_ramp_steps = staking_math::TENURE_RAMP_STEPS;
    pool.checkpoint_capacity = Schedule::CHECKPOINT_CAPACITY as u32;
    pool.decimals = decimals;

    pool.min_funding = params.min_funding;
    pool.min_stake = params.min_stake;
    pool.funded_amount = 0;
    pool.base_rate_per_period = 0;

    pool.started = false;
    pool.paused = false;

    pool.total_staked = 0;
    pool.total_weight = 0;
    pool.ramping_stake = 0;
    pool.acc_reward_per_weight = 0;
    pool.sum_acc_at_boundaries = 0;

    pool.last_update_ts = 0;
    pool.last_nonzero_stake_ts = 0;
    pool.next_boundary_index = 1; // boundary 0 is pre-recorded as (0, 0)

    pool.total_emitted = 0;
    pool.total_claimed = 0;
    pool.unallocated = 0;

    pool.bump = ctx.bumps.pool;

    // Initialize the Schedule header.
    let schedule_loader = &ctx.accounts.schedule;
    let mut sched = schedule_loader.load_init()?;
    sched.pool = pool.key();
    sched.checkpoint_len = Schedule::CHECKPOINT_CAPACITY as u32;
    sched.maturing_len = Schedule::MATURING_CAPACITY as u32;
    // checkpoints[0] = (0, 0) is already zeroed by default.

    Ok(())
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    /// The pool authority (admin).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The staking/reward mint. Validated for dangerous extensions.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The Pool PDA. Seeded by ["pool", mint].
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [Pool::SEED, mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Stake vault: holds staked tokens. PDA seeded ["stake_vault", pool].
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = pool,
        seeds = [b"stake_vault", pool.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    /// Reward vault: holds reward tokens. PDA seeded ["reward_vault", pool].
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = pool,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// The Schedule account, pre-allocated by the client via
    /// `SystemProgram.createAccount` with enough space for
    /// 384 checkpoints + 464 maturing slots.
    ///
    /// Owner must already be this program.
    #[account(zero)]
    pub schedule: AccountLoader<'info, Schedule>,

    /// The token program (SPL Token or Token-2022).
    pub token_program: Interface<'info, TokenInterface>,

    /// Recipient of the 0.5 SOL launch fee. Must match the hardcoded
    /// `LAUNCH_FEE_RECIPIENT`; receives the fee via a System Program transfer.
    #[account(mut, address = crate::LAUNCH_FEE_RECIPIENT)]
    pub fee_recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
