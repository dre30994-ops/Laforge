import type { PoolSummary } from "@/lib/factoryClient";
import type { EvmNetworkKey } from "@/lib/evmNetworks";

const STORAGE_KEY = "forge.localPools.v2";

type StoredPool = Omit<PoolSummary, "stakeVaultBalance"> & {
  stakeVaultBalance: string;
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

function toSummary(p: StoredPool): PoolSummary {
  return {
    ...p,
    chainKey: (p.chainKey || "robinhood") as EvmNetworkKey,
    chainId: p.chainId || 4663,
    stakeVaultBalance: BigInt(p.stakeVaultBalance || "0"),
  };
}

export function readLocalPools(): PoolSummary[] {
  return readRaw().map(toSummary);
}

export function localPoolAddress(token: string, chainId = 0): string {
  const hex = token.toLowerCase().replace(/^0x/, "").padEnd(40, "0").slice(0, 40);
  const id = chainId.toString(16).padStart(4, "0").slice(-4);
  const flipped = (Number.parseInt(hex[0] ?? "0", 16) ^ 0xf).toString(16);
  return `0x${flipped}${hex.slice(1, 36)}${id}`;
}

export function addLocalPool(pool: PoolSummary): void {
  const token = pool.token.toLowerCase();
  const addr = pool.pool.toLowerCase();
  const chainId = pool.chainId;
  const next: StoredPool[] = [
    {
      ...pool,
      stakeVaultBalance: pool.stakeVaultBalance.toString(),
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
