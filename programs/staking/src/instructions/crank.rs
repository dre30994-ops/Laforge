use anchor_lang::prelude::*;

use crate::error::StakingError;
use crate::state::{Pool, Schedule};

/// Resumable hourly advance. Walks hourly boundaries from the pool's current
/// position up to `now`, updating the accumulators A and G, popping matured
/// cohorts, and recording checkpoints.
///
/// Permissionless — anyone can crank. Honors `max_steps` (default ~250) to
/// stay within compute limits. Chain multiple transactions for catch-up.
///
/// At each hourly boundary `n`:
/// 1. Look up the emission step as `min(floor(n/6), 11)` (6 hours per step).
/// 2. Compute the emission for this hour: 3 periods × rate × mult_numerator / MULT_DENOM.
/// 3. If total_weight > 0: advance A by emission × ACC_SCALE / total_weight.
///    If total_weight == 0: add emission to `unallocated`.
/// 4. Advance G: sum_acc_at_boundaries += A.
/// 5. Record checkpoint: schedule.checkpoints[n] = (A, G).
/// 6. Pop matured cohort: subtract schedule.maturing[n] from ramping_stake,
///    add that stake's additional weight (72 units per token that graduated).
///    Wait — no. When a position matures, its weight goes from
///    `stake * (72 + k)` to `stake * 144`. The ramping_stake exit means
///    total_weight no longer changes each step for those positions. The weight
///    was already tracked correctly because the formula accumulates it per-step
///    during the crank itself (the A advancement already accounts for the
///    current total_weight including ramping contributions). But the crucial
///    thing: we must subtract `maturing[n]` from `ramping_stake` so that
///    future per-step weight adjustments don't double-count graduated positions.
///    Actually, looking at the design more carefully:
///    - ramping_stake is tracked separately so the crank can efficiently update
///      total_weight each hour. Each hour, each ramping token gains 1 unit of
///      weight (because k increments by 1). So: total_weight += ramping_stake.
///    - When cohort `n` graduates (hits k=72), those tokens stop gaining weight
///      each hour, so we subtract them from ramping_stake.
///    So the per-step logic is:
///      a. total_weight += ramping_stake (each ramping token gained +1 weight this step)
///      b. pop maturing[n]: ramping_stake -= maturing[n]
///      c. Then emit/distribute using the new total_weight.
///    Actually the ordering matters for correctness. Let me think again:
///    At the START of boundary n, positions deposited at boundary (n-72) mature.
///    Their weight was (72 + 71) = 143 at boundary n-1, and hits 144 at boundary n.
///    So the increment from n-1 to n for those positions is +1 (same as everyone else).
///    After that increment, they're at the cap and should stop incrementing.
///    
///    Correct order:
///      1. total_weight += ramping_stake  (all ramping positions gain +1)
///      2. ramping_stake -= maturing[n]   (graduating positions leave the ramping pool)
///      3. Compute emission, advance A using new total_weight
///      4. G += A, record checkpoint
pub fn handler(ctx: Context<Crank>, max_steps: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let schedule = &mut ctx.accounts.schedule.load_mut()?;

    require!(pool.started, StakingError::NotStarted);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Cap time at end_ts — emissions stop there.
    let effective_now = now.min(pool.end_ts);

    // How many hourly boundaries have elapsed since start?
    let elapsed = (effective_now.saturating_sub(pool.start_ts)) as u64;
    let target_boundary = (elapsed / pool.tenure_step_seconds) as u32;

    let max_steps = if max_steps == 0 {
        staking_math::DEFAULT_MAX_CRANK_STEPS
    } else {
        max_steps
    };

    let mut steps_taken = 0u64;
    let base_rate = pool.base_rate_per_period as u128;

    while pool.next_boundary_index <= target_boundary && steps_taken < max_steps {
        let n = pool.next_boundary_index;

        // Ordering matches the reference model (crates/staking-math/src/pool.rs
        // `advance_bounded_with`): the segment ending at boundary `n` is paid at
        // the weight in force *during* that segment — i.e. the weight
        // established at boundary `n-1`. Ramping positions gain their next step
        // of weight only AFTER this boundary's emission is distributed and the
        // checkpoint recorded, so the higher weight applies to the following
        // segment. (Previously the increment happened first, paying the segment
        // ending at `n` at the incremented weight — a one-step-early divergence
        // from the spec. See AUDIT.md H-2.)

        // 1. Compute emission for this hourly interval.
        //    Each hour = 3 periods. Emission step index = min(floor((n-1)/6), 12).
        //    n is 1-based (next_boundary_index starts at 1), so (n-1) maps to
        //    0-based hourly index for the step lookup.
        let emission_step = ((n as u64 - 1) / 6).min(staking_math::EMISSION_RAMP_STEPS);
        let mult_numerator = staking_math::emission_mult_numerator(emission_step);

        // emission_this_hour = base_rate * PERIODS_PER_TENURE_STEP * mult_numerator / MULT_DENOM
        let emission = base_rate
            .checked_mul(staking_math::PERIODS_PER_TENURE_STEP)
            .ok_or(error!(StakingError::Overflow))?
            .checked_mul(mult_numerator)
            .ok_or(error!(StakingError::Overflow))?
            .checked_div(staking_math::MULT_DENOM)
            .ok_or(error!(StakingError::Overflow))?;

        pool.total_emitted = pool
            .total_emitted
            .checked_add(emission)
            .ok_or(error!(StakingError::Overflow))?;

        // 2. Distribute or park in unallocated, using the weight in force during
        //    the segment (pre-increment).
        if pool.total_weight > 0 {
            let delta_a = emission
                .checked_mul(staking_math::ACC_SCALE)
                .ok_or(error!(StakingError::Overflow))?
                .checked_div(pool.total_weight)
                .ok_or(error!(StakingError::Overflow))?;

            pool.acc_reward_per_weight = pool
                .acc_reward_per_weight
                .checked_add(delta_a)
                .ok_or(error!(StakingError::Overflow))?;
        } else {
            pool.unallocated = pool
                .unallocated
                .checked_add(emission)
                .ok_or(error!(StakingError::Overflow))?;
        }

        // 3. Advance G: sum of A at boundaries.
        pool.sum_acc_at_boundaries = pool
            .sum_acc_at_boundaries
            .checked_add(pool.acc_reward_per_weight)
            .ok_or(error!(StakingError::Overflow))?;

        // 4. Record checkpoint (A_n, G_n) BEFORE weights change.
        let cp_idx = n as usize;
        if cp_idx < Schedule::CHECKPOINT_CAPACITY {
            schedule.checkpoints[cp_idx].acc = pool.acc_reward_per_weight;
            schedule.checkpoints[cp_idx].sum_acc = pool.sum_acc_at_boundaries;
        }

        // 5. Now that boundary `n`'s emission is distributed and checkpointed,
        //    every still-ramping position gains one step of weight for the NEXT
        //    segment...
        pool.total_weight = pool
            .total_weight
            .checked_add(pool.ramping_stake)
            .ok_or(error!(StakingError::Overflow))?;

        // 6. ...and this boundary's cohort hits the 72-step cap and stops
        //    ramping.
        let maturing_idx = n as usize;
        if maturing_idx < Schedule::MATURING_CAPACITY {
            let graduating = schedule.maturing[maturing_idx] as u128;
            if graduating > 0 {
                pool.ramping_stake = pool
                    .ramping_stake
                    .checked_sub(graduating)
                    .ok_or(error!(StakingError::Overflow))?;
                schedule.maturing[maturing_idx] = 0;
            }
        }

        pool.next_boundary_index = n + 1;
        steps_taken += 1;
    }

    // Update last_update_ts to reflect how far we cranked.
    let cranked_to = pool.start_ts
        + (pool.next_boundary_index as i64 * pool.tenure_step_seconds as i64);
    pool.last_update_ts = cranked_to.min(effective_now);
    Ok(())
}

#[derive(Accounts)]
pub struct Crank<'info> {
    /// Anyone can crank (permissionless).
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = schedule,
        seeds = [Pool::SEED, pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The Schedule account with checkpoint and maturing arrays.
    #[account(mut)]
    pub schedule: AccountLoader<'info, Schedule>,
}


