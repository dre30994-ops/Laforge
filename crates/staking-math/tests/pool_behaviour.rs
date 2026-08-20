//! Behavioural tests for the reference pool: the semantics Tasks 4-11 must
//! reproduce on-chain.

use staking_math::*;

const START: u64 = 0;
const HOUR: u64 = 3_600;
const DAY: u64 = 86_400;
const T50K: u128 = 50_000_000_000; // 50,000 tokens @ 6dp

fn funded_pool(users: usize) -> RefPool {
    let mut p = RefPool::new(START, users);
    p.fund(TOTAL_REWARD_POOL).unwrap();
    p
}

/// Crank in `max_steps` chunks until fully caught up.
fn crank_chunked(p: &mut RefPool, now: u64, max_steps: u64) -> usize {
    let mut txs = 0;
    loop {
        let before = (p.next_boundary, p.last_ts);
        p.advance_bounded(now, max_steps).unwrap();
        txs += 1;
        if (p.next_boundary, p.last_ts) == before {
            return txs;
        }
    }
}

// ---------------------------------------------------------------- funding

#[test]
fn funding_200m_derives_a_day_14_end() {
    let p = funded_pool(1);
    assert_eq!(p.end_ts - p.start_ts, 14 * DAY);
    assert_eq!(p.funded, TOTAL_REWARD_POOL);
}

#[test]
fn topping_up_one_plateau_day_extends_by_exactly_one_day() {
    let mut p = funded_pool(1);
    p.fund(144 * R0).unwrap();
    assert_eq!(p.end_ts - p.start_ts, 15 * DAY);
}

#[test]
fn funding_is_cumulative_and_end_never_moves_backward() {
    let mut p = RefPool::new(START, 1);
    let mut last_end = p.end_ts;
    for _ in 0..20 {
        p.fund(10_000_000_000_000).unwrap();
        assert!(p.end_ts >= last_end, "end_ts moved backwards");
        last_end = p.end_ts;
    }
    assert_eq!(p.funded, 20 * 10_000_000_000_000);
}

/// A top-up landing inside capacity succeeds; one past it is rejected cleanly.
#[test]
fn capacity_ceiling_is_enforced_without_corrupting_state() {
    // R0 * 4_203 funds exactly 30 days, the checkpoint capacity.
    let exactly_30d = R0 * 4_203;
    let mut p = RefPool::new(START, 1);
    p.fund(exactly_30d).unwrap();
    assert_eq!(p.end_ts - p.start_ts, 30 * DAY);
    assert_eq!(p.end_ts - p.start_ts, RefPool::max_duration_secs());

    let snapshot_funded = p.funded;
    let snapshot_end = p.end_ts;

    // One more day would need boundary 744 > capacity 720.
    assert_eq!(p.fund(144 * R0), Err(PoolError::CapacityExceeded));
    assert_eq!(
        p.funded, snapshot_funded,
        "funded must not change on failure"
    );
    assert_eq!(p.end_ts, snapshot_end, "end_ts must not change on failure");
}

#[test]
fn partial_ramp_funding_ends_inside_the_ramp() {
    let mut p = RefPool::new(START, 1);
    p.fund(R0 * 100).unwrap(); // well under the ramp's 315 period-units
    assert!(p.end_ts - p.start_ts < 3 * DAY);
}

// ---------------------------------------------------------------- crank

#[test]
fn many_partial_cranks_equal_one_full_crank() {
    let target = 10 * DAY;

    let mut full = funded_pool(2);
    full.stake(0, T50K * 4, START).unwrap();
    full.stake(1, T50K * 6, START + 5 * HOUR).unwrap();

    let mut chunked = funded_pool(2);
    chunked.stake(0, T50K * 4, START).unwrap();
    chunked.stake(1, T50K * 6, START + 5 * HOUR).unwrap();

    full.advance(target).unwrap();
    let txs = crank_chunked(&mut chunked, target, 37);
    assert!(txs > 1, "test is meaningless without multiple chunks");

    assert_eq!(chunked.acc, full.acc, "A diverged");
    assert_eq!(chunked.sum_acc, full.sum_acc, "G diverged");
    assert_eq!(chunked.total_weight, full.total_weight);
    assert_eq!(chunked.total_emitted, full.total_emitted);
    assert_eq!(chunked.next_boundary, full.next_boundary);
    assert_eq!(chunked.acc_at, full.acc_at, "checkpoint series diverged");
    assert_eq!(chunked.sum_acc_at, full.sum_acc_at);
}

/// A worst-case catch-up must fit in roughly three transactions at the
/// suggested step budget.
#[test]
fn full_catchup_completes_in_about_three_transactions() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    // 30 days of arrears: the whole checkpoint array.
    let txs = crank_chunked(&mut p, 30 * DAY, DEFAULT_MAX_CRANK_STEPS);
    assert!(txs <= 4, "needed {txs} transactions");
    assert_eq!(p.next_boundary - 1, CHECKPOINT_CAPACITY as u64);
}

#[test]
fn zero_tvl_emissions_land_in_unallocated_and_acc_holds() {
    let mut p = funded_pool(1);
    p.advance(2 * DAY).unwrap();

    assert_eq!(p.acc, 0, "A must not move with no stakers");
    assert_eq!(p.unallocated, p.total_emitted);
    assert_eq!(p.unallocated, cumulative_emitted(2 * DAY).unwrap());
    assert!(p.unallocated > 0);
}

#[test]
fn cranking_past_end_emits_nothing_further() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    p.advance(14 * DAY).unwrap();
    let at_end = p.total_emitted;
    assert_eq!(at_end, R0 * DENOM);

    p.advance(20 * DAY).unwrap();
    assert_eq!(p.total_emitted, at_end, "emitted past end_ts");
}

// ---------------------------------------------------------------- staking

#[test]
fn two_stakers_produce_the_expected_total_weight() {
    let mut p = funded_pool(2);
    let a = T50K * 2;
    let b = T50K * 3;
    p.stake(0, a, START).unwrap();
    p.stake(1, b, START + 24 * HOUR).unwrap();

    p.advance(START + 24 * HOUR).unwrap();
    // A has 24 hourly steps, B has none.
    let expected = a * (72 + 24) + b * 72;
    assert_eq!(p.total_weight, expected);
    p.check_all().unwrap();
}

#[test]
fn minimum_stake_is_enforced_on_the_resulting_position() {
    let mut p = funded_pool(3);
    // 49,999 tokens: rejected.
    assert_eq!(
        p.stake(0, 49_999_000_000, START),
        Err(PoolError::BelowMinimumStake)
    );
    assert_eq!(p.positions[0].amount, 0);
    assert_eq!(p.total_staked, 0, "failed stake must not mutate totals");

    // Exactly 50,000: accepted.
    p.stake(1, T50K, START).unwrap();
    assert_eq!(p.positions[1].amount, T50K);

    // A small top-up onto an existing 60,000 position is fine.
    p.stake(2, 60_000_000_000, START).unwrap();
    p.stake(2, 1_000_000_000, START + HOUR).unwrap();
    assert_eq!(p.positions[2].amount, 61_000_000_000);
}

#[test]
fn wait_then_dump_attack_is_diluted() {
    let mut p = funded_pool(1);
    // Minimum position, held for the full 3 days to reach 2.0x.
    p.stake(0, T50K, START).unwrap();
    p.advance(3 * DAY).unwrap();
    assert_eq!(p.tenure_bps(0), 20_000, "should be matured at 2.0x");

    // Now dump 200x the original size.
    p.stake(0, T50K * 200, 3 * DAY).unwrap();
    let bps = p.tenure_bps(0);
    // Effectively reset: 2.0x -> ~1.014x. The small residual is the documented
    // one-hour boundary granularity — the weighted timestamp lands 1,290s
    // before a boundary, so k reads 1 instead of 0. Bounded by one step.
    assert!(
        bps <= 10_000 + (BPS / TENURE_RAMP_STEPS as u128) + 1,
        "dumped capital inherited tenure: {bps} bps"
    );
    // The attacker destroyed ~98.6% of the multiplier they were farming.
    assert!(bps < 10_200, "got {bps} bps");
    p.check_all().unwrap();
}

// ---------------------------------------------------------------- tenure

#[test]
fn tenure_maxes_at_exactly_two_x_on_day_three() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();

    p.advance(3 * DAY - 1).unwrap();
    assert!(p.tenure_bps(0) < 20_000, "matured early");

    p.advance(3 * DAY).unwrap();
    assert_eq!(p.tenure_bps(0), 20_000);
    assert_eq!(p.ramping_stake, 0, "cohort must leave ramping_stake");

    // Weight is now frozen.
    let w = p.total_weight;
    p.advance(10 * DAY).unwrap();
    assert_eq!(p.total_weight, w, "weight grew past the cap");
    assert_eq!(p.total_weight, T50K * 144);
}

#[test]
fn late_joiners_read_the_expected_multipliers_at_program_end() {
    for (join_day, expect_bps) in [(11u64, 20_000u128), (12, 16_666), (13, 13_333)] {
        let mut p = funded_pool(1);
        p.stake(0, T50K, join_day * DAY).unwrap();
        p.advance(14 * DAY).unwrap();
        assert_eq!(
            p.tenure_bps(0),
            expect_bps,
            "day-{join_day} joiner at program end"
        );
    }
}

/// The case a windowed ring buffer would silently break: mature on day 3, then
/// touch nothing until day 14.
#[test]
fn position_idle_from_day_three_to_day_fourteen_still_pays() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    let paid = p.claim(0, 14 * DAY).unwrap();

    // Sole staker, so it collects everything emitted while it was staked.
    assert!(paid > 0);
    let expected = cumulative_emitted(14 * DAY).unwrap();
    // Only integer dust may be lost.
    assert!(
        expected - paid < 1_000,
        "sole staker lost {} base units",
        expected - paid
    );
    p.check_all().unwrap();
}

// ---------------------------------------------------------------- claim

#[test]
fn claim_does_not_touch_tenure_and_double_claim_pays_zero() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    p.advance(5 * DAY).unwrap();

    let bps_before = p.tenure_bps(0);
    let ts_before = p.positions[0].weighted_deposit_ts;
    let first = p.claim(0, 5 * DAY).unwrap();
    assert!(first > 0);
    assert_eq!(p.tenure_bps(0), bps_before, "claim moved the multiplier");
    assert_eq!(p.positions[0].weighted_deposit_ts, ts_before);

    let second = p.claim(0, 5 * DAY).unwrap();
    assert_eq!(second, 0, "double claim paid twice");
}

#[test]
fn two_stakers_split_by_weight() {
    let mut p = funded_pool(2);
    // Equal stakes, equal deposit time: equal pay.
    p.stake(0, T50K, START).unwrap();
    p.stake(1, T50K, START).unwrap();
    let a = p.claim(0, 4 * DAY).unwrap();
    let b = p.claim(1, 4 * DAY).unwrap();
    assert_eq!(a, b);
    p.check_all().unwrap();
}

#[test]
fn splitting_a_position_confers_no_advantage() {
    let whole = {
        let mut p = funded_pool(1);
        p.stake(0, T50K * 4, START).unwrap();
        p.claim(0, 6 * DAY).unwrap()
    };
    let split = {
        let mut p = funded_pool(2);
        p.stake(0, T50K * 2, START).unwrap();
        p.stake(1, T50K * 2, START).unwrap();
        p.claim(0, 6 * DAY).unwrap() + p.claim(1, 6 * DAY).unwrap()
    };
    // Identical up to per-position integer dust.
    assert!(whole.abs_diff(split) <= 4, "split {split} vs whole {whole}");
}

// ---------------------------------------------------------------- unstake

#[test]
fn unstake_resets_tenure_fully_but_preserves_pending() {
    let mut p = funded_pool(1);
    p.stake(0, T50K * 2, START).unwrap();
    p.advance(4 * DAY).unwrap();
    assert_eq!(p.tenure_bps(0), 20_000);

    // Partial unstake resets the whole position's tenure.
    p.unstake(0, T50K, 4 * DAY).unwrap();
    assert_eq!(p.tenure_bps(0), 10_000, "tenure must reset to 1.0x");
    assert_eq!(p.positions[0].amount, T50K);
    assert!(p.positions[0].pending > 0, "pending rewards were lost");
    p.check_all().unwrap();
}

#[test]
fn unstaking_to_zero_and_below_minimum_both_succeed() {
    let mut p = funded_pool(1);
    p.stake(0, T50K * 2, START).unwrap();
    p.advance(DAY).unwrap();

    // Down to 1 token, far below the 50,000 minimum: allowed on exit.
    p.unstake(0, T50K * 2 - 1_000_000, DAY).unwrap();
    assert_eq!(p.positions[0].amount, 1_000_000);

    p.unstake(0, 1_000_000, DAY).unwrap();
    assert_eq!(p.positions[0].amount, 0);
    assert_eq!(p.total_staked, 0);
    assert_eq!(p.total_weight, 0);
    assert_eq!(p.ramping_stake, 0);
    p.check_all().unwrap();
}

// ---------------------------------------------------------------- compound

#[test]
fn compound_grows_principal_and_dilutes_tenure() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    p.advance(4 * DAY).unwrap();
    assert_eq!(p.tenure_bps(0), 20_000);

    let before = p.positions[0].amount;
    let pending = p.pending_of(0).unwrap();
    assert!(pending > 0);

    let folded = p.compound(0, 4 * DAY).unwrap();
    assert_eq!(folded, pending);
    assert_eq!(p.positions[0].amount, before + folded);
    assert_eq!(p.positions[0].pending, 0);
    assert!(p.tenure_bps(0) < 20_000, "compounding must dilute tenure");
    p.check_all().unwrap();
}

#[test]
fn compound_with_zero_pending_is_a_noop() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    let before = p.positions[0].clone();
    assert_eq!(p.compound(0, START).unwrap(), 0);
    assert_eq!(p.positions[0], before);
}

#[test]
fn compound_is_exempt_from_minimum_stake() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    p.advance(DAY).unwrap();
    // Drop well below the minimum, then compound anyway.
    p.unstake(0, T50K - 1_000_000, DAY).unwrap();
    assert!(p.positions[0].amount < p.min_stake);
    assert!(p.compound(0, 2 * DAY).unwrap() > 0);
}

// ---------------------------------------------------------------- admin

#[test]
fn pause_blocks_entry_but_never_exit() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    p.advance(2 * DAY).unwrap();
    p.paused = true;

    assert_eq!(p.stake(0, T50K, 2 * DAY), Err(PoolError::Paused));
    assert_eq!(p.compound(0, 2 * DAY), Err(PoolError::Paused));

    // Exits must always work.
    assert!(p.claim(0, 2 * DAY).is_ok());
    assert!(p.unstake(0, T50K, 2 * DAY).is_ok());
}

#[test]
fn raising_minimum_stake_grandfathers_existing_positions() {
    let mut p = funded_pool(1);
    p.stake(0, T50K, START).unwrap();
    p.min_stake = T50K * 10;

    // The existing position is untouched and can still exit and claim.
    assert_eq!(p.positions[0].amount, T50K);
    assert!(p.claim(0, DAY).is_ok());
    assert!(p.unstake(0, T50K, DAY).is_ok());
    // But new deposits must meet the new floor.
    assert_eq!(p.stake(0, T50K, DAY), Err(PoolError::BelowMinimumStake));
}

#[test]
fn unallocated_recovery_is_gated_on_end_plus_grace() {
    let grace = 7 * DAY;
    let mut p = funded_pool(1);
    p.advance(2 * DAY).unwrap(); // nobody staked; emissions go unallocated
    let parked = p.unallocated;
    assert!(parked > 0);

    assert_eq!(
        p.withdraw_unallocated(parked, 14 * DAY, grace),
        Err(PoolError::NotEnded)
    );
    assert_eq!(
        p.withdraw_unallocated(parked, 14 * DAY + grace, grace),
        Err(PoolError::NotEnded)
    );
    // Cannot exceed the parked balance.
    assert!(p
        .withdraw_unallocated(parked + 1, 14 * DAY + grace + 1, grace)
        .is_err());
    // And after the gate, exactly the parked amount is recoverable.
    assert_eq!(
        p.withdraw_unallocated(parked, 14 * DAY + grace + 1, grace)
            .unwrap(),
        parked
    );
    assert_eq!(p.unallocated, 0);
}

// ---------------------------------------------------------------- solvency

#[test]
fn solvency_holds_across_a_mixed_timeline() {
    let mut p = funded_pool(3);
    p.stake(0, T50K * 2, START).unwrap();
    p.stake(1, T50K * 5, 6 * HOUR).unwrap();
    p.advance(2 * DAY).unwrap();
    p.claim(0, 2 * DAY).unwrap();
    p.stake(2, T50K, 2 * DAY + HOUR).unwrap();
    p.compound(1, 4 * DAY).unwrap();
    p.unstake(0, T50K, 5 * DAY).unwrap();
    p.advance(14 * DAY).unwrap();
    for u in 0..3 {
        p.claim(u, 14 * DAY).unwrap();
    }

    p.check_all().unwrap();
    assert!(p.total_emitted <= p.funded);
    assert!(p.total_distributed() <= p.total_emitted);
}
