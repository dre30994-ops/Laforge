/** Local, per-wallet ledger of stakes / unstakes / claims and open positions. */

export type ActivityKind = "stake" | "unstake" | "claim";

export type ActivityItem = {
  id: string;
  address: string;
  kind: ActivityKind;
  pool: string;
  token: string;
  chainId: number;
  symbol: string;
  image?: string;
  name?: string;
  amount: string;
  at: number;
  txHash?: string;
};

export type UserStake = {
  id: string;
  address: string;
  pool: string;
  token: string;
  chainId: number;
  symbol: string;
  image?: string;
  name?: string;
  amount: string;
  active: boolean;
  updatedAt: number;
};

const ACTIVITY_KEY = "forge.userActivity.v1";
const STAKES_KEY = "forge.userStakes.v1";
export const LEDGER_EVENT = "forge:ledger";

function readJson<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson<T>(key: string, value: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(LEDGER_EVENT));
  } catch {
    // ignore quota
  }
}

function norm(addr: string): string {
  return addr.trim().toLowerCase();
}

export function listActivity(address: string | undefined | null): ActivityItem[] {
  if (!address) return [];
  const who = norm(address);
  return readJson<ActivityItem>(ACTIVITY_KEY)
    .filter((e) => norm(e.address) === who)
    .sort((a, b) => b.at - a.at);
}

export function recordActivity(item: Omit<ActivityItem, "id" | "at"> & { at?: number }): ActivityItem {
  const full: ActivityItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: item.at ?? Date.now(),
    address: norm(item.address),
    pool: item.pool.toLowerCase(),
    token: item.token.toLowerCase(),
  };
  writeJson(ACTIVITY_KEY, [full, ...readJson<ActivityItem>(ACTIVITY_KEY)].slice(0, 500));
  return full;
}

export function listUserStakes(address: string | undefined | null): UserStake[] {
  if (!address) return [];
  const who = norm(address);
  return readJson<UserStake>(STAKES_KEY)
    .filter((s) => norm(s.address) === who)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
}

export function upsertUserStake(stake: Omit<UserStake, "id" | "updatedAt"> & { id?: string; updatedAt?: number }): UserStake {
  const address = norm(stake.address);
  const pool = stake.pool.toLowerCase();
  const existing = readJson<UserStake>(STAKES_KEY);
  const idx = existing.findIndex((s) => norm(s.address) === address && s.pool.toLowerCase() === pool);
  const next: UserStake = {
    ...stake,
    id: stake.id ?? existing[idx]?.id ?? `${pool}-${address}`,
    address,
    pool,
    token: stake.token.toLowerCase(),
    updatedAt: stake.updatedAt ?? Date.now(),
  };
  if (idx >= 0) existing[idx] = next;
  else existing.unshift(next);
  writeJson(STAKES_KEY, existing);
  return next;
}
