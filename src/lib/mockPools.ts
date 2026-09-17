import type { PoolSummary } from "@/lib/factoryClient";
import type { PoolMeta } from "@/lib/poolMeta";
import type { EvmNetworkKey } from "@/lib/evmNetworks";

/** Demo overlay so click-through dashboards work without RPC. */
const STATE_KEY = "forge.mockPoolState.v1";

const DECIMALS = 6;

function units(tokens: number): bigint {
  return BigInt(Math.round(tokens * 10 ** DECIMALS));
}

export const MOCK_BRONZE_POOL = "0xb2012e0000000000000000000000000000000b01";
export const MOCK_BRONZE_TOKEN = "0xb7012e0000000000000000000000000000000b01";
export const MOCK_ECO_POOL = "0xe2012e0000000000000000000000000000000e01";
export const MOCK_ECO_TOKEN = "0xe7012e0000000000000000000000000000000e01";
export const MOCK_MKT_POOL = "0xa2012e0000000000000000000000000000000a01";
export const MOCK_MKT_TOKEN = "0xa7012e0000000000000000000000000000000a01";

const MOCK_KEYS = new Set(
  [
    MOCK_BRONZE_POOL,
    MOCK_BRONZE_TOKEN,
    MOCK_ECO_POOL,
    MOCK_ECO_TOKEN,
    MOCK_MKT_POOL,
    MOCK_MKT_TOKEN,
  ].map((a) => a.toLowerCase()),
);

const SOCIALS = {
  website: "https://laforge-pi.vercel.app",
  twitter: "https://x.com/laforge",
  telegram: "https://t.me/laforge",
  discord: "https://discord.gg/laforge",
};

export type MockVault = {
  locked: bigint;
  left: bigint;
  emitted: bigint;
  funded: bigint;
  stakeVolume: bigint;
  unstakeVolume: bigint;
  usdPrice: number;
};

export type MockPosition = {
  staked: bigint;
  pending: bigint;
  claimed: bigint;
};

type StoredVault = {
  locked: string;
  left: string;
  emitted: string;
  funded: string;
  stakeVolume: string;
  unstakeVolume: string;
};

type StoredState = {
  vaults: Record<string, StoredVault>;
  positions: Record<string, { staked: string; pending: string; claimed: string }>;
};

function seedVault(locked: number, left: number, emitted: number, funded: number, stakeVol: number, unstakeVol: number): MockVault {
  return {
    locked: units(locked),
    left: units(left),
    emitted: units(emitted),
    funded: units(funded),
    stakeVolume: units(stakeVol),
    unstakeVolume: units(unstakeVol),
    usdPrice: 0,
  };
}

const SEED: Record<
  string,
  {
    chainKey: EvmNetworkKey;
    chainId: number;
    pool: string;
    token: string;
    symbol: string;
    nickname: string;
    durationDays: number;
    tier: 0 | 1 | 2;
    stakeTaxBps: number;
    unstakeTaxBps: number;
    vault: MockVault;
    image: string;
    banner?: string;
    socials?: PoolMeta["socials"];
    verified?: boolean;
    trending?: boolean;
  }
> = {
  [MOCK_BRONZE_POOL]: {
    chainKey: "robinhood",
    chainId: 4663,
    pool: MOCK_BRONZE_POOL,
    token: MOCK_BRONZE_TOKEN,
    symbol: "EMBR",
    nickname: "Ember Bronze Pool",
    durationDays: 2,
    tier: 0,
    stakeTaxBps: 0,
    unstakeTaxBps: 0,
    vault: { ...seedVault(125_000, 80_000, 12_400, 92_400, 210_000, 85_000), usdPrice: 0.42 },
    image: "/icon2_nobg.png",
  },
  [MOCK_ECO_POOL]: {
    chainKey: "ethereum",
    chainId: 1,
    pool: MOCK_ECO_POOL,
    token: MOCK_ECO_TOKEN,
    symbol: "ANVL",
    nickname: "Anvil Ecosystem",
    durationDays: 14,
    tier: 1,
    stakeTaxBps: 100,
    unstakeTaxBps: 200,
    vault: { ...seedVault(2_500_000, 8_200_000, 1_800_000, 10_000_000, 4_200_000, 1_700_000), usdPrice: 1.18 },
    image: "/icon-192.png",
    banner: "/background1.webp",
    socials: SOCIALS,
  },
  [MOCK_MKT_POOL]: {
    chainKey: "robinhood",
    chainId: 4663,
    pool: MOCK_MKT_POOL,
    token: MOCK_MKT_TOKEN,
    symbol: "GILD",
    nickname: "Gilded Marketing",
    durationDays: 30,
    tier: 2,
    stakeTaxBps: 50,
    unstakeTaxBps: 150,
    vault: { ...seedVault(8_750_000, 22_000_000, 3_250_000, 25_250_000, 14_500_000, 5_750_000), usdPrice: 2.05 },
    image: "/icon-512.png",
    banner: "/background2.webp",
    socials: SOCIALS,
    verified: true,
    trending: true,
  },
};

function stateKey(chainId: number, pool: string): string {
  return `${chainId}:${pool.toLowerCase()}`;
}

function posKey(chainId: number, pool: string, user: string): string {
  return `${stateKey(chainId, pool)}:${user.toLowerCase()}`;
}

function readState(): StoredState {
  if (typeof window === "undefined") return { vaults: {}, positions: {} };
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return { vaults: {}, positions: {} };
    const parsed = JSON.parse(raw) as StoredState;
    return {
      vaults: parsed.vaults && typeof parsed.vaults === "object" ? parsed.vaults : {},
      positions: parsed.positions && typeof parsed.positions === "object" ? parsed.positions : {},
    };
  } catch {
    return { vaults: {}, positions: {} };
  }
}

function writeState(state: StoredState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota
  }
}

function vaultFor(seed: (typeof SEED)[string], chainId: number, pool: string): MockVault {
  const stored = readState().vaults[stateKey(chainId, pool)];
  if (!stored) return { ...seed.vault };
  return {
    locked: BigInt(stored.locked || "0"),
    left: BigInt(stored.left || "0"),
    emitted: BigInt(stored.emitted || "0"),
    funded: BigInt(stored.funded || seed.vault.funded.toString()),
    stakeVolume: BigInt(stored.stakeVolume || "0"),
    unstakeVolume: BigInt(stored.unstakeVolume || "0"),
    usdPrice: seed.vault.usdPrice,
  };
}

export function isMockPoolAddress(address?: string | null): boolean {
  if (!address) return false;
  return MOCK_KEYS.has(address.trim().toLowerCase());
}

export function trendingUntilNow(): number {
  return Math.floor(Date.now() / 1000) + 12 * 60 * 60;
}

export function mockMetaMap(): Record<string, PoolMeta> {
  const map: Record<string, PoolMeta> = {};
  for (const seed of Object.values(SEED)) {
    const meta: PoolMeta = {
      nickname: seed.nickname,
      image: seed.image,
      tier: seed.tier,
    };
    if (seed.tier >= 1) {
      if (seed.banner) meta.banner = seed.banner;
      if (seed.socials) meta.socials = seed.socials;
    }
    if (seed.tier === 2) {
      meta.marketing = {
        verifiedBadge: true,
        trendingUntil: trendingUntilNow(),
      };
    }
    map[seed.token.toLowerCase()] = meta;
    map[seed.pool.toLowerCase()] = meta;
  }
  return map;
}

export function getMockMeta(address: string): PoolMeta | null {
  return mockMetaMap()[address.trim().toLowerCase()] ?? null;
}

function toSummary(seed: (typeof SEED)[string], vault: MockVault): PoolSummary {
  const trending = seed.trending ? trendingUntilNow() : 0;
  return {
    pool: seed.pool,
    token: seed.token,
    symbol: seed.symbol,
    operator: "0x000000000000000000000000000000000000c001",
    durationDays: seed.durationDays,
    stakeTaxBps: seed.stakeTaxBps,
    unstakeTaxBps: seed.unstakeTaxBps,
    started: true,
    paused: false,
    stakeVaultBalance: vault.locked,
    decimals: DECIMALS,
    chainKey: seed.chainKey,
    chainId: seed.chainId,
    tierOnChain: seed.tier,
    marketingUnlocked: seed.tier === 2,
    trendingUntil: trending,
    fundedAmount: vault.funded,
    totalEmitted: vault.emitted,
    totalClaimed: vault.emitted,
    rewardVaultBalance: vault.left,
    usdPrice: vault.usdPrice,
    stakeVolume: vault.stakeVolume,
    unstakeVolume: vault.unstakeVolume,
    startTs: Math.floor(Date.now() / 1000) - Math.floor(seed.durationDays * 86_400 * 0.4),
    demo: true,
  };
}

export function getMockPools(): PoolSummary[] {
  return Object.values(SEED).map((seed) => toSummary(seed, vaultFor(seed, seed.chainId, seed.pool)));
}

export function getMockPool(address: string, chainId?: number): PoolSummary | null {
  const needle = address.trim().toLowerCase();
  const seed = Object.values(SEED).find(
    (s) =>
      (s.pool.toLowerCase() === needle || s.token.toLowerCase() === needle) &&
      (chainId == null || s.chainId === chainId),
  );
  if (!seed) return null;
  return toSummary(seed, vaultFor(seed, seed.chainId, seed.pool));
}

export const MOCK_DEMO_USER = "0xdemo000000000000000000000000000000000001";

export function getMockPosition(chainId: number, pool: string, user = MOCK_DEMO_USER): MockPosition {
  const stored = readState().positions[posKey(chainId, pool, user)];
  if (!stored) {
    const seed = Object.values(SEED).find((s) => s.pool.toLowerCase() === pool.toLowerCase());
    if (!seed) return { staked: 0n, pending: 0n, claimed: 0n };
    // Seed a live-looking demo position so claim/unstake are clickable.
    const starter = seed.tier === 0 ? 4_800 : seed.tier === 1 ? 85_000 : 240_000;
    const pending = seed.tier === 0 ? 96 : seed.tier === 1 ? 1_840 : 6_250;
    return { staked: units(starter), pending: units(pending), claimed: units(pending * 3) };
  }
  return {
    staked: BigInt(stored.staked || "0"),
    pending: BigInt(stored.pending || "0"),
    claimed: BigInt(stored.claimed || "0"),
  };
}

function persistVault(chainId: number, pool: string, vault: MockVault, positions: StoredState["positions"]): void {
  const state = readState();
  state.vaults[stateKey(chainId, pool)] = {
    locked: vault.locked.toString(),
    left: vault.left.toString(),
    emitted: vault.emitted.toString(),
    funded: vault.funded.toString(),
    stakeVolume: vault.stakeVolume.toString(),
    unstakeVolume: vault.unstakeVolume.toString(),
  };
  state.positions = positions;
  writeState(state);
}

export function applyMockStake(chainId: number, pool: string, amount: bigint, user = MOCK_DEMO_USER): MockPosition {
  const seed = Object.values(SEED).find((s) => s.pool.toLowerCase() === pool.toLowerCase());
  if (!seed) throw new Error("Unknown demo pool.");
  if (amount <= 0n) throw new Error("Enter an amount to stake.");
  const vault = vaultFor(seed, chainId, pool);
  const state = readState();
  const pos = getMockPosition(chainId, pool, user);
  const tax = (amount * BigInt(seed.stakeTaxBps)) / 10_000n;
  const net = amount - tax;
  vault.locked += net;
  vault.stakeVolume += amount;
  pos.staked += net;
  pos.pending += net / 400n; // small simulated accrual
  state.positions[posKey(chainId, pool, user)] = {
    staked: pos.staked.toString(),
    pending: pos.pending.toString(),
    claimed: pos.claimed.toString(),
  };
  persistVault(chainId, pool, vault, state.positions);
  return pos;
}

export function applyMockUnstake(chainId: number, pool: string, amount: bigint, user = MOCK_DEMO_USER): MockPosition {
  const seed = Object.values(SEED).find((s) => s.pool.toLowerCase() === pool.toLowerCase());
  if (!seed) throw new Error("Unknown demo pool.");
  if (amount <= 0n) throw new Error("Enter an amount to unstake.");
  const vault = vaultFor(seed, chainId, pool);
  const state = readState();
  const pos = getMockPosition(chainId, pool, user);
  if (amount > pos.staked) throw new Error("Amount exceeds the demo position.");
  vault.locked = vault.locked > amount ? vault.locked - amount : 0n;
  vault.unstakeVolume += amount;
  pos.staked -= amount;
  state.positions[posKey(chainId, pool, user)] = {
    staked: pos.staked.toString(),
    pending: pos.pending.toString(),
    claimed: pos.claimed.toString(),
  };
  persistVault(chainId, pool, vault, state.positions);
  return pos;
}

export function applyMockClaim(chainId: number, pool: string, user = MOCK_DEMO_USER): MockPosition {
  const seed = Object.values(SEED).find((s) => s.pool.toLowerCase() === pool.toLowerCase());
  if (!seed) throw new Error("Unknown demo pool.");
  const vault = vaultFor(seed, chainId, pool);
  const state = readState();
  const pos = getMockPosition(chainId, pool, user);
  const payout = pos.pending;
  if (payout <= 0n) return pos;
  pos.claimed += payout;
  pos.pending = 0n;
  vault.emitted += payout;
  vault.left = vault.left > payout ? vault.left - payout : 0n;
  state.positions[posKey(chainId, pool, user)] = {
    staked: pos.staked.toString(),
    pending: pos.pending.toString(),
    claimed: pos.claimed.toString(),
  };
  persistVault(chainId, pool, vault, state.positions);
  return pos;
}
