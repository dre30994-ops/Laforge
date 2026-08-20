//! Property tests: the O(1) accrual formula against explicit integration.
//!
//! The brute-force simulator integrates `sum w_i(t) * dA` segment by segment
//! and independently re-derives aggregate weight by summing over positions on
//! every segment. Both must agree with the closed-form implementation exactly —
//! no tolerance. See [`staking_math::sim`] for why exactness is achievable.

use proptest::prelude::*;
use staking_math::*;

const START: u64 = 0;
const USERS: usize = 4;
const T35K: u128 = 35_000_000_000; // 35,000 tokens @ 6dp (minimum stake)
const FUNDED_200M: u128 = 200_000_000_000_000;

#[derive(Debug, Clone)]
enum Op {
    Stake(usize, u128),
    /// Withdraw a percentage of the current position.
    Unstake(usize, u8),
    Claim(usize),
    Compound(usize),
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (0..USERS, T35K..(T35K * 40)).prop_map(|(u, a)| Op::Stake(u, a)),
        2 => (0..USERS, 1u8..=100).prop_map(|(u, p)| Op::Unstake(u, p)),
        2 => (0..USERS).prop_map(Op::Claim),
        1 => (0..USERS).prop_map(Op::Compound),
    ]
}

/// Helper: create a funded and started pool.
fn funded_started_sim(funded: u128) -> BruteSim {
    let mut sim = BruteSim::new(START, USERS);
    sim.fund(funded).unwrap();
    sim.start().unwrap();
    sim
}

/// Drive a sequence of operations, checking invariants after every step.
fn run(ops: &[Op], gaps: &[u64]) -> Result<BruteSim, String> {
    let mut sim = funded_started_sim(FUNDED_200M);

    let mut t = START;
    for (i, op) in ops.iter().enumerate() {
        t += gaps[i % gaps.len()];
        match op {
            Op::Stake(u, amt) => {
                let _ = sim.stake(*u, *amt, t);
            }
            Op::Unstake(u, pct) => {
                let held = sim.pool.positions[*u].amount;
                if held > 0 {
                    let amt = (held * (*pct as u128) / 100).max(1);
                    let _ = sim.unstake(*u, amt, t);
                }
            }
            Op::Claim(u) => {
                let _ = sim.claim(*u, t);
            }
            Op::Compound(u) => {
                let _ = sim.compound(*u, t);
            }
        }
        sim.pool
            .check_all()
            .map_err(|e| format!("invariant broke after op {i} ({op:?}): {e:?}"))?;
    }

    // Settle everyone so brute and closed-form totals are comparable.
    let t_end = t + 7_200;
    for u in 0..USERS {
        let _ = sim.claim(u, t_end);
    }
    sim.assert_equivalence()?;
    Ok(sim)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1_200))]

    /// The headline property: closed form == brute force, exactly.
    #[test]
    fn o1_accrual_matches_brute_force(
        ops in prop::collection::vec(op_strategy(), 1..24),
        gaps in prop::collection::vec(1u64..90_000u64, 1..12),
    ) {
        let sim = run(&ops, &gaps).map_err(TestCaseError::fail)?;

        // Solvency must survive any sequence.
        prop_assert!(sim.pool.total_emitted <= sim.pool.funded);
        prop_assert!(sim.pool.total_distributed() <= sim.pool.total_emitted);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// Long horizons that cross the ramp/plateau seam and the 72-step cap.
    #[test]
    fn equivalence_holds_over_long_horizons(
        ops in prop::collection::vec(op_strategy(), 1..14),
        gaps in prop::collection::vec(30_000u64..260_000u64, 1..8),
    ) {
        run(&ops, &gaps).map_err(TestCaseError::fail)?;
    }

    /// Dense activity inside a single hour, exercising sub-boundary segments.
    #[test]
    fn equivalence_holds_under_dense_activity(
        ops in prop::collection::vec(op_strategy(), 1..30),
        gaps in prop::collection::vec(1u64..600u64, 1..6),
    ) {
        run(&ops, &gaps).map_err(TestCaseError::fail)?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    /// Weight must always equal the explicit sum, at any instant.
    #[test]
    fn weight_invariant_holds_at_arbitrary_instants(
        stakes in prop::collection::vec(T35K..(T35K * 100), 1..USERS),
        offsets in prop::collection::vec(0u64..(4 * 86_400), 1..USERS),
        probe in 0u64..(14 * 86_400),
    ) {
        let mut p = RefPool::new(START, USERS);
        p.fund(FUNDED_200M).unwrap();
        p.start().unwrap();

        let mut events: Vec<(u64, usize, u128)> = stakes
            .iter()
            .zip(offsets.iter())
            .enumerate()
            .map(|(i, (s, o))| (*o, i, *s))
            .collect();
        events.sort_by_key(|e| e.0);

        for (ts, user, amount) in events {
            let _ = p.stake(user, amount, ts);
            p.check_all().unwrap();
        }

        p.advance(probe).unwrap();
        prop_assert!(p.check_weight_invariant().is_ok());
        prop_assert!(p.check_ramping_invariant().is_ok());
        prop_assert!(p.check_solvency().is_ok());
    }
}

// ------------------------------------------------------------------ overflow

#[test]
fn extreme_stake_does_not_wrap() {
    // u64::MAX base units is far beyond a 1B-supply token, but the math must
    // report overflow rather than wrap silently.
    let huge = u64::MAX as u128;
    assert!(weight(huge, 72).is_ok());
    assert!(weight(u128::MAX, 1).is_err());

    let mut p = RefPool::new(START, 1);
    p.fund(FUNDED_200M).unwrap();
    p.start().unwrap();
    p.stake(0, huge, START).unwrap();
    p.advance(14 * 86_400).unwrap();
    // Sole staker with an absurd balance: still solvent, still no panic.
    let paid = p.claim(0, 14 * 86_400).unwrap();
    assert!(paid <= p.total_emitted);
    p.check_all().unwrap();
}

#[test]
fn accrual_reports_overflow_instead_of_truncating() {
    let snap = Snapshot {
        acc: 0,
        sum_acc: 0,
        k: 0,
    };
    // A bracket this large times a huge stake must overflow, not wrap.
    let res = accrual(u128::MAX / 2, &snap, 72, u128::MAX / 100, 0);
    assert_eq!(res, Err(MathError::Overflow));
}

// ------------------------------------------------------------------ 14 days

/// A full 14-day multi-user timeline, the Task 12 shape at the model level.
#[test]
fn full_fourteen_day_timeline_drains_to_dust() {
    const DAY: u64 = 86_400;
    let mut sim = funded_started_sim(FUNDED_200M);
    let r0 = sim.pool.base_rate;

    sim.stake(0, T35K * 4, 0).unwrap();
    sim.stake(1, T35K * 10, 6 * 3_600).unwrap();
    sim.claim(0, 2 * DAY).unwrap();
    sim.stake(2, T35K * 2, 2 * DAY + 1_800).unwrap();
    sim.compound(1, 3 * DAY).unwrap();
    sim.unstake(0, T35K, 5 * DAY).unwrap();
    sim.stake(3, T35K * 20, 7 * DAY).unwrap();
    sim.claim(2, 9 * DAY).unwrap();
    sim.compound(3, 11 * DAY).unwrap();
    sim.unstake(1, T35K * 5, 12 * DAY).unwrap();

    // Everyone exits at the end.
    for u in 0..USERS {
        sim.claim(u, 14 * DAY).unwrap();
    }
    sim.assert_equivalence().unwrap();
    sim.pool.check_all().unwrap();

    let p = &sim.pool;
    assert_eq!(p.total_emitted, r0 * DENOM);
    assert_eq!(FUNDED_200M - p.total_emitted, emission_dust(FUNDED_200M));

    let distributed = p.total_distributed();
    let undistributed = p.total_emitted - distributed - p.unallocated;

    println!();
    println!("=== 14-day timeline ===");
    for u in 0..USERS {
        let pos = &p.positions[u];
        println!(
            "user {u}: claimed {:>16}  compounded {:>14}  stake left {:>16}",
            pos.claimed, pos.compounded, pos.amount
        );
    }
    println!("funded              {:>18}", p.funded);
    println!("emitted             {:>18}", p.total_emitted);
    println!("distributed         {:>18}", distributed);
    println!("unallocated         {:>18}", p.unallocated);
    println!("rounding residue    {:>18}", undistributed);
    println!(
        "emission dust       {:>18}",
        FUNDED_200M - p.total_emitted
    );

    // Everything emitted is either paid out, parked as unallocated, or lost to
    // per-settlement flooring. Nothing may exceed what was emitted.
    assert!(distributed + p.unallocated <= p.total_emitted);
    // Flooring residue must stay negligible relative to the 200M pool.
    assert!(
        undistributed < 1_000_000,
        "rounding residue too large: {undistributed}"
    );
}

/// Test with a smaller deposit (10M) to prove the model is deposit-agnostic.
#[test]
fn full_timeline_with_10m_deposit() {
    const DAY: u64 = 86_400;
    const FUNDED_10M: u128 = 10_000_000_000_000;

    let mut sim = BruteSim::new(START, 2);
    sim.fund(FUNDED_10M).unwrap();
    sim.start().unwrap();

    sim.stake(0, T35K * 2, 0).unwrap();
    sim.stake(1, T35K * 4, DAY).unwrap();
    sim.claim(0, 7 * DAY).unwrap();
    sim.compound(1, 10 * DAY).unwrap();

    for u in 0..2 {
        sim.claim(u, 14 * DAY).unwrap();
    }
    sim.assert_equivalence().unwrap();
    sim.pool.check_all().unwrap();

    let p = &sim.pool;
    let r0 = p.base_rate;
    assert_eq!(p.total_emitted, r0 * DENOM);
    assert_eq!(FUNDED_10M - p.total_emitted, emission_dust(FUNDED_10M));
}
