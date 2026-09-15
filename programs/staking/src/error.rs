use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Deposit would leave the position below the minimum stake")]
    BelowMinimumStake,
    #[msg("Pool is stale; crank it to the current slot first")]
    PoolStale,
    #[msg("Pool is paused")]
    Paused,
    #[msg("Pool has not been started yet")]
    NotStarted,
    #[msg("Funding is below the minimum required to start")]
    BelowMinimumFunding,
    #[msg("Re-pricing cannot decrease the emission rate")]
    RateDecreased,
    #[msg("Cannot withdraw unallocated before end_ts + grace period")]
    WithdrawTooEarly,
    #[msg("Withdraw amount exceeds unallocated balance")]
    InsufficientUnallocated,
    // -- initialize_pool errors --
    #[msg("Schedule account is too small for the required checkpoint and maturing capacity")]
    ScheduleTooSmall,
    // -- start_pool errors --
    #[msg("Pool has already been started")]
    AlreadyStarted,
    #[msg("Funded amount is below the minimum required to start")]
    InsufficientFunding,
    #[msg("Only the pool authority can start the pool")]
    Unauthorized,
    // -- mint validation errors --
    #[msg("Mint has TransferHook extension which is incompatible with staking")]
    TransferHookNotAllowed,
    #[msg("Mint has PermanentDelegate extension which could drain the vault")]
    PermanentDelegateNotAllowed,
    #[msg("Mint is NonTransferable, cannot be staked")]
    NonTransferableNotAllowed,
    #[msg("Mint has DefaultAccountState set to Frozen")]
    DefaultAccountStateFrozenNotAllowed,
    #[msg("Mint has ConfidentialTransfer which prevents balance-delta accounting")]
    ConfidentialTransferNotAllowed,
    // -- operator / treasury errors --
    #[msg("Only the designated operator may perform this action")]
    NotOperator,
    #[msg("Treasury token account does not match the required treasury/mint")]
    InvalidTreasury,
    // -- sweep errors --
    #[msg("Pool still has active stakes; cannot sweep")]
    StakesActive,
    #[msg("The 3-hour empty period has not yet elapsed")]
    SweepTooEarly,
    #[msg("No sweepable surplus in the reward vault")]
    NothingToSweep,
}
