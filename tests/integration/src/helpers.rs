//! Test harness helpers using solana-program-test.
//!
//! Builds raw Anchor-compatible instructions using the discriminator hash pattern.
//! Each instruction matches the on-chain program's accounts and serialization.

use borsh::BorshSerialize;
use sha2::{Digest, Sha256};
use solana_program_test::{BanksClient, ProgramTest};
use solana_sdk::{
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    sysvar,
    transaction::Transaction,
};

// ============================================================
// Constants
// ============================================================

pub const DECIMALS: u8 = 6;
pub const MIN_STAKE: u64 = 35_000_000_000; // 35,000 tokens
pub const MIN_FUNDING: u64 = 10_000_000_000_000; // 10M tokens
pub const HOUR: i64 = 3_600;
pub const DAY: i64 = 86_400;

/// The hardcoded treasury wallet (must match crate::TREASURY in the program).
pub fn treasury_pubkey() -> Pubkey {
    "BzwWjFrwuA31rvcJShTgvmNYnirpkp19Q4ijunj5pbuk".parse().unwrap()
}

/// Unstake tax basis points and denominator (must match the program).
pub const UNSTAKE_TAX_BPS: u64 = 500;
pub const BPS_DENOM: u64 = 10_000;

/// Schedule account space: 8 (disc) + 32 (pool) + 4 + 4 + 8 (pad) + 384*32 + 464*8
pub const SCHEDULE_SPACE: usize = 8 + 32 + 4 + 4 + 8 + (384 * 32) + (464 * 8);

// ============================================================
// Program ID
// ============================================================

pub fn program_id() -> Pubkey {
    let path = std::env::var("STAKING_KEYPAIR")
        .unwrap_or_else(|_| "../../target/deploy/staking-keypair.json".to_string());
    let bytes = std::fs::read(&path)
        .unwrap_or_else(|_| panic!("Cannot read keypair at {path}"));
    let keypair_bytes: Vec<u8> = serde_json::from_slice(&bytes).unwrap();
    Keypair::from_bytes(&keypair_bytes).unwrap().pubkey()
}

// ============================================================
// Discriminator
// ============================================================

pub fn disc(name: &str) -> [u8; 8] {
    let mut h = Sha256::new();
    h.update(format!("global:{name}").as_bytes());
    let hash = h.finalize();
    hash[..8].try_into().unwrap()
}

// ============================================================
// PDA helpers
// ============================================================

pub fn pool_pda(mint: &Pubkey, pid: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"pool", mint.as_ref()], pid)
}

pub fn stake_vault_pda(pool: &Pubkey, pid: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"stake_vault", pool.as_ref()], pid)
}

pub fn reward_vault_pda(pool: &Pubkey, pid: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"reward_vault", pool.as_ref()], pid)
}

pub fn position_pda(pool: &Pubkey, owner: &Pubkey, pid: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"position", pool.as_ref(), owner.as_ref()], pid)
}

// ============================================================
// Setup
// ============================================================

pub fn setup_program_test() -> ProgramTest {
    let pid = program_id();
    // Point solana-program-test to where our .so lives.
    // It looks for `<program_name>.so` in SBF_OUT_DIR.
    std::env::set_var("SBF_OUT_DIR", "../../target/deploy");
    let mut pt = ProgramTest::new("staking", pid, None);
    pt.prefer_bpf(true);
    pt
}

// ============================================================
// Token helpers
// ============================================================

pub async fn create_mint(
    banks: &mut BanksClient,
    payer: &Keypair,
    authority: &Pubkey,
    recent_blockhash: solana_sdk::hash::Hash,
) -> Pubkey {
    let mint_kp = Keypair::new();
    let rent = banks.get_rent().await.unwrap();
    let lamports = rent.minimum_balance(spl_token::state::Mint::LEN);

    let tx = Transaction::new_signed_with_payer(
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &mint_kp.pubkey(),
                lamports,
                spl_token::state::Mint::LEN as u64,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_mint2(
                &spl_token::id(),
                &mint_kp.pubkey(),
                authority,
                None,
                DECIMALS,
            )
            .unwrap(),
        ],
        Some(&payer.pubkey()),
        &[payer, &mint_kp],
        recent_blockhash,
    );
    banks.process_transaction(tx).await.unwrap();
    mint_kp.pubkey()
}

pub async fn create_token_account(
    banks: &mut BanksClient,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
    recent_blockhash: solana_sdk::hash::Hash,
) -> Pubkey {
    let account_kp = Keypair::new();
    let rent = banks.get_rent().await.unwrap();
    let lamports = rent.minimum_balance(spl_token::state::Account::LEN);

    let tx = Transaction::new_signed_with_payer(
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &account_kp.pubkey(),
                lamports,
                spl_token::state::Account::LEN as u64,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_account(
                &spl_token::id(),
                &account_kp.pubkey(),
                mint,
                owner,
            )
            .unwrap(),
        ],
        Some(&payer.pubkey()),
        &[payer, &account_kp],
        recent_blockhash,
    );
    banks.process_transaction(tx).await.unwrap();
    account_kp.pubkey()
}

pub async fn mint_to(
    banks: &mut BanksClient,
    payer: &Keypair,
    mint: &Pubkey,
    dest: &Pubkey,
    authority: &Keypair,
    amount: u64,
    recent_blockhash: solana_sdk::hash::Hash,
) {
    let tx = Transaction::new_signed_with_payer(
        &[spl_token::instruction::mint_to(
            &spl_token::id(),
            mint,
            dest,
            &authority.pubkey(),
            &[],
            amount,
        )
        .unwrap()],
        Some(&payer.pubkey()),
        &[payer, authority],
        recent_blockhash,
    );
    banks.process_transaction(tx).await.unwrap();
}

pub async fn token_balance(banks: &mut BanksClient, account: &Pubkey) -> u64 {
    let acc = banks.get_account(*account).await.unwrap().unwrap();
    spl_token::state::Account::unpack(&acc.data).unwrap().amount
}

// ============================================================
// Instruction builders
// ============================================================

/// Build the initialize_pool instruction.
pub fn ix_initialize_pool(
    pid: &Pubkey,
    authority: &Pubkey,
    mint: &Pubkey,
    pool: &Pubkey,
    stake_vault: &Pubkey,
    reward_vault: &Pubkey,
    schedule: &Pubkey,
    fee_recipient: &Pubkey,
    min_funding: u64,
    min_stake: u64,
) -> Instruction {
    // Anchor serialization: disc + InitializePoolParams { min_funding, min_stake }
    let mut data = disc("initialize_pool").to_vec();
    data.extend_from_slice(&min_funding.to_le_bytes());
    data.extend_from_slice(&min_stake.to_le_bytes());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new(*authority, true),         // authority (signer, mut)
            AccountMeta::new_readonly(*mint, false),    // mint
            AccountMeta::new(*pool, false),             // pool (init)
            AccountMeta::new(*stake_vault, false),      // stake_vault (init)
            AccountMeta::new(*reward_vault, false),     // reward_vault (init)
            AccountMeta::new(*schedule, false),         // schedule (zero)
            AccountMeta::new_readonly(spl_token::id(), false), // token_program
            AccountMeta::new(*fee_recipient, false),    // fee_recipient (mut)
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false), // system_program
        ],
        data,
    }
}

/// Build the fund_rewards instruction.
pub fn ix_fund_rewards(
    pid: &Pubkey,
    authority: &Pubkey,
    pool: &Pubkey,
    reward_vault: &Pubkey,
    mint: &Pubkey,
    authority_token_account: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = disc("fund_rewards").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*reward_vault, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*authority_token_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

/// Build the start_pool instruction.
pub fn ix_start_pool(pid: &Pubkey, authority: &Pubkey, pool: &Pubkey) -> Instruction {
    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*pool, false),
        ],
        data: disc("start_pool").to_vec(),
    }
}

/// Build the crank instruction.
pub fn ix_crank(
    pid: &Pubkey,
    payer: &Pubkey,
    pool: &Pubkey,
    schedule: &Pubkey,
    max_steps: u64,
) -> Instruction {
    let mut data = disc("crank").to_vec();
    data.extend_from_slice(&max_steps.to_le_bytes());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*payer, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*schedule, false),
        ],
        data,
    }
}

/// Build the stake instruction.
pub fn ix_stake(
    pid: &Pubkey,
    owner: &Pubkey,
    pool: &Pubkey,
    position: &Pubkey,
    schedule: &Pubkey,
    stake_vault: &Pubkey,
    mint: &Pubkey,
    user_token_account: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = disc("stake").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new(*owner, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*position, false),
            AccountMeta::new(*schedule, false),
            AccountMeta::new(*stake_vault, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*user_token_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data,
    }
}

/// Build the claim instruction.
pub fn ix_claim(
    pid: &Pubkey,
    owner: &Pubkey,
    pool: &Pubkey,
    position: &Pubkey,
    schedule: &Pubkey,
    reward_vault: &Pubkey,
    mint: &Pubkey,
    user_token_account: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*position, false),
            AccountMeta::new_readonly(*schedule, false),
            AccountMeta::new(*reward_vault, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*user_token_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: disc("claim").to_vec(),
    }
}

/// Build the unstake instruction.
pub fn ix_unstake(
    pid: &Pubkey,
    owner: &Pubkey,
    pool: &Pubkey,
    position: &Pubkey,
    schedule: &Pubkey,
    stake_vault: &Pubkey,
    mint: &Pubkey,
    user_token_account: &Pubkey,
    treasury_token_account: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = disc("unstake").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*position, false),
            AccountMeta::new(*schedule, false),
            AccountMeta::new(*stake_vault, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*user_token_account, false),
            AccountMeta::new(*treasury_token_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

/// Build the compound instruction.
pub fn ix_compound(
    pid: &Pubkey,
    owner: &Pubkey,
    pool: &Pubkey,
    position: &Pubkey,
    schedule: &Pubkey,
    reward_vault: &Pubkey,
    stake_vault: &Pubkey,
    mint: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*position, false),
            AccountMeta::new(*schedule, false),
            AccountMeta::new(*reward_vault, false),
            AccountMeta::new(*stake_vault, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: disc("compound").to_vec(),
    }
}

/// Build the sweep_to_operator instruction.
pub fn ix_sweep_to_operator(
    pid: &Pubkey,
    caller: &Pubkey,
    pool: &Pubkey,
    reward_vault: &Pubkey,
    mint: &Pubkey,
    operator_token_account: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*caller, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*reward_vault, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*operator_token_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: disc("sweep_to_operator").to_vec(),
    }
}

/// Build the set_paused instruction.
pub fn ix_set_paused(
    pid: &Pubkey,
    authority: &Pubkey,
    pool: &Pubkey,
    paused: bool,
) -> Instruction {
    let mut data = disc("set_paused").to_vec();
    data.push(paused as u8);

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*pool, false),
        ],
        data,
    }
}

// ============================================================
// Pool state deserialization (from raw account data, skip 8-byte discriminator)
// ============================================================

/// Read a u128 from a slice at a given offset.
fn read_u128(data: &[u8], offset: usize) -> u128 {
    u128::from_le_bytes(data[offset..offset + 16].try_into().unwrap())
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}

fn read_i64(data: &[u8], offset: usize) -> i64 {
    i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

/// Minimal Pool state extraction (key fields for assertions).
#[derive(Debug)]
pub struct PoolState {
    pub start_ts: i64,
    pub end_ts: i64,
    pub funded_amount: u64,
    pub base_rate_per_period: u64,
    pub started: bool,
    pub paused: bool,
    pub total_staked: u128,
    pub total_weight: u128,
    pub ramping_stake: u128,
    pub acc_reward_per_weight: u128,
    pub sum_acc_at_boundaries: u128,
    pub last_update_ts: i64,
    pub last_nonzero_stake_ts: i64,
    pub next_boundary_index: u32,
    pub total_emitted: u128,
    pub total_claimed: u128,
    pub unallocated: u128,
}

impl PoolState {
    /// Parse pool from raw account data (after 8-byte Anchor discriminator).
    /// Layout: borsh-serialized fields in order, no padding.
    pub fn from_account_data(data: &[u8]) -> Self {
        let d = &data[8..]; // skip discriminator
        // Pubkeys: authority, operator, mint, token_program, stake_vault,
        // reward_vault, schedule = 7 * 32 = 224 bytes
        let mut off = 224;

        let start_ts = read_i64(d, off); off += 8;
        let end_ts = read_i64(d, off); off += 8;

        // Schedule params: period_seconds, emission_step_seconds, emission_ramp_steps,
        // tenure_step_seconds, tenure_ramp_steps = 5 * 8 = 40 bytes
        off += 40;
        // checkpoint_capacity: u32 (4), decimals: u8 (1)
        off += 4 + 1;

        // min_funding: u64, min_stake: u64
        off += 8 + 8;

        let funded_amount = read_u64(d, off); off += 8;
        let base_rate_per_period = read_u64(d, off); off += 8;

        let started = d[off] != 0; off += 1;
        let paused = d[off] != 0; off += 1;

        let total_staked = read_u128(d, off); off += 16;
        let total_weight = read_u128(d, off); off += 16;
        let ramping_stake = read_u128(d, off); off += 16;
        let acc_reward_per_weight = read_u128(d, off); off += 16;
        let sum_acc_at_boundaries = read_u128(d, off); off += 16;

        let last_update_ts = read_i64(d, off); off += 8;
        let last_nonzero_stake_ts = read_i64(d, off); off += 8;
        let next_boundary_index = read_u32(d, off); off += 4;

        let total_emitted = read_u128(d, off); off += 16;
        let total_claimed = read_u128(d, off); off += 16;
        let unallocated = read_u128(d, off);

        Self {
            start_ts,
            end_ts,
            funded_amount,
            base_rate_per_period,
            started,
            paused,
            total_staked,
            total_weight,
            ramping_stake,
            acc_reward_per_weight,
            sum_acc_at_boundaries,
            last_update_ts,
            last_nonzero_stake_ts,
            next_boundary_index,
            total_emitted,
            total_claimed,
            unallocated,
        }
    }
}

pub async fn read_pool(banks: &mut BanksClient, pool: &Pubkey) -> PoolState {
    let acc = banks.get_account(*pool).await.unwrap().unwrap();
    PoolState::from_account_data(&acc.data)
}

// ============================================================
// Test context: all the state needed for a test scenario
// ============================================================

pub struct TestContext {
    pub pid: Pubkey,
    pub authority: Keypair,
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub pool_bump: u8,
    pub stake_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub schedule: Pubkey,
    pub authority_token_account: Pubkey,
    pub treasury_token_account: Pubkey,
}

impl TestContext {
    /// Create a full test context: deploy, create mint, initialize pool.
    pub async fn new(banks: &mut BanksClient, payer: &Keypair) -> Self {
        let pid = program_id();
        let authority = Keypair::new();

        // Airdrop to authority
        let tx = Transaction::new_signed_with_payer(
            &[system_instruction::transfer(
                &payer.pubkey(),
                &authority.pubkey(),
                50_000_000_000, // 50 SOL
            )],
            Some(&payer.pubkey()),
            &[payer],
            banks.get_latest_blockhash().await.unwrap(),
        );
        banks.process_transaction(tx).await.unwrap();

        let bh = banks.get_latest_blockhash().await.unwrap();

        // Create mint
        let mint = create_mint(banks, &authority, &authority.pubkey(), bh).await;

        // Derive PDAs
        let (pool, pool_bump) = pool_pda(&mint, &pid);
        let (stake_vault, _) = stake_vault_pda(&pool, &pid);
        let (reward_vault, _) = reward_vault_pda(&pool, &pid);

        // Create Schedule account
        let schedule_kp = Keypair::new();
        let rent = banks.get_rent().await.unwrap();
        let schedule_lamports = rent.minimum_balance(SCHEDULE_SPACE);
        let bh = banks.get_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[system_instruction::create_account(
                &authority.pubkey(),
                &schedule_kp.pubkey(),
                schedule_lamports,
                SCHEDULE_SPACE as u64,
                &pid,
            )],
            Some(&authority.pubkey()),
            &[&authority, &schedule_kp],
            bh,
        );
        banks.process_transaction(tx).await.unwrap();
        let schedule = schedule_kp.pubkey();

        // Create authority's token account and mint tokens for funding
        let bh = banks.get_latest_blockhash().await.unwrap();
        let authority_ata = create_token_account(
            banks,
            &authority,
            &mint,
            &authority.pubkey(),
            bh,
        )
        .await;

        // Mint 200M tokens to the authority for funding
        let bh = banks.get_latest_blockhash().await.unwrap();
        mint_to(
            banks,
            &authority,
            &mint,
            &authority_ata,
            &authority,
            200_000_000_000_000, // 200M
            bh,
        )
        .await;

        // Create the treasury's token account (owned by the treasury wallet).
        // No secret key is needed to *receive* tokens; the account owner is
        // simply the treasury pubkey.
        let bh = banks.get_latest_blockhash().await.unwrap();
        let treasury_ata = create_token_account(
            banks,
            &authority, // payer
            &mint,
            &treasury_pubkey(),
            bh,
        )
        .await;

        // Initialize pool
        let bh = banks.get_latest_blockhash().await.unwrap();
        let ix = ix_initialize_pool(
            &pid,
            &authority.pubkey(),
            &mint,
            &pool,
            &stake_vault,
            &reward_vault,
            &schedule,
            &treasury_pubkey(),
            MIN_FUNDING,
            MIN_STAKE,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&authority.pubkey()),
            &[&authority],
            bh,
        );
        banks.process_transaction(tx).await.unwrap();

        Self {
            pid,
            authority,
            mint,
            pool,
            pool_bump,
            stake_vault,
            reward_vault,
            schedule,
            authority_token_account: authority_ata,
            treasury_token_account: treasury_ata,
        }
    }
    /// Fund the pool with the given amount.
    pub async fn fund(&self, banks: &mut BanksClient, amount: u64) {
        let bh = banks.get_latest_blockhash().await.unwrap();
        let ix = ix_fund_rewards(
            &self.pid,
            &self.authority.pubkey(),
            &self.pool,
            &self.reward_vault,
            &self.mint,
            &self.authority_token_account,
            amount,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.authority.pubkey()),
            &[&self.authority],
            bh,
        );
        banks.process_transaction(tx).await.unwrap();
    }

    /// Sweep reward-vault surplus to the operator (== authority under the
    /// test-operator feature). Returns the tx result so tests can assert
    /// success or failure.
    pub async fn sweep(
        &self,
        banks: &mut BanksClient,
    ) -> Result<(), solana_program_test::BanksClientError> {
        let bh = banks.get_latest_blockhash().await.unwrap();
        let ix = ix_sweep_to_operator(
            &self.pid,
            &self.authority.pubkey(),
            &self.pool,
            &self.reward_vault,
            &self.mint,
            &self.authority_token_account,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.authority.pubkey()),
            &[&self.authority],
            bh,
        );
        banks.process_transaction(tx).await
    }

    /// Start the pool.
    pub async fn start(&self, banks: &mut BanksClient) {        let bh = banks.get_latest_blockhash().await.unwrap();
        let ix = ix_start_pool(&self.pid, &self.authority.pubkey(), &self.pool);
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.authority.pubkey()),
            &[&self.authority],
            bh,
        );
        banks.process_transaction(tx).await.unwrap();
    }

    /// Crank the pool. Chains multiple transactions if needed.
    pub async fn crank(&self, banks: &mut BanksClient, max_steps: u64) {
        // Use a compute budget instruction to get more CU
        let compute_ix = solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);
        let bh = banks.get_latest_blockhash().await.unwrap();
        let ix = ix_crank(
            &self.pid,
            &self.authority.pubkey(),
            &self.pool,
            &self.schedule,
            max_steps,
        );
        let tx = Transaction::new_signed_with_payer(
            &[compute_ix, ix],
            Some(&self.authority.pubkey()),
            &[&self.authority],
            bh,
        );
        banks.process_transaction(tx).await.unwrap();
    }

    /// Crank repeatedly until caught up (for large time warps).
    /// Warps clock in 1-hour increments and cranks after each.
    pub async fn crank_to_current(&self, ptc: &mut solana_program_test::ProgramTestContext, total_seconds: i64) {
        let steps = (total_seconds / HOUR) as usize;
        for i in 0..steps {
            // Warp to next slot first, then set the clock sysvar
            let clock: solana_sdk::clock::Clock = ptc.banks_client.get_sysvar().await.unwrap();
            let new_slot = clock.slot + 100;
            ptc.warp_to_slot(new_slot).unwrap();

            // Now set the timestamp we want
            let mut new_clock: solana_sdk::clock::Clock = ptc.banks_client.get_sysvar().await.unwrap();
            new_clock.unix_timestamp = clock.unix_timestamp + HOUR;
            ptc.set_sysvar(&new_clock);

            // Crank 1 boundary
            let compute_ix = solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(400_000);
            let bh = ptc.banks_client.get_latest_blockhash().await.unwrap();
            let ix = ix_crank(
                &self.pid,
                &self.authority.pubkey(),
                &self.pool,
                &self.schedule,
                1,
            );
            let tx = Transaction::new_signed_with_payer(
                &[compute_ix, ix],
                Some(&self.authority.pubkey()),
                &[&self.authority],
                bh,
            );
            if let Err(e) = ptc.banks_client.process_transaction(tx).await {
                eprintln!("crank_to_current: failed at step {i}/{steps}: {e:?}");
                break;
            }
        }
    }
}
