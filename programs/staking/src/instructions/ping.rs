use anchor_lang::prelude::*;
use staking_math::{derive_base_rate, emission_mult_bps, tenure_mult_bps, DENOM, MIN_FUNDING};

/// Records a value and echoes back the schedule constants, proving the
/// math crate is linked and callable on-chain.
pub fn handler(ctx: Context<Ping>, value: u64) -> Result<()> {
    let state = &mut ctx.accounts.state;
    state.value = value;
    state.bump = ctx.bumps.state;

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
