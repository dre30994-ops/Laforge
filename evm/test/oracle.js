// A faithful JS reimplementation of the ON-CHAIN staking semantics (the Anchor
// program in programs/staking, NOT the ref model's trailing-partial variant).
//
// Used as an independent oracle in differential tests: we run the same scenario
// through this oracle and through the deployed Solidity contract and assert the
// aggregates and per-user payouts match to the base unit.
//
// The oracle is itself cross-checked against the Rust reference GOLDEN values
// (total_weight formulas, tenure bps, total_emitted = r0*DENOM, etc.) inside the
// differential test file, so a bug in the oracle cannot silently pass.

const DENOM = 1977n;
const MULT_DENOM = 12n;
const PLATEAU_NUMERATOR = 24n;
const RAMP_NUMERATOR_SUM = 210n;
const PERIODS_PER_EMISSION_STEP = 6n; // 2-hour step / 20-min period
const PERIODS_PER_TENURE_STEP = 3n;
const EMISSION_RAMP_STEPS = 12n;
const TENURE_RAMP_STEPS = 72n;
const TENURE_STEP_SECONDS = 3600n;
const EMISSION_STEP_SECONDS = 7200n; // 2 hours
const PERIOD_SECONDS = 1200n;
const SECONDS_PER_DAY = 86400n;
const DURATION_DAYS = 14n;
const ACC_SCALE = 10n ** 18n;
const CHECKPOINT_CAPACITY = 816n;
const MATURING_CAPACITY = 896n;

function min(a, b) { return a < b ? a : b; }
function cappedSteps(k) { return k > TENURE_RAMP_STEPS ? TENURE_RAMP_STEPS : k; }
function weightNumerator(k) { return TENURE_RAMP_STEPS + cappedSteps(k); }
function emissionMultNumerator(step) {
  const capped = step > EMISSION_RAMP_STEPS ? EMISSION_RAMP_STEPS : step;
  return MULT_DENOM + capped;
}
function deriveBaseRate(funded) { return funded / DENOM; }

function cumulativeNumerator(elapsed) {
  const periods = elapsed / PERIOD_SECONDS;
  const fullSteps = periods / PERIODS_PER_EMISSION_STEP;
  const rem = periods % PERIODS_PER_EMISSION_STEP;
  let stepsTotal;
  if (fullSteps <= EMISSION_RAMP_STEPS) {
    const triangular = fullSteps === 0n ? 0n : (fullSteps * (fullSteps - 1n)) / 2n;
    stepsTotal = PERIODS_PER_EMISSION_STEP * (MULT_DENOM * fullSteps + triangular);
  } else {
    const ramp = PERIODS_PER_EMISSION_STEP * RAMP_NUMERATOR_SUM;
    const plateauSteps = fullSteps - EMISSION_RAMP_STEPS;
    stepsTotal = ramp + PERIODS_PER_EMISSION_STEP * PLATEAU_NUMERATOR * plateauSteps;
  }
  return stepsTotal + rem * emissionMultNumerator(fullSteps);
}
function remainingPeriodUnits(elapsed) {
  return cumulativeNumerator(DURATION_DAYS * SECONDS_PER_DAY) - cumulativeNumerator(elapsed);
}
function totalNumeratorForDuration(durationDays) {
  return cumulativeNumerator(durationDays * SECONDS_PER_DAY);
}
function denomForDuration(durationDays) {
  return totalNumeratorForDuration(durationDays) / MULT_DENOM;
}
function remainingPeriodUnitsFor(elapsed, durationDays) {
  const total = totalNumeratorForDuration(durationDays);
  const soFar = cumulativeNumerator(elapsed);
  return soFar >= total ? 0n : total - soFar;
}
function deriveBaseRateForDuration(funded, durationDays) {
  return funded / denomForDuration(durationDays);
}
function weightedDepositTs(stakeOld, tsOld, added, now) {
  const total = stakeOld + added;
  if (total === 0n) return now;
  return (stakeOld * tsOld + added * now) / total;
}
function accrual(stake, snap, k, accNow, gK) {
  if (stake === 0n) return 0n;
  const kNow = cappedSteps(k);
  const kSnap = cappedSteps(snap.k);
  if (kNow < kSnap) throw new Error("tenure backwards");
  const grown = (TENURE_RAMP_STEPS + kNow) * accNow;
  const base = (TENURE_RAMP_STEPS + kSnap) * snap.acc;
  const boundaryCorrection = gK - snap.sumAcc;
  const bracket = grown - base - boundaryCorrection;
  return (stake * bracket) / ACC_SCALE;
}

// Mirrors the on-chain Pool. One token, whole-boundary crank (no trailing
// partial), matching programs/staking/src/instructions/crank.rs.
class OraclePool {
  constructor(startTs, durationDays = 14n) {
    this.startTs = startTs;
    this.durationDays = durationDays;
    this.endTs = startTs + durationDays * SECONDS_PER_DAY;
    this.funded = 0n;
    this.baseRate = 0n;
    this.started = false;
    this.paused = false;
    this.minStake = 0n;

    this.totalStaked = 0n;
    this.totalWeight = 0n;
    this.rampingStake = 0n;
    this.acc = 0n;
    this.sumAcc = 0n;
    this.lastUpdateTs = startTs;
    this.nextBoundaryIndex = 1n;

    this.totalEmitted = 0n;
    this.totalClaimed = 0n;
    this.unallocated = 0n;

    this.checkpoints = {}; // n -> {acc, sumAcc}
    this.maturing = {}; // n -> amount
    this.positions = {}; // user -> position
  }

  _pos(u) {
    if (!this.positions[u]) {
      this.positions[u] = {
        amount: 0n, weightedDepositTs: 0n, depositBoundaryIndex: 0n,
        snapshotK: 0n, accSnapshot: 0n, sumAccSnapshot: 0n,
        pending: 0n, totalClaimed: 0n,
      };
    }
    return this.positions[u];
  }

  fund(amount, started) {
    this.funded += amount;
    if (this.started) this._reprice();
  }
  start() {
    this.baseRate = deriveBaseRateForDuration(this.funded, this.durationDays);
    this.started = true;
    this.lastUpdateTs = this.startTs; // start_ts == now in tests
  }
  _reprice() {
    const maxElapsed = this.durationDays * SECONDS_PER_DAY;
    let elapsed = this.lastUpdateTs - this.startTs;
    if (elapsed > maxElapsed) elapsed = maxElapsed;
    const remainingFunds = this.funded - this.totalEmitted;
    const remainingUnits = remainingPeriodUnitsFor(elapsed, this.durationDays);
    const newRate = (remainingFunds * MULT_DENOM) / remainingUnits;
    if (newRate < this.baseRate) throw new Error("RateDecreased");
    this.baseRate = newRate;
  }

  crank(now) {
    const effectiveNow = min(now, this.endTs);
    const elapsed = effectiveNow > this.startTs ? effectiveNow - this.startTs : 0n;
    const targetBoundary = elapsed / TENURE_STEP_SECONDS;

    while (this.nextBoundaryIndex <= targetBoundary) {
      const n = this.nextBoundaryIndex;
      // Distribute at pre-increment weight, checkpoint, THEN increment (H-2).
      const hoursPerEmissionStep = EMISSION_STEP_SECONDS / TENURE_STEP_SECONDS;
      let emissionStep = (n - 1n) / hoursPerEmissionStep;
      if (emissionStep > EMISSION_RAMP_STEPS) emissionStep = EMISSION_RAMP_STEPS;
      const mult = emissionMultNumerator(emissionStep);
      const emission = (this.baseRate * PERIODS_PER_TENURE_STEP * mult) / MULT_DENOM;
      this.totalEmitted += emission;
      if (this.totalWeight > 0n) {
        this.acc += (emission * ACC_SCALE) / this.totalWeight;
      } else {
        this.unallocated += emission;
      }
      this.sumAcc += this.acc;
      if (n < CHECKPOINT_CAPACITY) {
        this.checkpoints[n] = { acc: this.acc, sumAcc: this.sumAcc };
      }
      this.totalWeight += this.rampingStake;
      if (n < MATURING_CAPACITY) {
        const grad = this.maturing[n] || 0n;
        if (grad > 0n) { this.rampingStake -= grad; this.maturing[n] = 0n; }
      }
      this.nextBoundaryIndex = n + 1n;
    }
    const crankedTo = this.startTs + this.nextBoundaryIndex * TENURE_STEP_SECONDS;
    this.lastUpdateTs = min(crankedTo, effectiveNow);
  }

  _tenureSteps(p, now) {
    if (p.amount === 0n) return 0n;
    const elapsed = now > p.weightedDepositTs ? now - p.weightedDepositTs : 0n;
    return min(elapsed / TENURE_STEP_SECONDS, TENURE_RAMP_STEPS);
  }
  _tenureBoundaryIndex(p) {
    const off = p.weightedDepositTs > this.startTs ? p.weightedDepositTs - this.startTs : 0n;
    return off / TENURE_STEP_SECONDS;
  }
  _computePending(p) {
    if (p.amount === 0n) return 0n;
    const elapsed = this.lastUpdateTs > p.weightedDepositTs ? this.lastUpdateTs - p.weightedDepositTs : 0n;
    let kNow = elapsed / TENURE_STEP_SECONDS;
    if (kNow > TENURE_RAMP_STEPS) kNow = TENURE_RAMP_STEPS;
    const snap = { acc: p.accSnapshot, sumAcc: p.sumAccSnapshot, k: p.snapshotK };
    const gIdx = p.depositBoundaryIndex + cappedSteps(kNow);
    let gK;
    if (gIdx < CHECKPOINT_CAPACITY && gIdx < this.nextBoundaryIndex) {
      gK = (this.checkpoints[gIdx] || { sumAcc: 0n }).sumAcc;
    } else {
      gK = this.sumAcc;
    }
    return accrual(p.amount, snap, kNow, this.acc, gK);
  }

  // The g_k baseline consistent with tenure step k (see contract _snapshotSumAcc).
  _snapshotSumAcc(depositBoundaryIndex, k) {
    const gIdx = depositBoundaryIndex + cappedSteps(k);
    if (gIdx < CHECKPOINT_CAPACITY && gIdx < this.nextBoundaryIndex) {
      return (this.checkpoints[gIdx] || { sumAcc: 0n }).sumAcc;
    }
    return this.sumAcc;
  }

  stake(u, amount, now) {
    const p = this._pos(u);
    const oldAmount = p.amount;
    if (oldAmount > 0n) {
      p.pending += this._computePending(p);
      const oldK = this._tenureSteps(p, now);
      this.totalWeight -= oldAmount * weightNumerator(oldK);
      if (oldK < TENURE_RAMP_STEPS) this.rampingStake -= oldAmount;
    }
    p.weightedDepositTs = weightedDepositTs(oldAmount, p.weightedDepositTs, amount, now);
    const newAmount = p.amount + amount;
    p.amount = newAmount;
    const newK = this._tenureSteps(p, now);
    this.totalWeight += newAmount * weightNumerator(newK);
    this.totalStaked += amount;
    if (newK < TENURE_RAMP_STEPS) {
      this.rampingStake += newAmount;
      const cur = this.nextBoundaryIndex - 1n;
      const idx = cur + (TENURE_RAMP_STEPS - newK);
      if (idx < MATURING_CAPACITY) this.maturing[idx] = (this.maturing[idx] || 0n) + newAmount;
    }
    p.depositBoundaryIndex = this._tenureBoundaryIndex(p);
    p.snapshotK = newK;
    p.accSnapshot = this.acc;
    p.sumAccSnapshot = this._snapshotSumAcc(p.depositBoundaryIndex, newK);
  }

  unstake(u, amount, now) {
    const p = this._pos(u);
    p.pending += this._computePending(p);
    const oldAmount = p.amount;
    const oldK = this._tenureSteps(p, now);
    this.totalWeight -= oldAmount * weightNumerator(oldK);
    if (oldK < TENURE_RAMP_STEPS) this.rampingStake -= oldAmount;
    const newAmount = p.amount - amount;
    p.amount = newAmount;
    this.totalStaked -= amount;
    p.weightedDepositTs = now;
    if (newAmount > 0n) {
      this.totalWeight += newAmount * weightNumerator(0n);
      this.rampingStake += newAmount;
      const cur = this.nextBoundaryIndex - 1n;
      const idx = cur + TENURE_RAMP_STEPS;
      if (idx < MATURING_CAPACITY) this.maturing[idx] = (this.maturing[idx] || 0n) + newAmount;
    }
    p.snapshotK = 0n;
    p.depositBoundaryIndex = this.nextBoundaryIndex - 1n;
    p.accSnapshot = this.acc;
    p.sumAccSnapshot = this._snapshotSumAcc(p.depositBoundaryIndex, 0n);
    const tax = (amount * 500n) / 10000n;
    return { userAmount: amount - tax, tax };
  }

  claim(u, now) {
    const p = this._pos(u);
    p.pending += this._computePending(p);
    const kNow = this._tenureSteps(p, now);
    p.snapshotK = kNow;
    p.accSnapshot = this.acc;
    p.sumAccSnapshot = this._snapshotSumAcc(p.depositBoundaryIndex, kNow);
    const payout = p.pending;
    if (payout === 0n) return 0n;
    p.pending = 0n;
    p.totalClaimed += payout;
    this.totalClaimed += payout;
    return payout;
  }

  pendingRewards(u) {
    const p = this._pos(u);
    return p.pending + this._computePending(p);
  }
}

module.exports = {
  OraclePool, deriveBaseRate, cumulativeNumerator, remainingPeriodUnits,
  denomForDuration, remainingPeriodUnitsFor, deriveBaseRateForDuration,
  DENOM, TENURE_RAMP_STEPS, ACC_SCALE, HOUR: TENURE_STEP_SECONDS, DAY: SECONDS_PER_DAY,
};
