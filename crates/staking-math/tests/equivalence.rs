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
const T50K: u128 = 50_000_000_000;

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
        3 => (0..USERS, T50K..(T50K * 40)).prop_map(|(u, a)| Op::Stake(u, a)),
        2 => (0..USERS, 1u8..=100).prop_map(|(u, p)| Op::Unstake(u, p)),
        2 => (0..USERS).prop_map(Op::Claim),
        1 => (0..USERS).prop_map(Op::Compound),
    ]
}

/// Drive a sequence of operations, checking invariants after every step.
fn run(ops: &[Op], gaps: &[u64]) -> Result<BruteSim, String> {
    let mut sim = BruteSim::new(START, USERS);
    sim.fund(TOTAL_REWARD_POOL)
        .map_err(|e| format!("fund: {e:?}"))?;

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
        stakes in prop::collection::vec(T50K..(T50K * 100), 1..USERS),
        offsets in prop::collection::vec(0u64..(4 * 86_400), 1..USERS),
        probe in 0u64..(20 * 86_400),
    ) {
        let mut p = RefPool::new(START, USERS);
        p.fund(TOTAL_REWARD_POOL).unwrap();

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
    p.fund(TOTAL_REWARD_POOL).unwrap();
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
    let mut sim = BruteSim::new(START, USERS);
    sim.fund(TOTAL_REWARD_POOL).unwrap();

    sim.stake(0, T50K * 4, 0).unwrap();
    sim.stake(1, T50K * 10, 6 * 3_600).unwrap();
    sim.claim(0, 2 * DAY).unwrap();
    sim.stake(2, T50K * 2, 2 * DAY + 1_800).unwrap();
    sim.compound(1, 3 * DAY).unwrap();
    sim.unstake(0, T50K, 5 * DAY).unwrap();
    sim.stake(3, T50K * 20, 7 * DAY).unwrap();
    sim.claim(2, 9 * DAY).unwrap();
    sim.compound(3, 11 * DAY).unwrap();
    sim.unstake(1, T50K * 5, 12 * DAY).unwrap();

    // Everyone exits at the end.
    for u in 0..USERS {
        sim.claim(u, 14 * DAY).unwrap();
    }
    sim.assert_equivalence().unwrap();
    sim.pool.check_all().unwrap();

    let p = &sim.pool;
    assert_eq!(p.total_emitted, R0 * DENOM);
    assert_eq!(TOTAL_REWARD_POOL - p.total_emitted, EMISSION_DUST);

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
        TOTAL_REWARD_POOL - p.total_emitted
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
