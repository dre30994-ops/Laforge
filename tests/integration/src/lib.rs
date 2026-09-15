//! Integration test harness for the 14-day staking program.
//!
//! Uses solana-program-test to load the compiled .so binary and run full
//! on-chain simulations with clock warping, multi-user scenarios, and
//! invariant checks.
//!
//! Tests are in the `tests/` directory and run via `cargo test`.

pub mod helpers;
