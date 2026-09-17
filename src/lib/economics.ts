import { useEffect, useMemo, useState } from "react";

/**
 * Shared economics for The Staking Forge.
 *
 * This is the single source of truth for pool constants, live pool stats,
 * formatting helpers, and reward / APY projection math. Both the live
 * dashboard and the APY calculator consume this module so the numbers on
 * screen always agree.
 *
 * All token amounts are expressed in base units (integer) with `DECIMALS`
 * decimal places, matching the on-chain SPL mint convention.
 */

// ─── Pool constants ───

/** Token decimals for the staked mint. */
export const DECIMALS = 6;

/** Reward emissions accrue on a fixed 20-minute tick. */
export const TICK_SECONDS = 20 * 60; // 1200s
/** Number of reward ticks in a single day. */
export const TICKS_PER_DAY = 86_400 / TICK_SECONDS; // 72

/** Tenure multiplier grows every hour a position is held. */
export const TENURE_TICK_SECONDS = 3_600;
/** Emission multiplier steps every 2 hours during the ramp. */
export const EMISSION_STEP_SECONDS = 2 * 3_600;

/** Emissions ramp from 1.0x to 2.0x over the first day, then plateau. */
export const EMISSION_RAMP_DAYS = 1;
export const EMISSION_MIN_MULT = 1.0;
export const EMISSION_MAX_MULT = 2.0;

/** Tenure multiplier bounds (1.0x at entry up to 2.0x at full tenure). */
export const TENURE_MIN_MULT = 1.0;
export const TENURE_MAX_MULT = 2.0;
/** Days of continuous staking required to reach the max tenure multiplier.
 *  Matches on-chain TENURE_RAMP_STEPS = 72 hourly steps (3 days). */export const TENURE_MAX_DAYS = 3;

/** Total program duration. */
export const PROGRAM_DAYS = 14;

// ─── Helpers ───

/** Convert base units to a human token amount. */
export function toTokens(baseUnits: number): number {
  return baseUnits / 10 ** DECIMALS;
}

/** Convert a human token amount to base units. */
export function toBaseUnits(tokens: number): number {
  return Math.round(tokens * 10 ** DECIMALS);
}

/** Compact token formatter (e.g. 2.50M, 1.2K, 42.00). */
export function formatTokens(baseUnits: number): string {
  const val = toTokens(baseUnits);
  return formatCompact(val);
}

/** Compact number formatter operating on already-scaled values. */
export function formatCompact(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(2);
}

/** Percentage formatter with sensible precision for large APYs. */
export function formatPercent(pct: number): string {
  if (!isFinite(pct)) return "—";
  if (pct >= 1000) return `${formatCompact(pct)}%`;
  if (pct >= 100) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Human countdown string from a seconds remaining value. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Ended";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Ticking "now" in unix seconds; updates once per second. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(i);
  }, []);
  return now;
}

// ─── Live pool stats ───

export interface PoolStats {
  now: number;
  tvl: number; // base units staked across the pool
  currentRate: number; // base-unit reward emitted per 20-min tick (pool-wide)
  plateauRate: number; // rate once emissions reach the 2.0x plateau
  emissionMultiplier: number; // current emissions ramp multiplier (1.0x→2.0x)
  poolAvgMultiplier: number; // average tenure multiplier across all stakers
  yourMultiplier: number; // your tenure multiplier
  yourStake: number; // your staked balance (base units)
  yourPending: number; // your unclaimed rewards (base units)
  totalClaimed: number;
  funded: number;
  remaining: number;
  startTs: number;
  endTs: number;
  started: boolean;
  paused: boolean;
  durationDays?: number;
  symbol?: string;
}

/**
 * Mock live pool stats. In production this would be derived from on-chain
 * account data; here it emulates a pool 5 days into a 14-day program.
 */
export function usePoolStats(): PoolStats {
  const now = useNow();
  const startTs = now - 5 * 86_400;
  const baseRate = 26_329_647_182;
  return {
    now,
    tvl: 2_500_000_000_000,
    currentRate: baseRate,
    plateauRate: baseRate * 2,
    emissionMultiplier: 1.5,
    poolAvgMultiplier: 1.4,
    yourMultiplier: 1.85,
    yourStake: 100_000_000_000,
    yourPending: 5_230_000_000,
    totalClaimed: 12_400_000_000,
    funded: 50_000_000_000_000,
    remaining: 35_000_000_000_000,
    startTs,
    endTs: startTs + PROGRAM_DAYS * 86_400,
    started: true,
    paused: false,
    durationDays: PROGRAM_DAYS,
  };
}

// ─── Reward / APY math ───

export interface ProjectionInput {
  /** Your stake in base units. */
  stake: number;
  /** Total value locked in the pool, base units (your stake is included). */
  tvl: number;
  /** Pool-wide reward emitted per tick, base units, at 1.0x emission. */
  baseRatePerTick: number;
  /** Emission ramp multiplier applied to the pool rate (1.0x→2.0x). */
  emissionMultiplier: number;
  /** Your tenure multiplier (1.0x→2.0x). */
  tenureMultiplier: number;
  /** Average tenure multiplier of everyone else in the pool. */
  poolAvgMultiplier: number;
  /** Projection horizon in days. */
  horizonDays: number;
}

export interface ProjectionResult {
  /** Projected rewards over the horizon, base units. */
  totalReward: number;
  /** Projected reward for a single day at the current rate, base units. */
  dailyReward: number;
  /** Simple annualised return on stake (APR), percent. */
  apr: number;
  /** Compounded annual yield assuming daily compounding (APY), percent. */
  apy: number;
  /** Your share of pool emissions, 0..1. */
  shareOfPool: number;
  /** Effective reward-weight of your stake (stake * tenure), base units. */
  effectiveWeight: number;
}

/**
 * Project rewards and yield for a position.
 *
 * Emissions are distributed by reward-weight, where each staker's weight is
 * `stake * tenureMultiplier`. Your share of every tick is therefore:
 *
 *   yourWeight / (yourWeight + othersWeight)
 *
 * The pool emits `baseRatePerTick * emissionMultiplier` base units per tick.
 * Daily reward = perTick * TICKS_PER_DAY * yourShare.
 *
 * APR is the simple annualised daily reward over your stake. APY compounds
 * that daily return over 365 days.
 */
export function projectRewards(input: ProjectionInput): ProjectionResult {
  const {
    stake,
    tvl,
    baseRatePerTick,
    emissionMultiplier,
    tenureMultiplier,
    poolAvgMultiplier,
    horizonDays,
  } = input;

  const yourWeight = stake * tenureMultiplier;
  // Weight contributed by the rest of the pool (TVL excluding your stake).
  const othersStake = Math.max(0, tvl - stake);
  const othersWeight = othersStake * poolAvgMultiplier;
  const totalWeight = yourWeight + othersWeight;

  const shareOfPool = totalWeight > 0 ? yourWeight / totalWeight : 0;

  const poolPerTick = baseRatePerTick * emissionMultiplier;
  const yourPerTick = poolPerTick * shareOfPool;
  const dailyReward = yourPerTick * TICKS_PER_DAY;
  const totalReward = dailyReward * horizonDays;

  // Daily return relative to principal.
  const dailyReturn = stake > 0 ? dailyReward / stake : 0;
  const apr = dailyReturn * 365 * 100;
  const apy = (Math.pow(1 + dailyReturn, 365) - 1) * 100;

  return {
    totalReward,
    dailyReward,
    apr,
    apy,
    shareOfPool,
    effectiveWeight: yourWeight,
  };
}

/**
 * The emission ramp multiplier at a given elapsed time since program start.
 * Ramps linearly 1.0x→2.0x over `EMISSION_RAMP_DAYS`, then holds at 2.0x.
 */
export function emissionMultiplierAt(elapsedSeconds: number): number {
  const rampSeconds = EMISSION_RAMP_DAYS * 86_400;
  if (elapsedSeconds >= rampSeconds) return EMISSION_MAX_MULT;
  const t = Math.max(0, elapsedSeconds) / rampSeconds;
  return EMISSION_MIN_MULT + t * (EMISSION_MAX_MULT - EMISSION_MIN_MULT);
}

/**
 * The tenure multiplier after holding a position for `heldDays` days.
 * Grows linearly 1.0x→2.0x over `TENURE_MAX_DAYS`, then holds.
 */
export function tenureMultiplierAfter(heldDays: number): number {
  if (heldDays >= TENURE_MAX_DAYS) return TENURE_MAX_MULT;
  const t = Math.max(0, heldDays) / TENURE_MAX_DAYS;
  return TENURE_MIN_MULT + t * (TENURE_MAX_MULT - TENURE_MIN_MULT);
}


// ─── Per-account activity history ───

/** Kinds of on-chain actions a staker can take. */
export type HistoryAction = "stake" | "unstake" | "claim" | "compound";

export interface HistoryEvent {
  /** Stable id (deterministic per wallet + index). */
  id: string;
  action: HistoryAction;
  /** Unix seconds when the action occurred. */
  timestamp: number;
  /**
   * Token amount involved, base units:
   *  - stake/unstake: principal moved
   *  - claim: rewards withdrawn
   *  - compound: rewards folded into principal
   */
  amount: number;
  /** The staker's principal AFTER this action, base units. */
  balanceAfter: number;
  /** Tenure multiplier at the time of the action. */
  multiplier: number;
  /** Mock transaction signature for display. */
  signature: string;
}

/** Small deterministic PRNG (mulberry32) so a given wallet always maps to the
 *  same synthetic history — stable across renders and reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a numeric seed from a wallet address string. */
function seedFromAddress(address: string): number {
  let h = 2166136261;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Build a fake-but-stable base58-ish signature. */
function makeSignature(rand: () => number): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

/**
 * Deterministic per-account staking history.
 *
 * Given a connected wallet address, produces a stable, chronologically ordered
 * activity log (stake / unstake / claim / compound). Returns an empty array
 * when no address is provided (wallet disconnected). In production this hook
 * would query an indexer for the account's transactions; the shape is designed
 * to drop-in replace with real data.
 */
export function useAccountHistory(address: string | null | undefined): HistoryEvent[] {
  // Capture a stable "now" once at mount (lazy initializer runs a single time),
  // keeping the memo below pure across renders.
  const [now] = useState(() => Date.now() / 1000);

  return useMemo(() => {
    if (!address) return [];

    const rand = mulberry32(seedFromAddress(address));

    // Number of events this account has: 6–14, stable per wallet.
    const count = 6 + Math.floor(rand() * 9);

    const events: HistoryEvent[] = [];
    let balance = 0; // principal in base units
    let multiplier = TENURE_MIN_MULT;
    let lastStakeTs = 0;

    // Walk backwards from "days ago" to now, spacing events out.
    let ts = now - (2 + rand() * 4) * 86_400 * (count / 6);

    for (let i = 0; i < count; i++) {
      // Advance time by 3h–2d between actions.
      ts += (3 * 3600) + rand() * (2 * 86_400 - 3 * 3600);
      if (ts > now) ts = now - rand() * 3600;

      // Decide action based on current state.
      let action: HistoryAction;
      if (balance === 0) {
        action = "stake";
      } else {
        const r = rand();
        if (r < 0.4) action = "stake";
        else if (r < 0.6) action = "claim";
        else if (r < 0.8) action = "compound";
        else action = "unstake";
      }

      // Tenure grows with time since last stake; resets on unstake.
      if (lastStakeTs > 0 && balance > 0) {
        const heldDays = (ts - lastStakeTs) / 86_400;
        multiplier = tenureMultiplierAfter(heldDays);
      }

      let amount = 0;
      switch (action) {
        case "stake": {
          amount = Math.round((5_000 + rand() * 95_000) * 10 ** DECIMALS);
          balance += amount;
          lastStakeTs = ts;
          if (multiplier === TENURE_MIN_MULT) multiplier = TENURE_MIN_MULT;
          break;
        }
        case "unstake": {
          amount = Math.round(balance * (0.3 + rand() * 0.7));
          balance = Math.max(0, balance - amount);
          multiplier = TENURE_MIN_MULT; // reset on unstake
          lastStakeTs = balance > 0 ? ts : 0;
          break;
        }
        case "claim": {
          // Rewards proportional to balance × multiplier × elapsed.
          amount = Math.round(balance * 0.02 * multiplier * (0.5 + rand()));
          break;
        }
        case "compound": {
          amount = Math.round(balance * 0.02 * multiplier * (0.5 + rand()));
          balance += amount; // folded into principal
          break;
        }
      }

      events.push({
        id: `${address.slice(0, 6)}-${i}`,
        action,
        timestamp: Math.floor(ts),
        amount,
        balanceAfter: balance,
        multiplier,
        signature: makeSignature(rand),
      });
    }

    // Newest first.
    return events.sort((a, b) => b.timestamp - a.timestamp);
  }, [address, now]);
}
