import { formatUnits, getAddress, type Hex } from "viem";
import { getPublicClient, STAKING_POOL_ABI } from "@/lib/factoryClient";
import { networkByChainId, type EvmNetwork } from "@/lib/evmNetworks";

const TENURE_STEP = 3600n;
const TENURE_RAMP = 72n;
const PERIODS_PER_TENURE_STEP = 3n;
const MULT_DENOM = 12n;
const HOURS_PER_EMISSION_STEP = 2n;
const EMISSION_RAMP_STEPS = 12n;

export type ClaimableSnapshot = {
  amount: bigint;
  weightedDepositTs: bigint;
  onchainPending: bigint;
  totalWeight: bigint;
  baseRatePerPeriod: bigint;
  startTs: bigint;
  endTs: bigint;
  lastUpdateTs: bigint;
  decimals: number;
  fetchedAt: number;
};

export function approximatePending(snap: ClaimableSnapshot, nowSec: number): bigint {
  if (snap.amount <= 0n) return 0n;
  const now = BigInt(Math.floor(nowSec));
  const end = snap.endTs === 0n ? now : snap.endTs;
  const t = now < end ? now : end;
  let pending = snap.onchainPending;
  if (t <= snap.lastUpdateTs || snap.totalWeight === 0n || snap.baseRatePerPeriod === 0n) {
    return pending;
  }

  const elapsedFromStart = t > snap.startTs ? t - snap.startTs : 0n;
  const hourIndex = elapsedFromStart / TENURE_STEP;
  const emissionStep =
    hourIndex / HOURS_PER_EMISSION_STEP > EMISSION_RAMP_STEPS
      ? EMISSION_RAMP_STEPS
      : hourIndex / HOURS_PER_EMISSION_STEP;
  const mult = MULT_DENOM + emissionStep;
  const hourly = (snap.baseRatePerPeriod * PERIODS_PER_TENURE_STEP * mult) / MULT_DENOM;
  const extraPool = (hourly * (t - snap.lastUpdateTs)) / TENURE_STEP;

  const held = t > snap.weightedDepositTs ? t - snap.weightedDepositTs : 0n;
  let k = held / TENURE_STEP;
  if (k > TENURE_RAMP) k = TENURE_RAMP;
  const userWeight = snap.amount * (TENURE_RAMP + k);
  const extraUser = (extraPool * userWeight) / snap.totalWeight;
  return pending + extraUser;
}

export function formatClaimable(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals || 18));
  if (!Number.isFinite(n) || n <= 0) return "0.00";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(3)}K`;
  if (n >= 1) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export async function fetchClaimableSnapshot(
  pool: string,
  user: string,
  network: EvmNetwork,
): Promise<ClaimableSnapshot | null> {
  if (!pool || !user) return null;
  const client = getPublicClient(network);
  const address = getAddress(pool) as Hex;
  const account = getAddress(user) as Hex;
  try {
    const [pos, pending, totalWeight, baseRate, startTs, endTs, lastUpdateTs, decimals] =
      await Promise.all([
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "positions",
          args: [account],
        }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean]>,
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "pendingRewards",
          args: [account],
        }) as Promise<bigint>,
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "totalWeight",
        }) as Promise<bigint>,
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "baseRatePerPeriod",
        }) as Promise<bigint>,
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "startTs",
        }) as Promise<bigint>,
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "endTs",
        }) as Promise<bigint>,
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "lastUpdateTs",
        }) as Promise<bigint>,
        client.readContract({
          address,
          abi: STAKING_POOL_ABI,
          functionName: "decimals",
        }) as Promise<number>,
      ]);
    return {
      amount: pos[0],
      weightedDepositTs: pos[1],
      onchainPending: pending,
      totalWeight,
      baseRatePerPeriod: baseRate,
      startTs,
      endTs,
      lastUpdateTs,
      decimals: Number(decimals) || 18,
      fetchedAt: Date.now() / 1000,
    };
  } catch {
    return null;
  }
}

export function networkForChain(chainId: number | undefined): EvmNetwork | undefined {
  return networkByChainId(chainId);
}
