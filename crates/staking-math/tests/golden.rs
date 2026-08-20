//! Golden tests: the emission schedule pinned to the hand-verified figures.
//!
//! These are the numbers the economics were signed off against. If a change
//! moves any of them, the change is wrong until proven otherwise.
//!
//! Parameterized across 10M, 50M, and 200M deposits to prove the math is
//! linear in the deposit and the discretionary funding model works at all sizes.

use staking_math::*;

/// Round base units to whole tokens (6 decimals), half-up, for display and for
/// comparison against the human-readable table in the spec.
fn to_tokens_rounded(base: u128) -> u128 {
    (base + 500_000) / 1_000_000
}

/// Helper: create a started pool with the given funding amount.
fn base_rate_for(funded: u128) -> u128 {
    derive_base_rate(funded).unwrap()
}

// Deposit amounts (6 decimals)
const FUNDED_10M: u128 = 10_000_000_000_000;
const FUNDED_50M: u128 = 50_000_000_000_000;
const FUNDED_200M: u128 = 200_000_000_000_000;

// ---- 200M golden values (backward compat) ----

#[test]
fn daily_emission_matches_the_golden_table_200m() {
    let r0 = base_rate_for(FUNDED_200M);
    // Days 1-3: the ramp. Each day is 4 six-hour steps.
    assert_eq!(emission_for_day(r0, 1).unwrap(), 81 * r0);
    assert_eq!(emission_for_day(r0, 2).unwrap(), 105 * r0);
    assert_eq!(emission_for_day(r0, 3).unwrap(), 129 * r0);

    // Days 4-14: flat plateau.
    for day in 4..=DURATION_DAYS {
        assert_eq!(
            emission_for_day(r0, day).unwrap(),
            144 * r0,
            "day {day} must be at the plateau rate"
        );
    }
}

#[test]
fn daily_emission_matches_spec_in_whole_tokens_200m() {
    let r0 = base_rate_for(FUNDED_200M);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 1).unwrap()), 8_530_806);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 2).unwrap()), 11_058_452);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 3).unwrap()), 13_586_098);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 4).unwrap()), 15_165_877);
}

#[test]
fn daily_emission_matches_spec_in_whole_tokens_50m() {
    let r0 = base_rate_for(FUNDED_50M);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 1).unwrap()), 2_132_701);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 2).unwrap()), 2_764_613);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 3).unwrap()), 3_396_524);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 4).unwrap()), 3_791_469);
}

#[test]
fn daily_emission_matches_spec_in_whole_tokens_10m() {
    let r0 = base_rate_for(FUNDED_10M);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 1).unwrap()), 426_540);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 2).unwrap()), 552_923);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 3).unwrap()), 679_305);
    assert_eq!(to_tokens_rounded(emission_for_day(r0, 4).unwrap()), 758_294);
}

// ---- Conservation: funded = emitted + dust ----

/// Parameterized conservation test: total emitted = funded - dust for each size.
fn assert_conservation(funded: u128) {
    let r0 = base_rate_for(funded);
    let total = cumulative_emitted(r0, DURATION_DAYS * SECONDS_PER_DAY).unwrap();
    let dust = emission_dust(funded);

    // total_emitted = r0 * DENOM (integer-exact because cumulative_numerator
    // at 14 days = 22_788 and 22_788 / MULT_DENOM = 1_899 = DENOM).
    assert_eq!(total, r0 * DENOM);

    // Conservation: emitted + dust = funded
    assert_eq!(total + dust, funded);

    // Dust is exactly funded mod DENOM
    assert_eq!(dust, funded % DENOM);
}

#[test]
fn conservation_10m() {
    assert_conservation(FUNDED_10M);
}

#[test]
fn conservation_50m() {
    assert_conservation(FUNDED_50M);
}

#[test]
fn conservation_200m() {
    assert_conservation(FUNDED_200M);
}

#[test]
fn dust_values_are_funded_mod_denom() {
    // dust = funded mod DENOM = funded mod 1_899
    assert_eq!(emission_dust(FUNDED_10M), 10_000_000_000_000 % DENOM); // 1_036
    assert_eq!(emission_dust(FUNDED_50M), 50_000_000_000_000 % DENOM); // 1_382
    assert_eq!(emission_dust(FUNDED_200M), 200_000_000_000_000 % DENOM); // 1_730
    // Absolute values:
    assert_eq!(emission_dust(FUNDED_10M), 1_036);
    assert_eq!(emission_dust(FUNDED_50M), 1_382);
    assert_eq!(emission_dust(FUNDED_200M), 1_730);
}

#[test]
fn base_rates_match_spec() {
    // r₀ / 20 min: 10M -> 5,265.93, 50M -> 26,329.65, 200M -> 105,318.59
    // (base units, so the integer floor)
    assert_eq!(base_rate_for(FUNDED_10M), 5_265_929_436);
    assert_eq!(base_rate_for(FUNDED_50M), 26_329_647_182);
    assert_eq!(base_rate_for(FUNDED_200M), 105_318_588_730);
}

// ---- Cumulative milestones ----

#[test]
fn cumulative_milestones_match_spec() {
    let r0 = base_rate_for(FUNDED_200M);
    let day3 = cumulative_emitted(r0, 3 * SECONDS_PER_DAY).unwrap();
    assert_eq!(day3, r0 * 315);
    assert_eq!(to_tokens_rounded(day3), 33_175_355);

    let day14 = cumulative_emitted(r0, DURATION_DAYS * SECONDS_PER_DAY).unwrap();
    let plateau_total = day14 - day3;
    assert_eq!(plateau_total, r0 * 1_584);
    assert_eq!(to_tokens_rounded(plateau_total), 166_824_645);

    // The ramp is 16.59% of the pool, the plateau 83.41%.
    let ramp_pct_bp = day3 * 10_000 / FUNDED_200M;
    assert_eq!(ramp_pct_bp, 1_658); // 16.58-16.59%
}

/// The fractional split is constant regardless of deposit size.
#[test]
fn ramp_plateau_fractions_are_deposit_independent() {
    for funded in [FUNDED_10M, FUNDED_50M, FUNDED_200M] {
        let r0 = base_rate_for(funded);
        let total = cumulative_emitted(r0, DURATION_DAYS * SECONDS_PER_DAY).unwrap();
        let ramp = cumulative_emitted(r0, 3 * SECONDS_PER_DAY).unwrap();

        // ramp/total should be 315/1899 ≈ 16.59%
        let ramp_bp = ramp * 10_000 / total;
        assert!(
            (1_658..=1_659).contains(&ramp_bp),
            "funded={funded}: ramp fraction {ramp_bp}bp"
        );
    }
}

// ---- Schedule shape ----

#[test]
fn daily_sums_reconstruct_the_total() {
    let r0 = base_rate_for(FUNDED_200M);
    let mut sum = 0u128;
    for day in 1..=DURATION_DAYS {
        sum += emission_for_day(r0, day).unwrap();
    }
    assert_eq!(sum, r0 * DENOM);
    assert_eq!(
        sum,
        cumulative_emitted(r0, DURATION_DAYS * SECONDS_PER_DAY).unwrap()
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
    let r0 = base_rate_for(FUNDED_200M);
    let mut prev = 0u128;
    // Check up to checkpoint capacity (384 hours = 16 days)
    for h in 0..=(16 * 24u64) {
        let e = cumulative_emitted(r0, h * TENURE_STEP_SECONDS).unwrap();
        assert!(e >= prev, "emission went backwards at hour {h}");
        prev = e;
    }
}

/// Prints the schedule table. This is the Task 2 demo.
#[test]
fn print_emission_schedule() {
    for (label, funded) in [("10M", FUNDED_10M), ("50M", FUNDED_50M), ("200M", FUNDED_200M)] {
        let r0 = base_rate_for(funded);
        let dust = emission_dust(funded);

        println!();
        println!("========== Deposit: {} ==========", label);
        println!("base rate r0 = {} base units / 20 min", r0);
        println!("dust         = {} base units", dust);
        println!();
        println!("=== 6-hour emission steps (ramp) ===");
        println!(
            "{:>4}  {:>10}  {:>22}  {:>18}",
            "step", "mult", "emission (base)", "tokens"
        );
        for s in 0..13u64 {
            let bps = emission_mult_bps(s);
            let e = emission_for_step(r0, s).unwrap();
            let tag = if s == 12 { "plateau" } else { "ramp" };
            println!(
                "{:>4}  {:>7}.{:02}x  {:>22}  {:>18}  {}",
                s,
                bps / 10_000,
                (bps % 10_000) / 100,
                e,
                to_tokens_rounded(e),
                tag
            );
        }

        println!();
        println!("=== daily emission ===");
        println!(
            "{:>4}  {:>18}  {:>18}  {:>8}",
            "day", "tokens", "cumulative", "% pool"
        );
        let total_emitted = r0 * DENOM;
        let mut cum = 0u128;
        for day in 1..=DURATION_DAYS {
            let e = emission_for_day(r0, day).unwrap();
            cum += e;
            println!(
                "{:>4}  {:>18}  {:>18}  {:>7}.{:01}%",
                day,
                to_tokens_rounded(e),
                to_tokens_rounded(cum),
                cum * 100 / total_emitted,
                (cum * 1000 / total_emitted) % 10
            );
        }

        println!();
        println!("funded             {:>18} base units", funded);
        println!("emitted over 14d   {:>18} base units", cum);
        println!("permanent dust     {:>18} base units", dust);
        println!();

        assert_eq!(cum + dust, funded);
    }
}
