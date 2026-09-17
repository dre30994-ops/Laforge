import { formatUnits } from "viem";
import {
  PROGRAM_DAYS,
  TICKS_PER_DAY,
  toBaseUnits,
  type PoolStats,
} from "@/lib/economics";
import type { PoolSummary } from "@/lib/factoryClient";
import { getMockPosition, isMockPoolAddress, MOCK_DEMO_USER } from "@/lib/mockPools";

/** Map a pool's vault into the shared 6-decimal projector used by APY / charts. */
export function poolToStats(
  pool: PoolSummary,
  now = Date.now() / 1000,
  yourStakeTokens?: number,
  yourPendingTokens?: number,
): PoolStats {
  const dec = pool.decimals || 18;
  const toEcon = (raw?: bigint | null): number => {
    if (raw == null) return 0;
    const tokens = Number(formatUnits(raw, dec));
    if (!Number.isFinite(tokens)) return 0;
    return toBaseUnits(tokens);
  };

  let yourStake = toBaseUnits(yourStakeTokens ?? 0);
  let yourPending = toBaseUnits(yourPendingTokens ?? 0);
  if (isMockPoolAddress(pool.pool) && yourStakeTokens == null) {
    const pos = getMockPosition(pool.chainId, pool.pool, MOCK_DEMO_USER);
    yourStake = toEcon(pos.staked);
    yourPending = toEcon(pos.pending);
  }

  const tvl = toEcon(pool.stakeVaultBalance);
  const funded = toEcon(pool.fundedAmount);
  const emitted = toEcon(pool.totalEmitted);
  const remaining = toEcon(pool.rewardVaultBalance) || Math.max(0, funded - emitted);
  const durationDays = pool.durationDays > 0 ? pool.durationDays : PROGRAM_DAYS;
  const elapsedFrac = pool.demo ? 0.35 : 0.4;
  const startTs = now - durationDays * 86_400 * elapsedFrac;
  const endTs = startTs + durationDays * 86_400;

  const daysLeft = Math.max(0.5, (endTs - now) / 86_400);
  const dailyRemaining = remaining / (daysLeft * 2);
  const currentRate = dailyRemaining / TICKS_PER_DAY;

  return {
    now,
    tvl: tvl || toBaseUnits(1),
    currentRate: currentRate || 1,
    plateauRate: (currentRate || 1) * 2,
    emissionMultiplier: 1.5,
    poolAvgMultiplier: 1.35,
    yourMultiplier: 1.6,
    yourStake,
    yourPending,
    totalClaimed: toEcon(pool.totalClaimed) || emitted,
    funded: funded || remaining + emitted,
    remaining,
    startTs,
    endTs,
    started: pool.started,
    paused: pool.paused,
    durationDays,
    symbol: pool.symbol,
  };
}
