//! An in-memory reference model of the pool.
//!
//! This is the executable specification for the on-chain program: same state
//! transitions, same ordering, same integer rounding — just without Solana. The
//! brute-force simulator in [`crate::sim`] checks the O(1) accrual against
//! explicit per-user integration on top of this model.
//!
//! # Checkpoints are full history, never windowed
//!
//! `(A_n, G_n)` pairs are stored for every hourly boundary of the program's
//! life ([`CHECKPOINT_CAPACITY`] slots). A ring buffer would be a correctness
//! bug, not an optimisation: a position that matures on day 3 and then sits
//! idle until day 14 still needs `G_{n0+72}` to be readable when it finally
//! settles. Overwrite it and the position becomes unpayable.
//!
//! # Tenure ticks on global hourly boundaries
//!
//! A position's tenure step is `k = cur_boundary - n0`, where `n0` is the
//! boundary containing its stake-weighted deposit timestamp (floored). Using
//! the floor is what makes `G_{n0}` already recorded at deposit time, which is
//! what keeps accrual O(1). The cost is that the first tick can arrive up to an
//! hour early; that is bounded and deliberate.
//!
//! # Discretionary funding and re-pricing
//!
//! `base_rate = funded ÷ DENOM` is computed once at `start()` and re-derived
//! on each top-up via `fund()` after start. The 14-day end date is fixed at
//! start and never moves. Top-ups raise the rate monotonically.

use crate::accrual::{accrual, advance_acc, Snapshot};
use crate::constants::*;
use crate::emission::cumulative_emitted;
use crate::error::{Checked, MathError, MathResult};
use crate::weight::{average_mult_bps, capped_steps, tenure_mult_bps, weight, weighted_deposit_ts};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolError {
    Math(MathError),
    Paused,
    ZeroAmount,
    BelowMinimumStake,
    BelowMinimumFunding,
    InsufficientStake,
    CapacityExceeded,
    NotEnded,
    NotStarted,
    AlreadyStarted,
    RateDecreased,
}

impl From<MathError> for PoolError {
    fn from(e: MathError) -> Self {
        PoolError::Math(e)
    }
}

type R<T> = Result<T, PoolError>;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RefPosition {
    pub amount: u128,
    pub weighted_deposit_ts: u64,
    /// Boundary index containing `weighted_deposit_ts`.
    pub n0: u64,
    pub snap: Snapshot,
    pub pending: u128,
    pub claimed: u128,
    pub compounded: u128,
}

#[derive(Debug, Clone)]
pub struct RefPool {
    pub start_ts: u64,
    pub end_ts: u64,
    pub funded: u128,
    pub base_rate: u128,
    pub min_stake: u128,
    pub started: bool,
    pub paused: bool,

    pub total_staked: u128,
    pub total_weight: u128,
    /// Stake that has not yet reached the 72-step cap.
    pub ramping_stake: u128,

    /// `A` — accumulated reward per unit weight, scaled by [`ACC_SCALE`].
    pub acc: u128,
    /// `G` at the most recently recorded boundary.
    pub sum_acc: u128,
    pub last_ts: u64,
    /// Next boundary index not yet crossed.
    pub next_boundary: u64,

    pub acc_at: Vec<u128>,
    pub sum_acc_at: Vec<u128>,
    pub maturing: Vec<u128>,

    pub total_emitted: u128,
    pub total_claimed: u128,
    pub total_compounded: u128,
    pub unallocated: u128,

    pub positions: Vec<RefPosition>,
}

impl RefPool {
    pub fn new(start_ts: u64, users: usize) -> Self {
        Self {
            start_ts,
            end_ts: start_ts + DURATION_DAYS * SECONDS_PER_DAY,
            funded: 0,
            base_rate: 0,
            min_stake: MIN_STAKE,
            started: false,
            paused: false,
            total_staked: 0,
            total_weight: 0,
            ramping_stake: 0,
            acc: 0,
            sum_acc: 0, // G_0 = A_0 = 0
            last_ts: start_ts,
            next_boundary: 1, // boundary 0 is the pre-recorded (0, 0)
            acc_at: vec![0; CHECKPOINT_CAPACITY + 1],
            sum_acc_at: vec![0; CHECKPOINT_CAPACITY + 1],
            maturing: vec![0; MATURING_CAPACITY],
            total_emitted: 0,
            total_claimed: 0,
            total_compounded: 0,
            unallocated: 0,
            positions: vec![RefPosition::default(); users],
        }
    }

    /// Credit rewards pre-start. Does not derive the rate yet.
    pub fn fund(&mut self, amount: u128) -> R<()> {
        if amount == 0 {
            return Err(PoolError::ZeroAmount);
        }
        self.funded = self.funded.c_add(amount)?;

        // If already started, re-price: derive a new (higher) base_rate from
        // remaining funds over remaining period-units.
        if self.started {
            self.reprice()?;
        }
        Ok(())
    }

    /// Start the pool. Requires funded >= MIN_FUNDING. Derives base_rate and
    /// fixes end_ts = start_ts + 14 days.
    pub fn start(&mut self) -> R<()> {
        if self.started {
            return Err(PoolError::AlreadyStarted);
        }
        if self.funded < MIN_FUNDING {
            return Err(PoolError::BelowMinimumFunding);
        }
        self.base_rate = derive_base_rate(self.funded)?;
        self.started = true;
        // end_ts is already set to start_ts + 14 days in new()
        Ok(())
    }

    /// Re-price after a post-start top-up.
    ///
    /// New rate = remaining_funds / remaining_period_units.
    /// Rate must be monotonically non-decreasing.
    fn reprice(&mut self) -> R<()> {
        let elapsed = self.last_ts.saturating_sub(self.start_ts);
        let remaining_funds = self.funded.c_sub(self.total_emitted)?;
        let remaining_num = crate::emission::remaining_period_units(elapsed)?;
        if remaining_num == 0 {
            // Past end — no re-pricing possible.
            return Ok(());
        }
        // new_rate = remaining_funds * MULT_DENOM / remaining_num / MULT_DENOM
        //          = remaining_funds / (remaining_num / MULT_DENOM)
        // But to avoid nested division, we do:
        // remaining_period_units returns MULT_DENOM-scaled units.
        // base_rate = remaining_funds * MULT_DENOM / remaining_num
        let new_rate = remaining_funds.c_mul(MULT_DENOM)?.c_div(remaining_num)?;
        if new_rate < self.base_rate {
            return Err(PoolError::RateDecreased);
        }
        self.base_rate = new_rate;
        Ok(())
    }

    #[inline]
    pub fn boundary_index(&self, ts: u64) -> u64 {
        ts.saturating_sub(self.start_ts) / TENURE_STEP_SECONDS
    }

    /// Index of the most recently crossed boundary.
    #[inline]
    pub fn cur_idx(&self) -> u64 {
        self.next_boundary - 1
    }

    #[inline]
    pub fn is_stale(&self, now: u64) -> bool {
        let target = now.min(self.end_ts);
        self.last_ts < target
    }

    fn checkpoint(&self, idx: u64) -> MathResult<u128> {
        self.sum_acc_at
            .get(idx as usize)
            .copied()
            .ok_or(MathError::CheckpointOutOfBounds)
    }

    /// Emission over `[t0, t1)`, clamped to the funded window, applied to `A`.
    fn accrue_segment(&mut self, t0: u64, t1: u64) -> MathResult<u128> {
        let c0 = t0.min(self.end_ts);
        let c1 = t1.min(self.end_ts);
        if c1 <= c0 {
            return Ok(0);
        }
        let e0 = cumulative_emitted(self.base_rate, c0.saturating_sub(self.start_ts))?;
        let e1 = cumulative_emitted(self.base_rate, c1.saturating_sub(self.start_ts))?;
        let emission = e1.c_sub(e0)?;
        if emission == 0 {
            return Ok(0);
        }
        self.total_emitted = self.total_emitted.c_add(emission)?;

        if self.total_weight == 0 {
            // Emissions with no stakers cannot be divided. Park them.
            self.unallocated = self.unallocated.c_add(emission)?;
            return Ok(0);
        }
        let delta = advance_acc(emission, self.total_weight)?;
        self.acc = self.acc.c_add(delta)?;
        Ok(delta)
    }

    pub fn advance(&mut self, now: u64) -> MathResult<()> {
        self.advance_with(now, |_, _, _| {})
    }

    /// One crank transaction's worth of work: at most `max_steps` boundaries.
    pub fn advance_bounded(&mut self, now: u64, max_steps: u64) -> MathResult<()> {
        let mut noop = |_: u128, _: u64, _: u128| {};
        self.advance_bounded_with(now, max_steps, &mut noop)
    }

    /// Walk hourly boundaries up to `now`, then the trailing partial segment.
    ///
    /// `on_delta(delta_acc, cur_idx, total_weight)` fires once per segment, with
    /// the boundary index and the aggregate weight in force during that
    /// segment. Weight is constant within a segment, which is what lets the
    /// simulator integrate exactly and cross-check the incremental cohort
    /// bookkeeping against an explicit sum over positions.
    pub fn advance_with<F>(&mut self, now: u64, mut on_delta: F) -> MathResult<()>
    where
        F: FnMut(u128, u64, u128),
    {
        self.advance_bounded_with(now, u64::MAX, &mut on_delta)
    }

    /// Resumable crank honouring `max_steps` boundaries per call.
    pub fn advance_bounded_with<F>(
        &mut self,
        now: u64,
        max_steps: u64,
        on_delta: &mut F,
    ) -> MathResult<()>
    where
        F: FnMut(u128, u64, u128),
    {
        let mut steps = 0u64;
        while steps < max_steps {
            let idx = self.next_boundary;
            if idx as usize >= self.acc_at.len() {
                break; // checkpoint capacity reached
            }
            let t_b = self
                .start_ts
                .checked_add(idx * TENURE_STEP_SECONDS)
                .ok_or(MathError::Overflow)?;
            if t_b > now {
                break;
            }

            // Segment runs under the *previous* boundary's weights.
            let cur = self.cur_idx();
            let delta = self.accrue_segment(self.last_ts, t_b)?;
            let w = self.total_weight;
            on_delta(delta, cur, w);

            // Record A_n and G_n = G_{n-1} + A_n before weights change.
            self.sum_acc = self.sum_acc.c_add(self.acc)?;
            self.acc_at[idx as usize] = self.acc;
            self.sum_acc_at[idx as usize] = self.sum_acc;

            // Every still-ramping position gains one step of weight...
            self.total_weight = self.total_weight.c_add(self.ramping_stake)?;
            // ...then this boundary's cohort hits the cap and stops ramping.
            self.ramping_stake = self.ramping_stake.c_sub(self.maturing[idx as usize])?;

            self.last_ts = t_b;
            self.next_boundary += 1;
            steps += 1;
        }

        // Trailing partial segment (no checkpoint recorded).
        let next_t = self
            .start_ts
            .checked_add(self.next_boundary * TENURE_STEP_SECONDS)
            .ok_or(MathError::Overflow)?;
        let boundaries_drained = next_t > now || self.next_boundary as usize >= self.acc_at.len();

        if boundaries_drained && now > self.last_ts {
            let cur = self.cur_idx();
            let delta = self.accrue_segment(self.last_ts, now)?;
            let w = self.total_weight;
            on_delta(delta, cur, w);
            self.last_ts = now.min(self.end_ts).max(self.last_ts);
        }
        Ok(())
    }

    /// Reward owed since the last settlement, without mutating anything.
    pub fn pending_of(&self, user: usize) -> MathResult<u128> {
        let p = &self.positions[user];
        if p.amount == 0 {
            return Ok(p.pending);
        }
        let k_raw = self.cur_idx().saturating_sub(p.n0);
        let g_k = self.checkpoint(p.n0 + capped_steps(k_raw))?;
        let earned = accrual(p.amount, &p.snap, k_raw, self.acc, g_k)?;
        p.pending.c_add(earned)
    }

    /// Fold accrued reward into `pending` and re-baseline the snapshot.
    ///
    /// Never touches `weighted_deposit_ts` or `n0`: settlement, and therefore
    /// claiming, must not disturb tenure.
    fn settle(&mut self, user: usize) -> MathResult<()> {
        let p = self.positions[user].clone();
        if p.amount == 0 {
            return Ok(());
        }
        let k_raw = self.cur_idx().saturating_sub(p.n0);
        let k = capped_steps(k_raw);
        let g_k = self.checkpoint(p.n0 + k)?;
        let earned = accrual(p.amount, &p.snap, k_raw, self.acc, g_k)?;

        let p = &mut self.positions[user];
        p.pending = p.pending.c_add(earned)?;
        p.snap = Snapshot {
            acc: self.acc,
            sum_acc: g_k,
            k,
        };
        Ok(())
    }

    /// Detach a position's contribution from the pool aggregates.
    fn remove_weight(&mut self, user: usize) -> MathResult<()> {
        let p = self.positions[user].clone();
        if p.amount == 0 {
            return Ok(());
        }
        let k = capped_steps(self.cur_idx().saturating_sub(p.n0));
        self.total_weight = self.total_weight.c_sub(weight(p.amount, k)?)?;
        if k < TENURE_RAMP_STEPS {
            self.ramping_stake = self.ramping_stake.c_sub(p.amount)?;
            let m = (p.n0 + TENURE_RAMP_STEPS) as usize;
            let slot = self
                .maturing
                .get_mut(m)
                .ok_or(MathError::MaturityOutOfBounds)?;
            *slot = slot.c_sub(p.amount)?;
        }
        Ok(())
    }

    /// Re-attach a position and re-snapshot. Assumes weight was removed first.
    fn add_weight(&mut self, user: usize) -> MathResult<()> {
        let p = self.positions[user].clone();
        if p.amount == 0 {
            return Ok(());
        }
        let k = capped_steps(self.cur_idx().saturating_sub(p.n0));
        self.total_weight = self.total_weight.c_add(weight(p.amount, k)?)?;
        if k < TENURE_RAMP_STEPS {
            self.ramping_stake = self.ramping_stake.c_add(p.amount)?;
            let m = (p.n0 + TENURE_RAMP_STEPS) as usize;
            let slot = self
                .maturing
                .get_mut(m)
                .ok_or(MathError::MaturityOutOfBounds)?;
            *slot = slot.c_add(p.amount)?;
        }
        let g = self.checkpoint(p.n0 + k)?;
        let p = &mut self.positions[user];
        p.snap = Snapshot {
            acc: self.acc,
            sum_acc: g,
            k,
        };
        Ok(())
    }

    /// Shared deposit path for `stake` and `compound`.
    ///
    /// Ordering is mandatory: remove old weight and cohort entry, apply the
    /// stake-weighted average timestamp, then re-add weight and snapshot.
    fn apply_deposit(&mut self, user: usize, amount: u128, now: u64, enforce_min: bool) -> R<()> {
        let p = self.positions[user].clone();
        let new_amount = p.amount.c_add(amount)?;
        if enforce_min && new_amount < self.min_stake {
            return Err(PoolError::BelowMinimumStake);
        }
        let new_ts = weighted_deposit_ts(p.amount, p.weighted_deposit_ts, amount, now)?;
        let n0 = self.boundary_index(new_ts);
        if (n0 + TENURE_RAMP_STEPS) as usize >= self.maturing.len() {
            return Err(PoolError::Math(MathError::MaturityOutOfBounds));
        }

        self.remove_weight(user)?;
        {
            let p = &mut self.positions[user];
            p.amount = new_amount;
            p.weighted_deposit_ts = new_ts;
            p.n0 = n0;
        }
        self.total_staked = self.total_staked.c_add(amount)?;
        self.add_weight(user)?;
        Ok(())
    }

    pub fn stake(&mut self, user: usize, amount: u128, now: u64) -> R<()> {
        if !self.started {
            return Err(PoolError::NotStarted);
        }
        if self.paused {
            return Err(PoolError::Paused);
        }
        if amount == 0 {
            return Err(PoolError::ZeroAmount);
        }
        self.advance(now)?;
        self.settle(user)?;
        self.apply_deposit(user, amount, now, true)
    }

    /// Partial or full withdrawal. Allowed while paused.
    ///
    /// Resets the *entire* position's tenure to 1.0x, not just the withdrawn
    /// slice. Pending rewards survive untouched.
    pub fn unstake(&mut self, user: usize, amount: u128, now: u64) -> R<()> {
        if amount == 0 {
            return Err(PoolError::ZeroAmount);
        }
        self.advance(now)?;
        self.settle(user)?;
        if amount > self.positions[user].amount {
            return Err(PoolError::InsufficientStake);
        }

        self.remove_weight(user)?;
        {
            let p = &mut self.positions[user];
            p.amount = p.amount.c_sub(amount)?;
            // Full tenure reset.
            p.weighted_deposit_ts = now;
        }
        self.total_staked = self.total_staked.c_sub(amount)?;
        let n0 = self.boundary_index(now);
        self.positions[user].n0 = n0;
        self.add_weight(user)?;
        Ok(())
    }

    /// Pay out pending rewards. Never touches tenure.
    pub fn claim(&mut self, user: usize, now: u64) -> R<u128> {
        self.advance(now)?;
        self.settle(user)?;
        let p = &mut self.positions[user];
        let amt = p.pending;
        p.pending = 0;
        p.claimed = p.claimed.c_add(amt)?;
        self.total_claimed = self.total_claimed.c_add(amt)?;
        Ok(amt)
    }

    /// Fold pending rewards into principal. Exempt from `min_stake`, and
    /// dilutes tenure by the same weighted-average rule as a fresh deposit.
    pub fn compound(&mut self, user: usize, now: u64) -> R<u128> {
        if !self.started {
            return Err(PoolError::NotStarted);
        }
        if self.paused {
            return Err(PoolError::Paused);
        }
        self.advance(now)?;
        self.settle(user)?;
        let amt = self.positions[user].pending;
        if amt == 0 {
            return Ok(0);
        }
        self.positions[user].pending = 0;
        self.positions[user].compounded = self.positions[user].compounded.c_add(amt)?;
        self.total_compounded = self.total_compounded.c_add(amt)?;
        self.apply_deposit(user, amt, now, false)?;
        Ok(amt)
    }

    /// Admin recovery of undistributable emissions, only after `end_ts + grace`.
    pub fn withdraw_unallocated(&mut self, amount: u128, now: u64, grace: u64) -> R<u128> {
        if now <= self.end_ts.saturating_add(grace) {
            return Err(PoolError::NotEnded);
        }
        if amount > self.unallocated {
            return Err(PoolError::InsufficientStake);
        }
        self.unallocated = self.unallocated.c_sub(amount)?;
        Ok(amount)
    }

    // ---- views ----

    pub fn tenure_bps(&self, user: usize) -> u128 {
        let p = &self.positions[user];
        if p.amount == 0 {
            return BPS;
        }
        tenure_mult_bps(self.cur_idx().saturating_sub(p.n0))
    }

    pub fn average_bps(&self) -> Option<u128> {
        average_mult_bps(self.total_weight, self.total_staked)
    }

    pub fn total_distributed(&self) -> u128 {
        self.total_claimed + self.total_compounded
    }

    // ---- invariants ----

    /// `total_weight == sum stake_i * (72 + min(k_i, 72))`.
    pub fn check_weight_invariant(&self) -> MathResult<()> {
        let cur = self.cur_idx();
        let mut sum = 0u128;
        for p in &self.positions {
            if p.amount == 0 {
                continue;
            }
            sum = sum.c_add(weight(p.amount, capped_steps(cur.saturating_sub(p.n0)))?)?;
        }
        if sum != self.total_weight {
            return Err(MathError::Underflow);
        }
        Ok(())
    }

    /// `ramping_stake == sum of stake not yet at the cap`.
    pub fn check_ramping_invariant(&self) -> MathResult<()> {
        let cur = self.cur_idx();
        let mut sum = 0u128;
        for p in &self.positions {
            if p.amount == 0 {
                continue;
            }
            if cur.saturating_sub(p.n0) < TENURE_RAMP_STEPS {
                sum = sum.c_add(p.amount)?;
            }
        }
        if sum != self.ramping_stake {
            return Err(MathError::Underflow);
        }
        Ok(())
    }

    /// Solvency: nothing paid or owed may exceed what was emitted, and nothing
    /// emitted may exceed what was funded.
    pub fn check_solvency(&self) -> MathResult<()> {
        let owed: u128 = self.positions.iter().map(|p| p.pending).sum();
        if self.total_distributed().c_add(owed)? > self.total_emitted {
            return Err(MathError::Overflow);
        }
        if self.total_emitted > self.funded {
            return Err(MathError::Overflow);
        }
        Ok(())
    }

    pub fn check_all(&self) -> MathResult<()> {
        self.check_weight_invariant()?;
        self.check_ramping_invariant()?;
        self.check_solvency()
    }
}
