//! 14-day liquidity-bootstrap staking farm.
//!
//! Task 1 scaffold: a single `ping` instruction whose only job is to prove the
//! toolchain works end to end — PDA derivation, account init, a System Program
//! CPI, and that the pure math crate links into the SBF target.
//!
//! The real instruction set (`initialize_pool`, `fund_rewards`, `sync_rewards`,
//! `stake`, `unstake`, `claim`, `compound`, `crank`, admin) lands in Tasks 3-11.

use anchor_lang::prelude::*;
use staking_math::{derive_base_rate, emission_mult_bps, tenure_mult_bps, DENOM, MIN_FUNDING};

declare_id!("9w1J2JrEuLqN4dL8NEUAdW3aubzzTXpSc9pG3mYdEgUL");

#[program]
pub mod staking {
    use super::*;

    /// Records a value and echoes back the schedule constants, proving the
    /// math crate is linked and callable on-chain.
    pub fn ping(ctx: Context<Ping>, value: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.value = value;
        state.bump = ctx.bumps.state;

        // Exercise the linked math so it cannot be optimised away.
        let r0 = derive_base_rate(MIN_FUNDING).unwrap_or(0);
        state.base_rate = r0 as u64;
        state.plateau_bps = emission_mult_bps(12) as u16;
        state.mature_tenure_bps = tenure_mult_bps(72) as u16;

        msg!(
            "ping value={} r0={} denom={} plateau={}bps tenure_max={}bps",
            value,
            r0,
            DENOM,
            state.plateau_bps,
            state.mature_tenure_bps
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + PingState::INIT_SPACE,
        seeds = [PingState::SEED, payer.key().as_ref()],
        bump,
    )]
    pub state: Account<'info, PingState>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct PingState {
    pub value: u64,
    pub base_rate: u64,
    pub plateau_bps: u16,
    pub mature_tenure_bps: u16,
    pub bump: u8,
}

impl PingState {
    pub const SEED: &'static [u8] = b"ping";
}

#[error_code]
pub enum StakingError {
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Deposit would leave the position below the minimum stake")]
    BelowMinimumStake,
    #[msg("Pool is stale; crank it to the current slot first")]
    PoolStale,
    #[msg("Pool is paused")]
    Paused,
    #[msg("Pool has not been started yet")]
    NotStarted,
    #[msg("Funding is below the minimum required to start")]
    BelowMinimumFunding,
}
