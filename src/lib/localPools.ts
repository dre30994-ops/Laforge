import type { PoolSummary } from "@/lib/factoryClient";
import type { EvmNetworkKey } from "@/lib/evmNetworks";

const STORAGE_KEY = "forge.localPools.v2";

const BIGINT_FIELDS = [
  "stakeVaultBalance",
  "fundedAmount",
  "totalEmitted",
  "totalClaimed",
  "rewardVaultBalance",
  "minStake",
  "stakeVolume",
  "unstakeVolume",
] as const;

type StoredPool = Omit<
  PoolSummary,
  (typeof BIGINT_FIELDS)[number]
> & {
  stakeVaultBalance: string;
  fundedAmount?: string;
  totalEmitted?: string;
  totalClaimed?: string;
  rewardVaultBalance?: string;
  minStake?: string;
  stakeVolume?: string;
  unstakeVolume?: string;
};

function readRaw(): StoredPool[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredPool[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(list: StoredPool[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota / private mode — directory is cosmetic, fail silently.
  }
}

function asBig(v: string | undefined): bigint | undefined {
  if (v == null || v === "") return undefined;
  try {
    return BigInt(v);
  } catch {
    return undefined;
  }
}

function toSummary(p: StoredPool): PoolSummary {
  return {
    ...p,
    chainKey: (p.chainKey || "robinhood") as EvmNetworkKey,
    chainId: p.chainId || 4663,
    stakeVaultBalance: BigInt(p.stakeVaultBalance || "0"),
    fundedAmount: asBig(p.fundedAmount),
    totalEmitted: asBig(p.totalEmitted),
    totalClaimed: asBig(p.totalClaimed),
    rewardVaultBalance: asBig(p.rewardVaultBalance),
    minStake: asBig(p.minStake),
    stakeVolume: asBig(p.stakeVolume),
    unstakeVolume: asBig(p.unstakeVolume),
  };
}

/** Locally persisted pool cards (preview + optimistic append after create). */
export function readLocalPools(): PoolSummary[] {
  return readRaw().map(toSummary);
}

/**
 * Deterministic local pool address so re-creating the same token on the same
 * chain updates the existing card instead of duplicating it.
 */
export function localPoolAddress(token: string, chainId = 0): string {
  const hex = token.toLowerCase().replace(/^0x/, "").padEnd(40, "0").slice(0, 40);
  const id = chainId.toString(16).padStart(4, "0").slice(-4);
  const flipped = (Number.parseInt(hex[0] ?? "0", 16) ^ 0xf).toString(16);
  return `0x${flipped}${hex.slice(1, 36)}${id}`;
}

/** Insert or replace a local pool card, newest first. */
export function addLocalPool(pool: PoolSummary): void {
  const token = pool.token.toLowerCase();
  const addr = pool.pool.toLowerCase();
  const chainId = pool.chainId;
  const next: StoredPool[] = [
    {
      ...pool,
      stakeVaultBalance: pool.stakeVaultBalance.toString(),
      fundedAmount: pool.fundedAmount?.toString(),
      totalEmitted: pool.totalEmitted?.toString(),
      totalClaimed: pool.totalClaimed?.toString(),
      rewardVaultBalance: pool.rewardVaultBalance?.toString(),
      minStake: pool.minStake?.toString(),
      stakeVolume: pool.stakeVolume?.toString(),
      unstakeVolume: pool.unstakeVolume?.toString(),
    },
    ...readRaw().filter(
      (p) =>
        !(
          p.chainId === chainId &&
          (p.token.toLowerCase() === token || p.pool.toLowerCase() === addr)
        ),
    ),
  ];
  writeRaw(next);
}
