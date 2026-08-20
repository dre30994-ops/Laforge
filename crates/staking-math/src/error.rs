//! Error type for the math layer.
//!
//! Every fallible operation returns [`MathError`] rather than panicking or
//! silently truncating, so the on-chain layer can map these onto Anchor errors.

use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// A checked add/sub/mul overflowed `u128`.
    Overflow,
    /// A subtraction would have gone negative. Signals corrupt bookkeeping,
    /// never a legitimate user action.
    Underflow,
    /// Division by zero — total weight was zero where it must not be.
    DivByZero,
    /// A checkpoint index exceeded the schedule capacity.
    CheckpointOutOfBounds,
    /// A cohort-maturity index exceeded the maturing-array capacity.
    MaturityOutOfBounds,
    /// The requested `end_ts` would need more checkpoints than capacity allows.
    CapacityExceeded,
    /// Deposit would leave the position below the minimum stake.
    BelowMinimumStake,
}

impl fmt::Display for MathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            MathError::Overflow => "arithmetic overflow",
            MathError::Underflow => "arithmetic underflow",
            MathError::DivByZero => "division by zero",
            MathError::CheckpointOutOfBounds => "checkpoint index out of bounds",
            MathError::MaturityOutOfBounds => "maturity index out of bounds",
            MathError::CapacityExceeded => "schedule capacity exceeded",
            MathError::BelowMinimumStake => "below minimum stake",
        };
        f.write_str(s)
    }
}

impl std::error::Error for MathError {}

pub type MathResult<T> = Result<T, MathError>;

/// Checked helpers. These exist so no call site is tempted to use `as`,
/// wrapping ops, or bare operators on balances.
pub(crate) trait Checked: Sized {
    fn c_add(self, rhs: Self) -> MathResult<Self>;
    fn c_sub(self, rhs: Self) -> MathResult<Self>;
    fn c_mul(self, rhs: Self) -> MathResult<Self>;
    fn c_div(self, rhs: Self) -> MathResult<Self>;
}

impl Checked for u128 {
    #[inline]
    fn c_add(self, rhs: Self) -> MathResult<Self> {
        self.checked_add(rhs).ok_or(MathError::Overflow)
    }
    #[inline]
    fn c_sub(self, rhs: Self) -> MathResult<Self> {
        self.checked_sub(rhs).ok_or(MathError::Underflow)
    }
    #[inline]
    fn c_mul(self, rhs: Self) -> MathResult<Self> {
        self.checked_mul(rhs).ok_or(MathError::Overflow)
    }
    #[inline]
    fn c_div(self, rhs: Self) -> MathResult<Self> {
        self.checked_div(rhs).ok_or(MathError::DivByZero)
    }
}
