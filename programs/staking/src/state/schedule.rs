use anchor_lang::prelude::*;

/// A single hourly checkpoint: the values of A and G at that boundary.
#[zero_copy]
#[derive(Default)]
#[repr(C)]
pub struct Checkpoint {
    /// Accumulated reward per unit weight at this boundary.
    pub acc: u128,
    /// Running sum G_n = sum_{i=0}^{n} A_i at this boundary.
    pub sum_acc: u128,
}

/// The Schedule account stores the full checkpoint history and cohort maturity
/// buckets. It is client-allocated via `SystemProgram.createAccount` because
/// its size (~16 KB) exceeds the 10,240-byte CPI-created account limit.
///
/// **Must be `zero_copy`** to stay off the 4 KB stack.
///
/// # Layout
///
/// - 384 checkpoint slots: `(A_n, G_n)` pairs at each hourly boundary.
/// - 464 maturing slots: stake amount that will hit the 72-step cap at each
///   future boundary.
///
/// # Sizing
///
/// - Checkpoints: 384 × 32 bytes = 12,288 bytes
/// - Maturing: 464 × 8 bytes = 3,712 bytes
/// - Header: 8 (discriminator) + 32 (pool) + 4 (len fields) × 2 + 8 (pad) = 56 bytes
/// - Total: ~16,056 bytes. Rent: ~0.11 SOL.
///
/// # Full history, absolute indexing
///
/// Checkpoints are **never overwritten**. A position that matures on day 3 and
/// sits idle until day 14 still needs `G_{n0+72}` to be readable. A ring buffer
/// would silently make that position unpayable.
#[account(zero_copy)]
#[repr(C)]
pub struct Schedule {
    /// The pool this schedule belongs to.
    pub pool: Pubkey,

    /// Number of checkpoint slots allocated (should be CHECKPOINT_CAPACITY = 384).
    pub checkpoint_len: u32,
    /// Number of maturing slots allocated (should be MATURING_CAPACITY = 464).
    pub maturing_len: u32,

    /// Explicit padding to align `checkpoints` to 16 bytes (u128 alignment).
    pub _padding: [u8; 8],

    /// Hourly checkpoint history: (A_n, G_n) at each boundary.
    /// Index 0 is pre-recorded as (0, 0) at pool start.
    pub checkpoints: [Checkpoint; 384],

    /// Cohort maturity buckets: stake amount due to hit the 72-step cap
    /// at boundary index `i`. When boundary `i` is crossed during crank,
    /// `maturing[i]` is subtracted from `ramping_stake`.
    pub maturing: [u64; 464],
}

impl Schedule {
    pub const CHECKPOINT_CAPACITY: usize = 384;
    pub const MATURING_CAPACITY: usize = 464;

    /// The account space needed (including the 8-byte discriminator).
    pub const SPACE: usize = 8 + core::mem::size_of::<Self>();
}
