use anchor_lang::prelude::*;

use crate::error::StakingError;
use crate::state::Pool;

/// Start the pool after sufficient funding has been deposited.
///
/// Gates:
/// - Pool must not already be started.
/// - `funded_amount >= min_funding`.
///
/// Effects:
/// - Derives `base_rate_per_period = funded_amount / DENOM`.
/// - Sets `start_ts = now`, `end_ts = now + 14 days`.
/// - Sets `last_update_ts = now`.
/// - Marks `started = true`.
pub fn handler(ctx: Context<StartPool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    require!(!pool.started, StakingError::AlreadyStarted);
    require!(
        pool.funded_amount >= pool.min_funding,
        StakingError::InsufficientFunding
    );

    let funded = pool.funded_amount as u128;
    let base_rate = staking_math::derive_base_rate(funded)
        .map_err(|_| error!(StakingError::Overflow))?;

    let base_rate_u64 =
        u64::try_from(base_rate).map_err(|_| error!(StakingError::Overflow))?;

    let now = clock.unix_timestamp;
    let duration_secs = (staking_math::DURATION_DAYS * staking_math::SECONDS_PER_DAY) as i64;

    pool.base_rate_per_period = base_rate_u64;
    pool.start_ts = now;
    pool.end_ts = now
        .checked_add(duration_secs)
        .ok_or(error!(StakingError::Overflow))?;
    pool.last_update_ts = now;
    pool.started = true;

    msg!(
        "pool started: base_rate={} start_ts={} end_ts={} funded={}",
        base_rate_u64,
        now,
        pool.end_ts,
        pool.funded_amount
    );

    Ok(())
}

#[derive(Accounts)]
pub struct StartPool<'info> {
    /// Must be the pool authority.
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ StakingError::Unauthorized,
    )]
    pub pool: Account<'info, Pool>,
}
