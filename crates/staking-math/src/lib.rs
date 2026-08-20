//! Pure emission / weight / accrual math for the 14-day staking farm.
//!
//! No Solana dependency: this crate builds and tests under plain `cargo test`,
//! which is deliberate. It is the mathematical core, developed and proven
//! before any on-chain code exists.
//!
//! # Layout
//!
//! * [`constants`] — the economic parameters and their consistency proofs.
//! * [`emission`] — the global 1.0x -> 2.0x ramp and derived program duration.
//! * [`weight`] — exact-integer tenure weights and the anti-gaming average.
//! * [`accrual`] — the O(1) per-user accrual formula.
//! * [`pool`] — an in-memory reference model; the executable spec.
//! * [`sim`] — brute-force integration used to validate the O(1) formula.
//!
//! # The two facts worth internalising
//!
//! **The tenure multiplier is zero-sum.** A staker's share is
//! `stake_i * mult_i / sum(stake_j * mult_j)`. If everyone is mature, the
//! multiplier cancels completely. Real income growth for an early staker comes
//! from the global 2x emission ramp, not from their own tenure. Any UI that
//! shows only the personal multiplier will mislead users as TVL grows.
//!
//! **Rounding always floors toward the pool.** Emission floors once against a
//! cumulative numerator; accrual floors once per settlement. The pool can
//! therefore never be over-drawn, and a permanent dust of `funded mod DENOM`
//! base units is unreachable by design.
//!
//! # Discretionary funding model
//!
//! The base rate `r₀ = funded ÷ DENOM` is derived at runtime. The 14-day end
//! date is fixed at `start_pool`; top-ups after start re-price the remaining
//! schedule upward (rate increases, end date stays).

#![forbid(unsafe_code)]

pub mod accrual;
pub mod constants;
pub mod emission;
pub mod error;
pub mod weight;

/// Host-only reference model and brute-force simulator.
///
/// Excluded from the on-chain build: the program links the pure math only, so
/// none of the `Vec`-backed model code reaches the SBF target.
#[cfg(feature = "model")]
pub mod pool;
#[cfg(feature = "model")]
pub mod sim;

pub use accrual::{accrual, accrual_bracket, advance_acc, Snapshot};
pub use constants::*;
pub use emission::{
    cumulative_emitted, cumulative_numerator, emission_between, emission_for_day,
    emission_for_step, emission_mult_bps, emission_mult_numerator, remaining_period_units,
};
pub use error::{MathError, MathResult};
pub use weight::{
    average_mult_bps, capped_steps, tenure_mult_bps, weight, weight_numerator, weighted_deposit_ts,
};

#[cfg(feature = "model")]
pub use pool::{PoolError, RefPool, RefPosition};
#[cfg(feature = "model")]
pub use sim::BruteSim;
