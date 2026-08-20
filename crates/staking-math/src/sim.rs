//! Brute-force reference simulator.
//!
//! The O(1) accrual formula is the thing most likely to be subtly wrong, so it
//! needs an independent check. This module maintains a shadow model that
//! integrates each user's reward **explicitly**, segment by segment:
//!
//! ```text
//! integral_i = sum over segments of  weight_i(t) * delta_A(t)
//! ```
//!
//! # Why the comparison is exact rather than approximate
//!
//! Since `weight_i = stake_i * (72 + k_i)`:
//!
//! ```text
//! sum w_i * dA  ==  stake_i * sum (72 + k_i) * dA  ==  stake_i * bracket
//! ```
//!
//! Both sides are exact integers before the single division by [`ACC_SCALE`],
//! and both floor at the same points (every settlement). So equality is exact,
//! with no tolerance. Any disagreement is a real bug in the checkpoint
//! bookkeeping — a wrong `G` index, a mis-capped `k`, or a stale snapshot.
//!
//! The simulator additionally re-derives aggregate weight by summing over
//! positions on **every** segment and compares it to the pool's incrementally
//! maintained `total_weight`. That is what catches cohort-maturity errors.

use crate::constants::*;
use crate::error::MathResult;
use crate::pool::{PoolError, RefPool};
use crate::weight::weight_numerator;

/// The shadow copy of a position that the simulator maintains independently.
#[derive(Debug, Clone, Default)]
struct Mirror {
    amount: u128,
    n0: u64,
}

#[derive(Debug)]
pub struct BruteSim {
    pub pool: RefPool,
    mirror: Vec<Mirror>,
    /// Exact `stake * bracket`, reset at each settlement.
    integral: Vec<u128>,
    /// Lifetime floored reward per user, accumulated at each settlement.
    pub earned: Vec<u128>,
    /// Segments where explicit weight summation disagreed with `total_weight`.
    pub weight_mismatches: usize,
    /// Segments observed, for test diagnostics.
    pub segments: usize,
}

impl BruteSim {
    pub fn new(start_ts: u64, users: usize) -> Self {
        Self {
            pool: RefPool::new(start_ts, users),
            mirror: vec![Mirror::default(); users],
            integral: vec![0; users],
            earned: vec![0; users],
            weight_mismatches: 0,
            segments: 0,
        }
    }

    pub fn fund(&mut self, amount: u128) -> Result<(), PoolError> {
        self.pool.fund(amount)
    }

    pub fn start(&mut self) -> Result<(), PoolError> {
        self.pool.start()
    }

    pub fn users(&self) -> usize {
        self.mirror.len()
    }

    /// Advance the pool to `now`, integrating every user's reward explicitly.
    pub fn sync(&mut self, now: u64) -> MathResult<()> {
        let mirror = self.mirror.clone();
        let mut integral = core::mem::take(&mut self.integral);
        let mut mismatches = 0usize;
        let mut segments = 0usize;

        let res = self.pool.advance_with(now, |delta, cur, total_weight| {
            segments += 1;
            let mut wsum = 0u128;
            for (i, m) in mirror.iter().enumerate() {
                if m.amount == 0 {
                    continue;
                }
                let w = m.amount * weight_numerator(cur.saturating_sub(m.n0));
                wsum += w;
                if delta > 0 {
                    integral[i] += w * delta;
                }
            }
            // The pool maintains total_weight incrementally via ramping_stake
            // and the maturing array; this is the independent cross-check.
            if wsum != total_weight {
                mismatches += 1;
            }
        });

        self.integral = integral;
        self.weight_mismatches += mismatches;
        self.segments += segments;
        res
    }

    /// Mirror the pool's settlement: fold the exact integral into `earned`.
    fn settle_brute(&mut self, user: usize) {
        let owed = self.integral[user] / ACC_SCALE;
        self.earned[user] += owed;
        self.integral[user] = 0;
    }

    fn refresh_mirror(&mut self, user: usize) {
        let p = &self.pool.positions[user];
        self.mirror[user] = Mirror {
            amount: p.amount,
            n0: p.n0,
        };
    }

    /// Settle every user, so `earned` is comparable at an arbitrary instant.
    pub fn settle_all(&mut self, now: u64) -> MathResult<()> {
        self.sync(now)?;
        for u in 0..self.users() {
            self.settle_brute(u);
        }
        Ok(())
    }

    // ---- operations, each mirroring the pool's settle points ----

    pub fn stake(&mut self, user: usize, amount: u128, now: u64) -> Result<(), PoolError> {
        self.sync(now)?;
        self.settle_brute(user);
        let r = self.pool.stake(user, amount, now);
        self.refresh_mirror(user);
        r
    }

    pub fn unstake(&mut self, user: usize, amount: u128, now: u64) -> Result<(), PoolError> {
        self.sync(now)?;
        self.settle_brute(user);
        let r = self.pool.unstake(user, amount, now);
        self.refresh_mirror(user);
        r
    }

    pub fn claim(&mut self, user: usize, now: u64) -> Result<u128, PoolError> {
        self.sync(now)?;
        self.settle_brute(user);
        let r = self.pool.claim(user, now);
        self.refresh_mirror(user);
        r
    }

    pub fn compound(&mut self, user: usize, now: u64) -> Result<u128, PoolError> {
        self.sync(now)?;
        self.settle_brute(user);
        let r = self.pool.compound(user, now);
        self.refresh_mirror(user);
        r
    }

    /// Lifetime reward the pool believes a user has earned.
    pub fn pool_earned(&self, user: usize) -> u128 {
        let p = &self.pool.positions[user];
        p.pending + p.claimed + p.compounded
    }

    /// The core equivalence assertion: O(1) formula == explicit integration.
    pub fn assert_equivalence(&self) -> Result<(), String> {
        if self.weight_mismatches != 0 {
            return Err(format!(
                "total_weight disagreed with explicit summation on {} of {} segments",
                self.weight_mismatches, self.segments
            ));
        }
        for u in 0..self.users() {
            let brute = self.earned[u];
            let onchain = self.pool_earned(u);
            if brute != onchain {
                return Err(format!(
                    "user {u}: brute-force {brute} != O(1) {onchain} (diff {})",
                    onchain.abs_diff(brute)
                ));
            }
        }
        Ok(())
    }
}
