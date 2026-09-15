"use client";

// EVM per-pool staking client: read a user's position + pending rewards from a
// StakingPool, and send stake / unstake / claim transactions via viem.
//
// Mirrors the write pattern in factoryClient.createPool (approve → write → wait)
// and reuses the shared publicClient + robinhoodChain. The wallet client is
// provided by the caller (see useEvmPool → wagmi getWalletClient).
//
// Contract reference: evm/contracts/StakingPool.sol
//   stake(uint256)      — nonReentrant, `fresh` (pool cranked within 1h)
//   unstake(uint256)    — nonReentrant, `freshOrEnded`
//   claim()             — nonReentrant, `freshOrEnded`
//   crank(uint256)      — permissionless; keeps the pool fresh / cranks to end
//   pendingRewards(addr)— view
//   positions(addr)     — public mapping getter (Position struct)

import {
  getAddress,
  type Hex,
  type WalletClient,
} from "viem";
import { robinhoodChain } from "@/lib/chains";
import {
  getPublicClient,
  ERC20_APPROVE_ABI,
  listPools,
  type PoolSummary,
} from "@/lib/factoryClient";

/** One tenure step = 1 hour. `stake`/`compound` require crank within this. */
const TENURE_STEP_SECONDS = 3_600;

/**
 * StakingPool ABI — the reads + writes this client needs. The `positions`
 * getter returns the Position struct fields as a tuple (Solidity generates a
 * getter that omits nested mappings/arrays; Position is all value types).
 */
export const STAKING_POOL_IO_ABI = [
  // ── writes ──
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "unstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "crank", stateMutability: "nonpayable", inputs: [{ name: "maxSteps", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawTreasury", stateMutability: "nonpayable", inputs: [], outputs: [] },
  // ── reads ──
  { type: "function", name: "owedToTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "minStake", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "started", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "lastUpdateTs", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "endTs", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stakeTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "unstakeTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingRewards", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "fundedAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalEmitted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalClaimed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardVaultBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "durationDays", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "startTs", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "baseRatePerPeriod", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalWeight", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "weightedDepositTs", type: "uint256" },
      { name: "depositBoundaryIndex", type: "uint256" },
      { name: "snapshotK", type: "uint256" },
      { name: "accSnapshot", type: "uint256" },
      { name: "sumAccSnapshot", type: "uint256" },
      { name: "pendingRewards", type: "uint256" },
      { name: "totalClaimed", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
  },
  // ERC20 balanceOf for the connected user's wallet balance.
] as const;

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export type EvmPoolPosition = {
  /** Staked principal, base units. */
  staked: bigint;
  /** Exact unclaimed rewards if cranked to now, base units. */
  pending: bigint;
  /** Lifetime claimed, base units. */
  totalClaimed: bigint;
  /** Wallet balance of the staking token, base units. */
  walletBalance: bigint;
  /** Weighted deposit timestamp (unix seconds); 0 if no position. */
  weightedDepositTs: bigint;
  /** Whether a position exists on-chain. */
  hasPosition: boolean;
  /** Pool min stake (base units). */
  minStake: bigint;
  /** Pool lifecycle. */
  paused: boolean;
  started: boolean;
  /** One-time reward funding at creation (base units). */
  fundedAmount: bigint;
  /** Rewards emitted so far across the whole pool (base units). */
  totalEmitted: bigint;
  /** Rewards claimed so far across the whole pool (base units). */
  poolTotalClaimed: bigint;
  /** Program start timestamp (unix seconds). */
  startTs: bigint;
  /** Program end timestamp (unix seconds). */
  endTs: bigint;
  /** Last crank timestamp (unix seconds) — the "as of" time for `pending`. */
  lastUpdateTs: bigint;
  /** Stake/unstake tax accrued and owed to the treasury (base units, pull-payment). */
  owedToTreasury: bigint;
  /** Treasury address that receives taxes (zero if the pool is tax-free). */
  treasury: string;
  /** Pool operator = the launcher/creator (identity). */
  operator: string;
  /** Per-20-min-period base emission rate at 1.0x (base units). */
  baseRatePerPeriod: bigint;
  /** Total reward-weight across the pool (stake × tenure), base units. */
  totalWeight: bigint;
};

/** Read a user's position + wallet balance + relevant pool state for a pool. */
export async function fetchEvmPosition(
  poolAddress: string,
  user: string
): Promise<EvmPoolPosition> {
  const client = getPublicClient();
  const pool = getAddress(poolAddress) as Hex;
  const account = getAddress(user) as Hex;

  const read = <T,>(functionName: string, args?: readonly unknown[]) =>
    client.readContract({
      address: pool,
      abi: STAKING_POOL_IO_ABI,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<T>;

  const [tokenAddr, minStake, paused, started, posTuple, pending, fundedAmount, totalEmitted, poolTotalClaimed, endTs, startTs, lastUpdateTs, owedToTreasury, treasury, operator, baseRatePerPeriod, totalWeight] =
    await Promise.all([
      read<string>("token"),
      read<bigint>("minStake"),
      read<boolean>("paused"),
      read<boolean>("started"),
      read<readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean]>(
        "positions",
        [account]
      ),
      read<bigint>("pendingRewards", [account]),
      read<bigint>("fundedAmount"),
      read<bigint>("totalEmitted"),
      read<bigint>("totalClaimed"),
      read<bigint>("endTs"),
      read<bigint>("startTs"),
      read<bigint>("lastUpdateTs"),
      read<bigint>("owedToTreasury"),
      read<string>("treasury"),
      read<string>("operator"),
      read<bigint>("baseRatePerPeriod"),
      read<bigint>("totalWeight"),
    ]);

  const staked = posTuple[0];
  const weightedDepositTs = posTuple[1];
  const totalClaimed = posTuple[7];
  const hasPosition = posTuple[8];

  let walletBalance = BigInt(0);
  try {
    walletBalance = (await client.readContract({
      address: getAddress(tokenAddr) as Hex,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [account],
    })) as bigint;
  } catch {
    walletBalance = BigInt(0);
  }

  return {
    staked,
    pending,
    totalClaimed,
    walletBalance,
    weightedDepositTs,
    hasPosition,
    minStake,
    paused,
    started,
    fundedAmount,
    totalEmitted,
    poolTotalClaimed,
    endTs,
    startTs,
    lastUpdateTs,
    owedToTreasury,
    treasury,
    operator,
    baseRatePerPeriod,
    totalWeight,
  };
}

/** Whether the pool needs a crank before a `fresh`-gated action (stake). */
async function needsCrank(poolAddress: string): Promise<boolean> {
  const client = getPublicClient();
  const pool = getAddress(poolAddress) as Hex;
  const [lastUpdateTs, block] = await Promise.all([
    client.readContract({
      address: pool,
      abi: STAKING_POOL_IO_ABI,
      functionName: "lastUpdateTs",
    }) as Promise<bigint>,
    client.getBlock(),
  ]);
  const now = block.timestamp;
  return now - lastUpdateTs >= BigInt(TENURE_STEP_SECONDS);
}

/** Send a crank (default max steps) and wait for it to mine. */
async function sendCrank(
  walletClient: WalletClient,
  poolAddress: string
): Promise<void> {
  const account = walletClient.account;
  if (!account) throw new Error("No account on the wallet client.");
  const pool = getAddress(poolAddress) as Hex;
  const hash = await walletClient.writeContract({
    account,
    chain: robinhoodChain,
    address: pool,
    abi: STAKING_POOL_IO_ABI,
    functionName: "crank",
    args: [BigInt(0)], // 0 = default max steps
  });
  await getPublicClient().waitForTransactionReceipt({ hash });
}

export type PoolTxResult = { txHash: string };

/**
 * Permissionlessly crank the pool up to now (default max steps). This is what
 * advances emissions across hourly boundaries so `pendingRewards` grows from 0.
 * Anyone can call it; it takes no fee beyond gas. Returns the tx hash.
 */
export async function crankPool(
  walletClient: WalletClient,
  poolAddress: string
): Promise<PoolTxResult> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet first.");
  const pool = getAddress(poolAddress) as Hex;
  const txHash = await walletClient.writeContract({
    account,
    chain: robinhoodChain,
    address: pool,
    abi: STAKING_POOL_IO_ABI,
    functionName: "crank",
    args: [BigInt(0)],
  });
  return { txHash };
}

/**
 * Send accrued stake/unstake taxes to the pool's treasury. Permissionless — the
 * destination is the fixed on-chain `treasury`, so anyone can trigger the payout
 * (it can only ever pay the treasury). Reverts if nothing is owed.
 */
export async function withdrawTreasuryOf(
  walletClient: WalletClient,
  poolAddress: string
): Promise<PoolTxResult> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet first.");
  const pool = getAddress(poolAddress) as Hex;
  const txHash = await walletClient.writeContract({
    account,
    chain: robinhoodChain,
    address: pool,
    abi: STAKING_POOL_IO_ABI,
    functionName: "withdrawTreasury",
    args: [],
  });
  return { txHash };
}

/**
 * Stake `amount` (base units) into the pool.
 *
 * Steps: ensure the pool is fresh (crank if stale, since `stake` is `fresh`-
 * gated) → approve the pool for `amount` of the token if needed → `stake`.
 */
export async function stakeToPool(
  walletClient: WalletClient,
  poolAddress: string,
  tokenAddress: string,
  amount: bigint
): Promise<PoolTxResult> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet first.");
  if (amount <= BigInt(0)) throw new Error("Amount must be greater than 0.");

  const publicClient = getPublicClient();
  const pool = getAddress(poolAddress) as Hex;
  const tokenAddr = getAddress(tokenAddress) as Hex;

  // `stake` reverts with PoolStale() if not cranked within one tenure step.
  if (await needsCrank(poolAddress)) {
    await sendCrank(walletClient, poolAddress);
  }

  // Approve the pool to pull `amount` (only if the allowance is insufficient).
  const allowance = (await publicClient.readContract({
    address: tokenAddr,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [account.address, pool],
  })) as bigint;

  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: robinhoodChain,
      address: tokenAddr,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [pool, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = await walletClient.writeContract({
    account,
    chain: robinhoodChain,
    address: pool,
    abi: STAKING_POOL_IO_ABI,
    functionName: "stake",
    args: [amount],
  });
  return { txHash };
}

/**
 * Unstake `amount` (base units). `unstake` is `freshOrEnded`; crank first if
 * the pool is stale (works whether the program is live or ended).
 */
export async function unstakeFromPool(
  walletClient: WalletClient,
  poolAddress: string,
  amount: bigint
): Promise<PoolTxResult> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet first.");
  if (amount <= BigInt(0)) throw new Error("Amount must be greater than 0.");

  const pool = getAddress(poolAddress) as Hex;
  if (await needsCrank(poolAddress)) {
    await sendCrank(walletClient, poolAddress);
  }

  const txHash = await walletClient.writeContract({
    account,
    chain: robinhoodChain,
    address: pool,
    abi: STAKING_POOL_IO_ABI,
    functionName: "unstake",
    args: [amount],
  });
  return { txHash };
}

/** Claim accrued rewards. `claim` is `freshOrEnded`; crank first if stale. */
export async function claimFromPool(
  walletClient: WalletClient,
  poolAddress: string
): Promise<PoolTxResult> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet first.");

  const pool = getAddress(poolAddress) as Hex;
  if (await needsCrank(poolAddress)) {
    await sendCrank(walletClient, poolAddress);
  }

  const txHash = await walletClient.writeContract({
    account,
    chain: robinhoodChain,
    address: pool,
    abi: STAKING_POOL_IO_ABI,
    functionName: "claim",
    args: [],
  });
  return { txHash };
}

/** Wait for a pool tx to mine; returns true on success (status "success"). */
export async function waitForPoolTx(txHash: string): Promise<boolean> {
  const receipt = await getPublicClient().waitForTransactionReceipt({
    hash: txHash as Hex,
  });
  return receipt.status === "success";
}

// ─── Marketing add-on (buy a trending slot for a pool, any time) ───

/** Fee recipient for the marketing add-on (mirrors the factory FEE_RECIPIENT). */
export const MARKETING_ADDON_RECIPIENT =
  "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13" as const;
/**
 * Marketing add-on price: 0.06 ETH — matches the Marketing tier launch fee.
 */
export const MARKETING_ADDON_WEI = BigInt("60000000000000000"); // 0.06 ETH
/** How long the pool stays on the trending list after purchase (12h). */
export const MARKETING_ADDON_DURATION_SECONDS = 12 * 60 * 60;

/**
 * Purchase the marketing add-on for a pool: send 0.06 ETH to the fee recipient.
 * On success the caller sets `meta.marketing.trendingUntil = now + 12h` for the
 * pool's token (see the button component), which drives the trending carousel.
 * Returns the payment tx hash.
 */
export async function purchaseMarketingAddon(
  walletClient: WalletClient
): Promise<PoolTxResult> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet first.");
  const txHash = await walletClient.sendTransaction({
    account,
    chain: robinhoodChain,
    to: getAddress(MARKETING_ADDON_RECIPIENT) as Hex,
    value: MARKETING_ADDON_WEI,
  });
  return { txHash };
}

// ─── Wallet-level views (Sidebar Stake list + History) ───

/** Event ABIs for reading a wallet's staking activity from pool logs. */
const POOL_EVENTS_ABI = [
  {
    type: "event",
    name: "Staked",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "newAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Unstaked",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "userAmount", type: "uint256", indexed: false },
      { name: "tax", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export type WalletPoolPosition = {
  summary: PoolSummary;
  /** Staked principal (base units). */
  staked: bigint;
  /** Unclaimed rewards (base units). */
  pending: bigint;
  /** Whether the wallet currently has staked > 0 (active) vs 0 (inactive). */
  active: boolean;
  /** Whether a position record exists on-chain (ever staked). */
  hasPosition: boolean;
};

/**
 * List the connected wallet's position in EVERY pool from the factory. Pools
 * where the wallet has a position record are returned; `active` reflects
 * whether the current staked balance is > 0 (so callers can split active vs
 * inactive). Pools the wallet never touched are omitted.
 */
export async function listWalletPositions(user: string): Promise<WalletPoolPosition[]> {
  if (!user) return [];
  const summaries = await listPools();
  const client = getPublicClient();
  const account = getAddress(user) as Hex;

  const results = await Promise.all(
    summaries.map(async (summary): Promise<WalletPoolPosition | null> => {
      try {
        const pool = getAddress(summary.pool) as Hex;
        const [posTuple, pending] = await Promise.all([
          client.readContract({
            address: pool,
            abi: STAKING_POOL_IO_ABI,
            functionName: "positions",
            args: [account],
          }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean]>,
          client.readContract({
            address: pool,
            abi: STAKING_POOL_IO_ABI,
            functionName: "pendingRewards",
            args: [account],
          }) as Promise<bigint>,
        ]);
        const staked = posTuple[0];
        const hasPosition = posTuple[8];
        if (!hasPosition && staked <= BigInt(0)) return null; // never interacted
        return {
          summary,
          staked,
          pending,
          active: staked > BigInt(0),
          hasPosition,
        };
      } catch {
        return null;
      }
    })
  );

  return results.filter((r): r is WalletPoolPosition => r !== null);
}

export type WalletHistoryEvent = {
  action: "stake" | "unstake" | "claim";
  /** Pool contract address. */
  pool: string;
  /** Token symbol (best-effort from the pool summary). */
  symbol: string;
  /** Amount moved (base units): staked / unstaked principal, or claimed rewards. */
  amount: bigint;
  /** Token decimals for formatting. */
  decimals: number;
  /** Block number the event was mined in. */
  blockNumber: bigint;
  /** Transaction hash. */
  txHash: string;
};

/**
 * Read the connected wallet's stake / unstake / claim events across all pools
 * by scanning each pool's logs filtered by the indexed `user`. Ordered
 * newest-first by block number. Best-effort: pools whose logs can't be read are
 * skipped. (For heavy history a dedicated indexer would replace this, but log
 * scans are fine at testnet volumes.)
 */
export async function fetchWalletHistory(user: string): Promise<WalletHistoryEvent[]> {
  if (!user) return [];
  const summaries = await listPools();
  const client = getPublicClient();
  const account = getAddress(user) as Hex;

  const perPool = await Promise.all(
    summaries.map(async (summary): Promise<WalletHistoryEvent[]> => {
      const pool = getAddress(summary.pool) as Hex;
      const out: WalletHistoryEvent[] = [];
      const kinds = [
        { name: "Staked", action: "stake" as const, field: "amount" },
        { name: "Unstaked", action: "unstake" as const, field: "amount" },
        { name: "Claimed", action: "claim" as const, field: "amount" },
      ];
      await Promise.all(
        kinds.map(async (k) => {
          try {
            const event = POOL_EVENTS_ABI.find((e) => e.name === k.name);
            const logs = await client.getLogs({
              address: pool,
              event: event as never,
              args: { user: account } as never,
              fromBlock: BigInt(0),
              toBlock: "latest",
            });
            for (const log of logs) {
              const a = (log as unknown as { args: Record<string, bigint> }).args;
              out.push({
                action: k.action,
                pool: summary.pool,
                symbol: summary.symbol,
                amount: a[k.field] ?? BigInt(0),
                decimals: summary.decimals,
                blockNumber: (log as unknown as { blockNumber: bigint }).blockNumber,
                txHash: (log as unknown as { transactionHash: string }).transactionHash,
              });
            }
          } catch {
            // skip this event kind on this pool
          }
        })
      );
      return out;
    })
  );

  return perPool.flat().sort((a, b) => Number(b.blockNumber - a.blockNumber));
}
