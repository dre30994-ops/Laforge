//! 14-day liquidity-bootstrap staking farm.
//!
//! One isolated pool per mint. PDA seeded `["pool", mint.key()]`.
//! Supports both legacy SPL Token and Token-2022 via TokenInterface.

use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod validation;

use instructions::*;

declare_id!("gXdv8YGX4SJQANNXTMsNEZMyvDKJkxgZn9KthxQB79o");

/// The sole operator address permitted to fund rewards.
pub const OPERATOR: Pubkey = pubkey!("9pDThmjGyc4uCZkbecyi9C6vA36X3CorUunJU4aScEzx");

/// Treasury wallet that receives the unstake tax. SPL tokens are routed to the
/// treasury's token account (owner == this address).
pub const TREASURY: Pubkey = pubkey!("BzwWjFrwuA31rvcJShTgvmNYnirpkp19Q4ijunj5pbuk");

/// Unstake tax in basis points: 5% = 500 bps. Taken from the unstaked principal
/// and sent to the treasury; the remainder is returned to the user.
pub const UNSTAKE_TAX_BPS: u64 = 500;

/// Fixed launch fee to create a pool: 0.5 SOL, in lamports. Paid by the pool
/// authority at `initialize_pool` and transferred to `LAUNCH_FEE_RECIPIENT`.
/// Mirrors the EVM StakingFactory launch fee (0.02 ETH).
pub const LAUNCH_FEE_LAMPORTS: u64 = 500_000_000;

/// Fixed recipient of the pool-creation launch fee.
pub const LAUNCH_FEE_RECIPIENT: Pubkey =
    pubkey!("BzwWjFrwuA31rvcJShTgvmNYnirpkp19Q4ijunj5pbuk");

/// Basis-point denominator.
pub const BPS_DENOM: u64 = 10_000;

/// Duration of zero-TVL emptiness after which the reward-vault surplus may be
/// swept back to the operator: 3 hours.
pub const EMPTY_SWEEP_SECONDS: i64 = 3 * 60 * 60;

/// Fixed grace period after `end_ts` before the admin may withdraw the
/// unallocated (zero-TVL) emissions: 7 days. Fixed by the protocol rather than
/// chosen per-call, so the guarantee to stakers is not at the admin's
/// discretion (see AUDIT.md M-1).
pub const UNALLOCATED_GRACE_SECONDS: i64 = 7 * 24 * 60 * 60;

#[program]
pub mod staking {
    use super::*;

    /// Scaffold: prove the toolchain works end to end.
    pub fn ping(ctx: Context<Ping>, value: u64) -> Result<()> {
        instructions::ping::handler(ctx, value)
    }

    /// Initialize a new staking pool for a given mint.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        params: InitializePoolParams,
    ) -> Result<()> {
        instructions::initialize_pool::handler(ctx, params)
    }

    /// Start the pool after sufficient funding. Derives base rate, sets
    /// the fixed 14-day end timestamp.
    pub fn start_pool(ctx: Context<StartPool>) -> Result<()> {
        instructions::start_pool::handler(ctx)
    }

    /// Fund the reward pool. Admin push path.
    /// Pre-start: accumulates funded_amount.
    /// Post-start: requires cranked-current pool, then re-prices upward.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        instructions::fund_rewards::handler(ctx, amount)
    }

    /// Permissionless sync: credits vault surplus and re-prices.
    pub fn sync_rewards(ctx: Context<SyncRewards>) -> Result<()> {
        instructions::sync_rewards::handler(ctx)
    }

    /// Sweep reward-vault surplus back to the operator after 3h of no active
    /// stakes. Permissionless caller; funds route only to the operator. Never
    /// touches user principal or unclaimed rewards.
    pub fn sweep_to_operator(ctx: Context<SweepToOperator>) -> Result<()> {
        instructions::sweep_to_operator::handler(ctx)
    }

    /// Resumable hourly advance. Walks boundaries, updates accumulators.
    pub fn crank(ctx: Context<Crank>, max_steps: u64) -> Result<()> {
        instructions::crank::handler(ctx, max_steps)
    }

    /// Stake tokens into the pool.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler(ctx, amount)
    }

    /// Claim accumulated rewards without touching tenure.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handler(ctx)
    }

    /// Unstake tokens. Full tenure reset.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::unstake::handler(ctx, amount)
    }

    /// Compound pending rewards into principal.
    pub fn compound(ctx: Context<Compound>) -> Result<()> {
        instructions::compound::handler(ctx)
    }

    // ---- Admin operations ----

    /// Pause or unpause the pool.
    pub fn set_paused(ctx: Context<AdminPool>, paused: bool) -> Result<()> {
        instructions::admin::handler_set_paused(ctx, paused)
    }

    /// Adjust the minimum stake (deposits only, existing grandfathered).
    pub fn set_min_stake(ctx: Context<AdminPool>, min_stake: u64) -> Result<()> {
        instructions::admin::handler_set_min_stake(ctx, min_stake)
    }

    /// Transfer pool authority. Requires both old and new authority to sign.
    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        instructions::admin::handler_transfer_authority(ctx)
    }

    /// Withdraw unallocated rewards after end_ts + fixed grace period.
    pub fn withdraw_unallocated(
        ctx: Context<WithdrawUnallocated>,
        amount: u64,
    ) -> Result<()> {
        instructions::admin::handler_withdraw_unallocated(ctx, amount)
    }
}
