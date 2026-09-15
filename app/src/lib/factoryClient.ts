"use client";

// EVM helper to call StakingFactory.createPool on Robinhood Chain using viem.
//
// Encoding and transaction submission go through viem (type-safe ABI encoding
// instead of hand-rolled selectors). The wallet client is provided by wagmi —
// see `useEvmFactory()` in hooks/useEvmFactory.ts, which obtains a viem
// WalletClient from the active wagmi connector.
//
// Configure the deployed factory address via NEXT_PUBLIC_STAKING_FACTORY.

import {
  createPublicClient,
  http,
  getAddress,
  isAddress as viemIsAddress,
  type Hex,
  type WalletClient,
} from "viem";
import { robinhoodChain } from "@/lib/chains";

export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_STAKING_FACTORY ?? "";

/**
 * Pricing tiers (mirror StakingFactory.Tier). The numeric values are the enum
 * indices passed on-chain.
 */
export enum PoolTier {
  Bronze = 0,
  Ecosystem = 1,
  Marketing = 2,
}

/**
 * Per-tier launch fee in wei — a DEFAULT/fallback only. The authoritative fee
 * is whatever the *deployed* factory has baked in (fees are immutable ctor
 * args), so read it on-chain via `fetchTierFee` for both the UI and the tx
 * `value`. These constants match the production deploy config and are used only
 * when an on-chain read is unavailable.
 */
export const TIER_FEE_WEI: Record<PoolTier, bigint> = {
  [PoolTier.Bronze]: BigInt("10000000000000000"), // 0.01 ETH
  [PoolTier.Ecosystem]: BigInt("30000000000000000"), // 0.03 ETH
  [PoolTier.Marketing]: BigInt("60000000000000000"), // 0.06 ETH
};

/**
 * Read the actual launch fee (wei) for a tier from the deployed factory. This
 * is the source of truth — it reflects whatever factory `NEXT_PUBLIC_STAKING_FACTORY`
 * points at (e.g. a cheap test factory). Falls back to `TIER_FEE_WEI` if the
 * read fails or the factory isn't configured.
 */
export async function fetchTierFee(tier: PoolTier): Promise<bigint> {
  if (!FACTORY_ADDRESS || !viemIsAddress(FACTORY_ADDRESS)) return TIER_FEE_WEI[tier];
  try {
    const client = getPublicClient();
    const fee = (await client.readContract({
      address: getAddress(FACTORY_ADDRESS) as Hex,
      abi: STAKING_FACTORY_ABI,
      functionName: "feeForTier",
      args: [tier],
    })) as bigint;
    return fee;
  } catch {
    return TIER_FEE_WEI[tier];
  }
}

/** Bronze duration cap in days (48h). Mirrors BRONZE_MAX_DURATION_DAYS. */
export const BRONZE_MAX_DURATION_DAYS = 2;

/** Max tax per side, basis points (10%). Mirrors the contract. */
export const MAX_TAX_BPS = 1000;

/** Selectable pool duration bounds, in days (mirrors the contract). */
export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 30;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/**
 * Minimal ABI for the one function we call. viem uses this for type-safe
 * encoding of the createPool calldata.
 *
 * Signature (StakingFactory.sol):
 *   createPool(IERC20 token, address treasury, uint256 durationDays,
 *              uint256 stakeTaxBps, uint256 unstakeTaxBps,
 *              uint256 fundingAmount, uint256 minStake) payable returns (address)
 *
 * Funding is one-time and atomic: the caller must approve this factory for
 * `fundingAmount` of the reward token first; createPool pulls it into the new
 * pool and starts it in the same transaction.
 */
export const STAKING_FACTORY_ABI = [
  {
    type: "function",
    name: "createPool",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "treasury", type: "address" },
      { name: "durationDays", type: "uint256" },
      { name: "stakeTaxBps", type: "uint256" },
      { name: "unstakeTaxBps", type: "uint256" },
      { name: "fundingAmount", type: "uint256" },
      { name: "minStake", type: "uint256" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "poolCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allPools",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "poolOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "feeForTier",
    stateMutability: "view",
    inputs: [{ name: "tier", type: "uint8" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Minimal ABI for the per-pool getters we read to render pool cards. These are
 * the public immutables/state variables on StakingPool.sol.
 */
export const STAKING_POOL_ABI = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "tier", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "durationDays", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stakeTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "unstakeTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "started", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "stakeVaultBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Minimal ERC-20 metadata ABI for reading a token's symbol. */
export const ERC20_METADATA_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** Minimal ERC-20 ABI for the funding approval step (approve factory, read allowance). */
export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type CreatePoolInputs = {
  token: string; // ERC-20 address
  treasury: string; // treasury address, or "" / zero for no treasury
  durationDays: number; // 1..30
  stakeTaxBps: number;
  unstakeTaxBps: number;
  fundingAmount: bigint; // reward tokens to fund the pool with (one-time), base units
  minStake: bigint; // base units
  tier: PoolTier; // pricing tier (sets the ETH fee + feature gating)
};

function isAddress(a: string): boolean {
  // Non-strict: accept any valid 20-byte hex address regardless of EIP-55
  // checksum casing (the contract treats addresses case-insensitively). viem's
  // default strict mode would reject a lowercased address.
  return viemIsAddress(a, { strict: false });
}

export function validateCreateInputs(i: CreatePoolInputs): string | null {
  if (!isAddress(i.token)) return "Token must be a valid 0x address.";
  if (i.treasury && !isAddress(i.treasury)) {
    return "Treasury must be a valid 0x address (or leave blank).";
  }
  if (
    !Number.isInteger(i.durationDays) ||
    i.durationDays < MIN_DURATION_DAYS ||
    i.durationDays > MAX_DURATION_DAYS
  ) {
    return `Duration must be a whole number of days between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS}.`;
  }
  if (i.tier === PoolTier.Bronze && i.durationDays > BRONZE_MAX_DURATION_DAYS) {
    return `Bronze tier is capped at ${BRONZE_MAX_DURATION_DAYS} days (48h). Choose a higher tier for longer durations.`;
  }
  if (i.stakeTaxBps < 0 || i.stakeTaxBps > MAX_TAX_BPS) {
    return `Stake tax must be 0–${MAX_TAX_BPS} bps (≤10%).`;
  }
  if (i.unstakeTaxBps < 0 || i.unstakeTaxBps > MAX_TAX_BPS) {
    return `Unstake tax must be 0–${MAX_TAX_BPS} bps (≤10%).`;
  }
  const noTreasury = !i.treasury || i.treasury === ZERO_ADDR;
  if (noTreasury && (i.stakeTaxBps > 0 || i.unstakeTaxBps > 0)) {
    return "Taxes require a treasury address. Set a treasury or use 0 taxes.";
  }
  if (i.fundingAmount <= BigInt(0)) return "Funding amount must be greater than 0.";
  if (i.minStake <= BigInt(0)) return "Min stake must be greater than 0.";
  return null;
}

export type CreatePoolResult = { txHash: string };

/** A read-only viem client on the active Robinhood Chain (for receipts, reads). */
export function getPublicClient() {
  return createPublicClient({ chain: robinhoodChain, transport: http() });
}

/**
 * Wait for a createPool transaction to be mined and return whether it
 * succeeded. Used by the UI so a new pool is only announced (and the directory
 * refreshed) once the factory state — poolCount/allPools/poolOf — actually
 * reflects it. Reverts (status "reverted") resolve to `false` rather than
 * throwing, so callers can message the user cleanly.
 */
export async function waitForPoolTx(txHash: string): Promise<boolean> {
  const client = getPublicClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex });
  return receipt.status === "success";
}

/**
 * Send the createPool transaction with the fixed 0.02 ETH launch fee using a
 * viem WalletClient (from the connected wagmi wallet). Throws a human-readable message
 * on any failure.
 *
 * The caller is responsible for ensuring the wallet is on the Robinhood Chain
 * (see `useEvmFactory`, which calls `wallet.switchChain(...)` first).
 */
export async function createPool(
  walletClient: WalletClient,
  i: CreatePoolInputs
): Promise<CreatePoolResult> {
  const err = validateCreateInputs(i);
  if (err) throw new Error(err);

  if (!FACTORY_ADDRESS || !isAddress(FACTORY_ADDRESS)) {
    throw new Error(
      "Factory address is not configured. Set NEXT_PUBLIC_STAKING_FACTORY to the deployed StakingFactory."
    );
  }

  const account = walletClient.account;
  if (!account) {
    throw new Error("No account on the wallet client. Connect an EVM wallet first.");
  }

  const treasury =
    i.treasury && isAddress(i.treasury) ? getAddress(i.treasury) : (ZERO_ADDR as Hex);

  const factory = getAddress(FACTORY_ADDRESS) as Hex;
  const tokenAddr = getAddress(i.token) as Hex;

  // Funding is pulled by the factory via transferFrom, so the factory must be
  // approved for at least `fundingAmount` first. Approve only if the current
  // allowance is insufficient (avoids a redundant tx on re-submits).
  const publicClient = getPublicClient();
  const currentAllowance = (await publicClient.readContract({
    address: tokenAddr,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [account.address, factory],
  })) as bigint;

  if (currentAllowance < i.fundingAmount) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: robinhoodChain,
      address: tokenAddr,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [factory, i.fundingAmount],
    });
    // Wait for the approval to be mined before the funded createPool.
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = await walletClient.writeContract({
    account,
    chain: robinhoodChain,
    address: factory,
    abi: STAKING_FACTORY_ABI,
    functionName: "createPool",
    args: [
      tokenAddr,
      treasury as Hex,
      BigInt(i.durationDays),
      BigInt(i.stakeTaxBps),
      BigInt(i.unstakeTaxBps),
      i.fundingAmount,
      i.minStake,
      i.tier,
    ],
    value: await fetchTierFee(i.tier),
  });

  return { txHash };
}


// ─── Pool enumeration & summaries (for the pool directory / card view) ───

export type PoolSummary = {
  /** Deployed StakingPool contract address. */
  pool: string;
  /** The staked/reward ERC-20 token address. */
  token: string;
  /** Token symbol (best-effort; empty if the token has no `symbol()`). */
  symbol: string;
  /** Pool operator/launcher address. */
  operator: string;
  /** Program length in days. */
  durationDays: number;
  /** Stake/unstake tax, basis points. */
  stakeTaxBps: number;
  unstakeTaxBps: number;
  /** Lifecycle flags. */
  started: boolean;
  paused: boolean;
  /** Total staked (base units) currently held in the pool's stake vault. */
  stakeVaultBalance: bigint;
  /** Token decimals (informational). */
  decimals: number;
};

/** A pool's live status, derived from its lifecycle flags. */
export function poolStatus(p: Pick<PoolSummary, "started" | "paused">):
  | "live"
  | "paused"
  | "pending" {
  if (p.paused) return "paused";
  return p.started ? "live" : "pending";
}

/** Read the list of deployed pool addresses from the factory. */
export async function listPoolAddresses(): Promise<string[]> {
  if (!FACTORY_ADDRESS || !isAddress(FACTORY_ADDRESS)) return [];
  const client = getPublicClient();
  const factory = getAddress(FACTORY_ADDRESS) as Hex;

  const count = (await client.readContract({
    address: factory,
    abi: STAKING_FACTORY_ABI,
    functionName: "poolCount",
  })) as bigint;

  const n = Number(count);
  if (n <= 0) return [];

  const addrs = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      client.readContract({
        address: factory,
        abi: STAKING_FACTORY_ABI,
        functionName: "allPools",
        args: [BigInt(i)],
      }) as Promise<string>
    )
  );
  return addrs;
}

/** Read the display-relevant fields for a single deployed pool. */
export async function fetchPoolSummary(poolAddress: string): Promise<PoolSummary> {
  const client = getPublicClient();
  const pool = getAddress(poolAddress) as Hex;

  const read = <T,>(functionName: string) =>
    client.readContract({
      address: pool,
      abi: STAKING_POOL_ABI,
      functionName: functionName as never,
    }) as Promise<T>;

  const [
    token,
    operator,
    treasury,
    decimals,
    durationDays,
    stakeTaxBps,
    unstakeTaxBps,
    started,
    paused,
    stakeVaultBalance,
  ] = await Promise.all([
    read<string>("token"),
    read<string>("operator"),
    read<string>("treasury"),
    read<number>("decimals"),
    read<bigint>("durationDays"),
    read<bigint>("stakeTaxBps"),
    read<bigint>("unstakeTaxBps"),
    read<boolean>("started"),
    read<boolean>("paused"),
    read<bigint>("stakeVaultBalance"),
  ]);
  void treasury; // read but not surfaced in the summary today

  // Token symbol is best-effort — a non-standard token may not implement it.
  let symbol = "";
  try {
    symbol = (await client.readContract({
      address: getAddress(token) as Hex,
      abi: ERC20_METADATA_ABI,
      functionName: "symbol",
    })) as string;
  } catch {
    symbol = "";
  }

  return {
    pool: poolAddress,
    token,
    symbol,
    operator,
    durationDays: Number(durationDays),
    stakeTaxBps: Number(stakeTaxBps),
    unstakeTaxBps: Number(unstakeTaxBps),
    started,
    paused,
    stakeVaultBalance,
    decimals: Number(decimals),
  };
}

/**
 * Enumerate all deployed pools and fetch a display summary for each. Pools that
 * fail to read (e.g. a malformed deployment) are skipped rather than failing
 * the whole list.
 */
export async function listPools(): Promise<PoolSummary[]> {
  const addrs = await listPoolAddresses();
  const results = await Promise.allSettled(addrs.map((a) => fetchPoolSummary(a)));
  return results
    .filter((r): r is PromiseFulfilledResult<PoolSummary> => r.status === "fulfilled")
    .map((r) => r.value);
}
