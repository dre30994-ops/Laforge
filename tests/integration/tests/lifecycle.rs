//! Full program lifecycle integration tests.
//!
//! These tests load the compiled staking.so into solana-program-test,
//! exercise the complete instruction set, warp the clock for time-dependent
//! logic, and verify invariants match the pure math crate.

use solana_program_test::*;
use solana_sdk::{
    clock::Clock,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::Transaction,
    sysvar::Sysvar,
};

// Import specific items from staking-math to avoid MIN_STAKE conflict
use staking_math::{derive_base_rate, emission_dust, DENOM};

#[path = "../src/helpers.rs"]
mod helpers;
use helpers::*;

/// Warp the clock forward by `delta` seconds.
async fn warp_clock(ptc: &mut ProgramTestContext, delta: i64) {
    let clock: Clock = ptc.banks_client.get_sysvar().await.unwrap();
    let mut new_clock = clock.clone();
    new_clock.unix_timestamp += delta;
    new_clock.slot += (delta as u64) * 3; // ~3 slots per second (rough)
    ptc.set_sysvar(&new_clock);
    // Also advance the slot to avoid "already processed" errors
    ptc.warp_to_slot(new_clock.slot + 1).unwrap();
}

// ============================================================
// Test 1: Initialization and funding
// ============================================================

#[tokio::test]
async fn test_initialize_and_fund() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert!(!pool.started);
    assert_eq!(pool.funded_amount, 0);

    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.funded_amount, MIN_FUNDING);
    assert!(!pool.started);
}

#[tokio::test]
async fn test_start_pool_derives_correct_rate() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert!(pool.started);

    let expected_rate = derive_base_rate(MIN_FUNDING as u128).unwrap();
    assert_eq!(pool.base_rate_per_period, expected_rate as u64);
    assert_eq!(pool.end_ts - pool.start_ts, 14 * DAY);
}

#[tokio::test]
async fn test_start_rejects_insufficient_funding() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING - 1).await;

    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    let ix = ix_start_pool(&tctx.pid, &tctx.authority.pubkey(), &tctx.pool);
    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&tctx.authority.pubkey()), &[&tctx.authority], bh,
    );
    let result = ptc.banks_client.process_transaction(tx).await;
    assert!(result.is_err(), "start_pool should reject insufficient funding");
}

// ============================================================
// Test 2: Stake + Crank
// ============================================================

/// Helper to create a funded staker with token account.
async fn setup_staker(
    ptc: &mut ProgramTestContext,
    tctx: &TestContext,
    payer: &Keypair,
    token_amount: u64,
) -> (Keypair, Pubkey, Pubkey) {
    let staker = Keypair::new();
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[system_instruction::transfer(&payer.pubkey(), &staker.pubkey(), 10_000_000_000)],
        Some(&payer.pubkey()), &[payer], bh,
    )).await.unwrap();

    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    let ata = create_token_account(&mut ptc.banks_client, &staker, &tctx.mint, &staker.pubkey(), bh).await;
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    mint_to(&mut ptc.banks_client, &tctx.authority, &tctx.mint, &ata, &tctx.authority, token_amount, bh).await;

    let (pos, _) = position_pda(&tctx.pool, &staker.pubkey(), &tctx.pid);
    (staker, ata, pos)
}

#[tokio::test]
async fn test_stake_and_crank() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    let (staker, staker_ata, position) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 2).await;

    // Stake
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    // Debug: verify pool is started before staking
    let pool_check = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    eprintln!("DEBUG: pool.started={} pool.funded={} pool.base_rate={}", pool_check.started, pool_check.funded_amount, pool_check.base_rate_per_period);
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.total_staked, MIN_STAKE as u128);
    assert_eq!(pool.total_weight, MIN_STAKE as u128 * 72);

    // Warp 1 hour
    warp_clock(&mut ptc, HOUR).await;

    // Crank
    tctx.crank(&mut ptc.banks_client, 250).await;

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert!(pool.total_emitted > 0, "should emit after crank");
    assert!(pool.acc_reward_per_weight > 0, "A should advance");
}

// ============================================================
// Test 3: Two equal stakers get equal rewards
// ============================================================

#[tokio::test]
async fn test_two_stakers_equal_split() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    let (s1, ata1, pos1) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 4).await;
    let (s2, ata2, pos2) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 4).await;

    // Both stake equal amounts
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &s1.pubkey(), &tctx.pool, &pos1, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &ata1, MIN_STAKE)],
        Some(&s1.pubkey()), &[&s1], bh,
    )).await.unwrap();

    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &s2.pubkey(), &tctx.pool, &pos2, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &ata2, MIN_STAKE)],
        Some(&s2.pubkey()), &[&s2], bh,
    )).await.unwrap();

    // Warp 4 days (96 hourly boundaries)
    tctx.crank_to_current(&mut ptc, 4 * DAY).await;

    // Claim
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_claim(&tctx.pid, &s1.pubkey(), &tctx.pool, &pos1, &tctx.schedule, &tctx.reward_vault, &tctx.mint, &ata1)],
        Some(&s1.pubkey()), &[&s1], bh,
    )).await.unwrap();

    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_claim(&tctx.pid, &s2.pubkey(), &tctx.pool, &pos2, &tctx.schedule, &tctx.reward_vault, &tctx.mint, &ata2)],
        Some(&s2.pubkey()), &[&s2], bh,
    )).await.unwrap();

    let bal1 = token_balance(&mut ptc.banks_client, &ata1).await;
    let bal2 = token_balance(&mut ptc.banks_client, &ata2).await;
    let payout1 = bal1 - MIN_STAKE * 3;
    let payout2 = bal2 - MIN_STAKE * 3;

    assert_eq!(payout1, payout2, "equal stakers got different rewards: {payout1} vs {payout2}");
    assert!(payout1 > 0, "should have earned rewards");

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert!((payout1 as u128 + payout2 as u128) <= pool.total_emitted);
}

// ============================================================
// Test 4: Unstake resets tenure
// ============================================================

#[tokio::test]
async fn test_unstake_resets_tenure() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    let (staker, staker_ata, position) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 4).await;

    // Stake 2x minimum
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, MIN_STAKE * 2)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    // Warp 4 days (mature to 2.0x)
    tctx.crank_to_current(&mut ptc, 4 * DAY).await;

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.total_weight, (MIN_STAKE as u128) * 2 * 144);

    // Partial unstake
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_unstake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, &tctx.treasury_token_account, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    // Remaining MIN_STAKE at 1.0x (k=0) -> weight = MIN_STAKE * 72
    assert_eq!(pool.total_weight, (MIN_STAKE as u128) * 72);
    assert_eq!(pool.total_staked, MIN_STAKE as u128);
}

// ============================================================
// Test 5: Pause blocks stake, allows unstake
// ============================================================

#[tokio::test]
async fn test_pause_blocks_entry_allows_exit() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    let (staker, staker_ata, position) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 4).await;

    // Stake
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    // Pause
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_set_paused(&tctx.pid, &tctx.authority.pubkey(), &tctx.pool, true)],
        Some(&tctx.authority.pubkey()), &[&tctx.authority], bh,
    )).await.unwrap();

    // Stake should fail
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    let result = ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await;
    assert!(result.is_err(), "stake should be rejected while paused");

    // Unstake should succeed
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_unstake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, &tctx.treasury_token_account, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();
}

// ============================================================
// Test 6: Conservation over full 14-day program
// ============================================================

#[tokio::test]
async fn test_conservation_full_program() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    let funded = 50_000_000_000_000u64; // 50M
    tctx.fund(&mut ptc.banks_client, funded).await;
    tctx.start(&mut ptc.banks_client).await;

    let (staker, staker_ata, position) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 10).await;

    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    // Warp to end of program (14 days) and crank fully
    tctx.crank_to_current(&mut ptc, 14 * DAY).await;

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;

    // Conservation: total_emitted ≈ base_rate * DENOM
    // The on-chain crank floors each hourly emission independently, losing up
    // to 1 base unit per boundary (336 max). The cumulative approach would give
    // exactly base_rate * DENOM, but per-boundary flooring gives slightly less.
    let expected_emitted = pool.base_rate_per_period as u128 * DENOM;
    let rounding_dust = expected_emitted - pool.total_emitted;
    assert!(
        rounding_dust <= 336, // at most 1 unit lost per hourly boundary
        "rounding dust {} exceeds 336 boundary cap",
        rounding_dust
    );

    // Total funds conservation: emitted + funding_dust + rounding_dust = funded
    let funding_dust = emission_dust(funded as u128);
    assert_eq!(
        pool.total_emitted + funding_dust + rounding_dust,
        funded as u128,
        "conservation violated"
    );

    // Claim
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    let claim_result = ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_claim(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.reward_vault, &tctx.mint, &staker_ata)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await;
    if let Err(e) = &claim_result {
        eprintln!("claim failed: {e:?}");
        let pool_dbg = read_pool(&mut ptc.banks_client, &tctx.pool).await;
        eprintln!("pool: total_emitted={} total_claimed={} unallocated={}", pool_dbg.total_emitted, pool_dbg.total_claimed, pool_dbg.unallocated);
    }
    claim_result.unwrap();

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert!(pool.total_claimed + pool.unallocated + funding_dust + rounding_dust <= funded as u128, "overpaid");
}

// ============================================================
// Test 7: Only the operator may fund rewards
// ============================================================

#[tokio::test]
async fn test_fund_rejects_non_operator() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;

    // Under the test-operator feature, the operator == tctx.authority.
    // Build a DIFFERENT funder with its own token account and tokens.
    let intruder = Keypair::new();
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[system_instruction::transfer(&payer.pubkey(), &intruder.pubkey(), 5_000_000_000)],
        Some(&payer.pubkey()), &[&payer], bh,
    )).await.unwrap();

    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    let intruder_ata = create_token_account(&mut ptc.banks_client, &intruder, &tctx.mint, &intruder.pubkey(), bh).await;
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    mint_to(&mut ptc.banks_client, &tctx.authority, &tctx.mint, &intruder_ata, &tctx.authority, MIN_FUNDING, bh).await;

    // Intruder attempts to fund — must be rejected (NotOperator).
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    let ix = ix_fund_rewards(
        &tctx.pid,
        &intruder.pubkey(),
        &tctx.pool,
        &tctx.reward_vault,
        &tctx.mint,
        &intruder_ata,
        MIN_FUNDING,
    );
    let result = ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix], Some(&intruder.pubkey()), &[&intruder], bh,
    )).await;
    assert!(result.is_err(), "non-operator funding should be rejected");

    // Vault must be untouched.
    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.funded_amount, 0, "funded_amount changed despite rejection");

    // The operator (authority) CAN fund.
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.funded_amount, MIN_FUNDING, "operator funding should succeed");
}

// ============================================================
// Test 8: 5% unstake tax is routed to the treasury
// ============================================================

#[tokio::test]
async fn test_unstake_tax_goes_to_treasury() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    let (staker, staker_ata, position) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 4).await;

    // Stake 2x minimum so a partial unstake of MIN_STAKE leaves a valid position.
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, MIN_STAKE * 2)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    let user_before = token_balance(&mut ptc.banks_client, &staker_ata).await;
    let treasury_before = token_balance(&mut ptc.banks_client, &tctx.treasury_token_account).await;
    assert_eq!(treasury_before, 0, "treasury starts empty");

    // Unstake MIN_STAKE. Expect 5% tax to treasury, 95% to the user.
    let unstake_amount = MIN_STAKE;
    let expected_tax = unstake_amount * UNSTAKE_TAX_BPS / BPS_DENOM;
    let expected_to_user = unstake_amount - expected_tax;

    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_unstake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, &tctx.treasury_token_account, unstake_amount)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    let user_after = token_balance(&mut ptc.banks_client, &staker_ata).await;
    let treasury_after = token_balance(&mut ptc.banks_client, &tctx.treasury_token_account).await;

    // 5% of 35,000 tokens = 1,750 tokens.
    assert_eq!(expected_tax, 1_750_000_000, "tax should be 5% of the unstaked amount");
    assert_eq!(
        treasury_after - treasury_before,
        expected_tax,
        "treasury should receive exactly the 5% tax"
    );
    assert_eq!(
        user_after - user_before,
        expected_to_user,
        "user should receive the post-tax amount (95%)"
    );

    // Tax + user amount must reconstruct the full unstaked amount (no dust lost).
    assert_eq!(
        (treasury_after - treasury_before) + (user_after - user_before),
        unstake_amount,
        "tax + payout must equal the unstaked amount"
    );
}


// ============================================================
// Test 9: Sweep guards — rejected while active and before 12h
// ============================================================

#[tokio::test]
async fn test_sweep_rejected_when_active_or_too_early() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    // Stake so the pool has active stake; sweep must fail (StakesActive).
    let (staker, staker_ata, position) = setup_staker(&mut ptc, &tctx, &payer, MIN_STAKE * 2).await;
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_stake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    let result = tctx.sweep(&mut ptc.banks_client).await;
    assert!(result.is_err(), "sweep should be rejected while stakes are active");

    // Unstake to zero; last_nonzero_stake_ts is set to `now`. Sweeping
    // immediately (before 12h) must fail with SweepTooEarly.
    let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
    ptc.banks_client.process_transaction(Transaction::new_signed_with_payer(
        &[ix_unstake(&tctx.pid, &staker.pubkey(), &tctx.pool, &position, &tctx.schedule, &tctx.stake_vault, &tctx.mint, &staker_ata, &tctx.treasury_token_account, MIN_STAKE)],
        Some(&staker.pubkey()), &[&staker], bh,
    )).await.unwrap();

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.total_staked, 0, "should be empty after unstake");

    let result = tctx.sweep(&mut ptc.banks_client).await;
    assert!(result.is_err(), "sweep should be rejected before the 12h empty window elapses");
}

// ============================================================
// Test 10: Sweep after 12h empty returns operator surplus only
// ============================================================

#[tokio::test]
async fn test_sweep_after_12h_empty_returns_surplus_to_operator() {
    let pt = setup_program_test();
    let mut ptc = pt.start_with_context().await;
    let payer = ptc.payer.insecure_clone();

    let tctx = TestContext::new(&mut ptc.banks_client, &payer).await;
    tctx.fund(&mut ptc.banks_client, MIN_FUNDING).await;
    tctx.start(&mut ptc.banks_client).await;

    // Never staked -> total_staked == 0. Warp past the 12h empty window.
    warp_clock(&mut ptc, 13 * HOUR).await;

    let vault_before = token_balance(&mut ptc.banks_client, &tctx.reward_vault).await;
    let operator_before = token_balance(&mut ptc.banks_client, &tctx.authority_token_account).await;
    assert_eq!(vault_before, MIN_FUNDING, "reward vault holds the funded amount");

    // No emissions distributed (no crank / no stakers), so reserved == 0 and
    // the full operator deposit is sweepable.
    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.total_emitted, 0);
    assert_eq!(pool.total_claimed, 0);

    tctx.sweep(&mut ptc.banks_client).await.expect("sweep should succeed after 12h empty");

    let vault_after = token_balance(&mut ptc.banks_client, &tctx.reward_vault).await;
    let operator_after = token_balance(&mut ptc.banks_client, &tctx.authority_token_account).await;

    assert_eq!(vault_after, 0, "reward vault surplus should be swept");
    assert_eq!(
        operator_after - operator_before,
        MIN_FUNDING,
        "operator should receive the full deposited surplus"
    );

    let pool = read_pool(&mut ptc.banks_client, &tctx.pool).await;
    assert_eq!(pool.funded_amount, 0, "funded_amount reduced by swept surplus");

    // Advance a slot so the second sweep is a distinct transaction (avoids
    // blockhash-based dedup in the harness) and confirm it now fails.
    let cur = ptc.banks_client.get_sysvar::<Clock>().await.unwrap();
    ptc.warp_to_slot(cur.slot + 100).unwrap();

    let result = tctx.sweep(&mut ptc.banks_client).await;
    assert!(result.is_err(), "second sweep should fail (nothing to sweep)");
}
