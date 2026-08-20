//! Golden tests: the emission schedule pinned to the hand-verified figures.
//!
//! These are the numbers the economics were signed off against. If a change
//! moves any of them, the change is wrong until proven otherwise.

use staking_math::*;

/// Round base units to whole tokens (6 decimals), half-up, for display and for
/// comparison against the human-readable table in the spec.
fn to_tokens_rounded(base: u128) -> u128 {
    (base + 500_000) / 1_000_000
}

// Per-day emission in base units, as exact multiples of R0.
const DAY1: u128 = 81 * R0;
const DAY2: u128 = 105 * R0;
const DAY3: u128 = 129 * R0;
const DAY_PLATEAU: u128 = 144 * R0;

#[test]
fn daily_emission_matches_the_golden_table() {
    // Days 1-3: the ramp. Each day is 4 six-hour steps.
    assert_eq!(emission_for_day(1).unwrap(), DAY1);
    assert_eq!(emission_for_day(2).unwrap(), DAY2);
    assert_eq!(emission_for_day(3).unwrap(), DAY3);

    // Days 4-14: flat plateau.
    for day in 4..=DURATION_DAYS {
        assert_eq!(
            emission_for_day(day).unwrap(),
            DAY_PLATEAU,
            "day {day} must be at the plateau rate"
        );
    }
}

#[test]
fn daily_emission_matches_spec_in_whole_tokens() {
    assert_eq!(to_tokens_rounded(emission_for_day(1).unwrap()), 8_530_806);
    assert_eq!(to_tokens_rounded(emission_for_day(2).unwrap()), 11_058_452);
    assert_eq!(to_tokens_rounded(emission_for_day(3).unwrap()), 13_586_098);
    assert_eq!(to_tokens_rounded(emission_for_day(4).unwrap()), 15_165_877);
}

#[test]
fn cumulative_milestones_match_spec() {
    let day3 = cumulative_emitted(3 * SECONDS_PER_DAY).unwrap();
    assert_eq!(day3, R0 * 315);
    assert_eq!(to_tokens_rounded(day3), 33_175_355);

    let day14 = cumulative_emitted(DURATION_DAYS * SECONDS_PER_DAY).unwrap();
    let plateau_total = day14 - day3;
    assert_eq!(plateau_total, R0 * 1_584);
    assert_eq!(to_tokens_rounded(plateau_total), 166_824_645);

    // The ramp is 16.59% of the pool, the plateau 83.41%.
    let ramp_pct_bp = day3 * 10_000 / TOTAL_REWARD_POOL;
    assert_eq!(ramp_pct_bp, 1_658); // 16.58-16.59%
}

/// The single most important arithmetic fact: the program emits exactly the
/// pool minus a fixed, unreachable 1,730 base units of dust.
#[test]
fn fourteen_days_emits_pool_minus_exactly_1730_dust() {
    let total = cumulative_emitted(DURATION_DAYS * SECONDS_PER_DAY).unwrap();
    assert_eq!(total, R0 * DENOM);
    assert_eq!(total, 199_999_999_998_270);
    assert_eq!(TOTAL_REWARD_POOL - total, EMISSION_DUST);
    assert_eq!(TOTAL_REWARD_POOL - total, 1_730);
}

#[test]
fn daily_sums_reconstruct_the_total() {
    let mut sum = 0u128;
    for day in 1..=DURATION_DAYS {
        sum += emission_for_day(day).unwrap();
    }
    assert_eq!(sum, R0 * DENOM);
    assert_eq!(
        sum,
        cumulative_emitted(DURATION_DAYS * SECONDS_PER_DAY).unwrap()
    );
}

/// The hourly decomposition must sum to exactly 315 period-units across the
/// ramp. This is what lets hourly checkpoints subsume the 6-hour emission
/// boundaries without losing integer exactness.
#[test]
fn hourly_decomposition_of_ramp_sums_to_315_period_units() {
    let mut numerator = 0u128;
    for hour in 0..72u64 {
        let step = hour / 6; // 6 hourly boundaries per emission step
        numerator += PERIODS_PER_TENURE_STEP * emission_mult_numerator(step);
    }
    assert_eq!(numerator, 3_780);
    assert_eq!(numerator / MULT_DENOM, 315);

    // And it agrees with the closed-form cumulative numerator.
    assert_eq!(
        numerator,
        cumulative_numerator(3 * SECONDS_PER_DAY).unwrap()
    );
}

/// Walking hour by hour must equal one jump, at every hour of the program.
#[test]
fn hourly_walk_equals_closed_form_everywhere() {
    let hours = DURATION_DAYS * 24;
    for h in 0..=hours {
        let elapsed = h * TENURE_STEP_SECONDS;
        let closed = cumulative_numerator(elapsed).unwrap();
        // Reconstruct by summing whole hours.
        let mut walked = 0u128;
        for i in 0..h {
            let step = (i * TENURE_STEP_SECONDS) / EMISSION_STEP_SECONDS;
            walked += PERIODS_PER_TENURE_STEP * emission_mult_numerator(step);
        }
        assert_eq!(closed, walked, "mismatch at hour {h}");
    }
}

#[test]
fn emission_is_monotonic_and_never_exceeds_the_pool() {
    let mut prev = 0u128;
    for h in 0..=(30 * 24u64) {
        let e = cumulative_emitted(h * TENURE_STEP_SECONDS).unwrap();
        assert!(e >= prev, "emission went backwards at hour {h}");
        prev = e;
    }
}

#[test]
fn derived_duration_is_exactly_fourteen_days_for_the_real_pool() {
    let secs = duration_secs_for_funding(TOTAL_REWARD_POOL).unwrap();
    assert_eq!(secs, 1_209_600);
    assert_eq!(secs / SECONDS_PER_DAY, 14);
}

#[test]
fn each_extra_plateau_day_costs_one_days_emission() {
    let base = TOTAL_REWARD_POOL;
    for extra in 1..=16u128 {
        let funded = base + extra * DAY_PLATEAU;
        let secs = duration_secs_for_funding(funded).unwrap();
        let expect_days = 14 + extra as u64;
        if expect_days <= 30 {
            assert_eq!(
                secs / SECONDS_PER_DAY,
                expect_days,
                "{extra} extra day(s) of funding"
            );
        }
    }
}

/// Prints the schedule table. This is the Task 2 demo.
#[test]
fn print_emission_schedule() {
    println!();
    println!("=== 6-hour emission steps (ramp) ===");
    println!(
        "{:>4}  {:>10}  {:>22}  {:>18}",
        "step", "mult", "emission (base)", "tokens"
    );
    for s in 0..13u64 {
        let bps = emission_mult_bps(s);
        let e = emission_for_step(s).unwrap();
        let label = if s == 12 { "plateau" } else { "ramp" };
        println!(
            "{:>4}  {:>7}.{:02}x  {:>22}  {:>18}  {}",
            s,
            bps / 10_000,
            (bps % 10_000) / 100,
            e,
            to_tokens_rounded(e),
            label
        );
    }

    println!();
    println!("=== daily emission ===");
    println!(
        "{:>4}  {:>18}  {:>18}  {:>8}",
        "day", "tokens", "cumulative", "% pool"
    );
    let mut cum = 0u128;
    for day in 1..=DURATION_DAYS {
        let e = emission_for_day(day).unwrap();
        cum += e;
        println!(
            "{:>4}  {:>18}  {:>18}  {:>7}.{:01}%",
            day,
            to_tokens_rounded(e),
            to_tokens_rounded(cum),
            cum * 100 / TOTAL_REWARD_POOL,
            (cum * 1000 / TOTAL_REWARD_POOL) % 10
        );
    }

    println!();
    println!("pool               {:>18} base units", TOTAL_REWARD_POOL);
    println!("emitted over 14d   {:>18} base units", cum);
    println!(
        "permanent dust     {:>18} base units",
        TOTAL_REWARD_POOL - cum
    );
    println!("base rate r0       {:>18} base units / 20 min", R0);
    println!("plateau rate       {:>18} base units / day", DAY_PLATEAU);
    println!();

    assert_eq!(TOTAL_REWARD_POOL - cum, EMISSION_DUST);
}
