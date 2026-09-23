import {
  createPublicClient,
  http,
  getAddress,
  isAddress as viemIsAddress,
  type Hex,
  type WalletClient,
} from "viem";
import { addLocalPool, localPoolAddress, readLocalPools } from "@/lib/localPools";
import {
  EVM_NETWORKS,
  EVM_NETWORK_ORDER,
  type EvmNetwork,
  type EvmNetworkKey,
} from "@/lib/evmNetworks";
import { fetchMarketingStatus, type MarketingStatus } from "@/lib/marketingDesk";
import { getMockPool, isMockPoolAddress } from "@/lib/mockPools";

/** @deprecated use network.factory — kept for existing imports. */
export const FACTORY_ADDRESS = EVM_NETWORKS.robinhood.factory;

/**
 * Pricing tiers (mirror StakingFactory.Tier). The numeric values are the enum
 * indices passed on-chain.
 */
export enum PoolTier {
  Bronze = 0,
  Ecosystem = 1,
  Marketing = 2,
}

/** Per-tier ETH-denominated defaults (Robinhood / Ethereum / Base). */
export const TIER_FEE_WEI: Record<PoolTier, bigint> = {
  [PoolTier.Bronze]: EVM_NETWORKS.robinhood.fees.bronze,
  [PoolTier.Ecosystem]: EVM_NETWORKS.robinhood.fees.ecosystem,
  [PoolTier.Marketing]: EVM_NETWORKS.robinhood.fees.marketing,
};

export function tierFeeWei(network: EvmNetwork, tier: PoolTier): bigint {
  if (tier === PoolTier.Bronze) return network.fees.bronze;
  if (tier === PoolTier.Ecosystem) return network.fees.ecosystem;
  return network.fees.marketing;
}

/** Bronze duration cap in days (48h). Mirrors BRONZE_MAX_DURATION_DAYS. */
export const BRONZE_MAX_DURATION_DAYS = 2;

/** Max tax per side, basis points (10%). Mirrors the contract. */
export const MAX_TAX_BPS = 1000;

/** Selectable pool duration bounds, in days (mirrors the contract). */
export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 30;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const RPC_TIMEOUT_MS = 12_000;

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
    name: "createPoolReferred",
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
      { name: "referrer", type: "address" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "quoteLaunch",
    stateMutability: "view",
    inputs: [
      { name: "launcher", type: "address" },
      { name: "tier", type: "uint8" },
      { name: "referrer", type: "address" },
    ],
    outputs: [
      { name: "baseFee", type: "uint256" },
      { name: "discountBps", type: "uint256" },
      { name: "userPays", type: "uint256" },
      { name: "referrerUsed", type: "address" },
      { name: "commissionBps", type: "uint256" },
      { name: "commission", type: "uint256" },
      { name: "indirectUsed", type: "address" },
      { name: "indirectAmount", type: "uint256" },
      { name: "hop3Used", type: "address" },
      { name: "hop3Amount", type: "uint256" },
      { name: "protocolReceives", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "lifetimeEarned",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "directsOf",
    stateMutability: "view",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "earnedFrom",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "referralCommissionBps",
    stateMutability: "view",
    inputs: [{ name: "referredCount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "referralCount",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owedToReferrer",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "referredBy",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "bindReferrer",
    stateMutability: "nonpayable",
    inputs: [{ name: "parent", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimReferral",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
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
] as const;

export const STAKING_POOL_ABI = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "authority", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "tier", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "durationDays", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stakeTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "unstakeTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "started", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "stakeVaultBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingRewards", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalStaked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalWeight", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "baseRatePerPeriod", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "startTs", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "endTs", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastUpdateTs", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardVaultBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "fundedAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalEmitted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalClaimed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minStake", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "unstake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "owedToTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdrawTreasury", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "weightedDepositTs", type: "uint256" },
      { name: "depositBoundaryIndex", type: "uint256" },
      { name: "snapshotK", type: "uint256" },
      { name: "accSnapshot", type: "uint256" },
      { name: "sumAccSnapshot", type: "uint256" },
      { name: "pendingRewards", type: "uint256" },
      { name: "totalClaimed", type: "uint256" },
      { name: "maturingIndex", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
  },
  { type: "function", name: "holderRewardTokenCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "holderRewardTokens", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "pendingHolderReward",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "syncHolderReward",
    stateMutability: "nonpayable",
    inputs: [{ name: "rewardToken", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimHolderReward",
    stateMutability: "nonpayable",
    inputs: [{ name: "rewardToken", type: "address" }],
    outputs: [],
  },
] as const;

export const ERC20_METADATA_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

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
  token: string;
  treasury: string;
  durationDays: number;
  stakeTaxBps: number;
  unstakeTaxBps: number;
  fundingAmount: bigint;
  minStake: bigint;
  tier: PoolTier;
  referrer?: string;
};

export type LaunchQuote = {
  baseFee: bigint;
  discountBps: number;
  userPays: bigint;
  referrerUsed: string;
  commissionBps: number;
  commission: bigint;
  indirectUsed: string;
  indirectAmount: bigint;
  hop3Used: string;
  hop3Amount: bigint;
  protocolReceives: bigint;
  v2: boolean;
};

function isAddress(a: string): boolean {
  return viemIsAddress(a);
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

export function formatNative(wei: bigint, symbol: string): string {
  const whole = wei / BigInt("1000000000000000000");
  const frac = wei % BigInt("1000000000000000000");
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  const amt = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return `${amt} ${symbol}`;
}

export function getPublicClient(network: EvmNetwork) {
  const rpc = network.chain.rpcUrls.default.http[0];
  return createPublicClient({
    chain: network.chain,
    transport: http(rpc, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }),
  });
}

export async function waitForPoolTx(txHash: string, network: EvmNetwork): Promise<boolean> {
  const client = getPublicClient(network);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex });
  return receipt.status === "success";
}

/** Look up the live pool for a token on this factory, or null if none. */
export async function resolvePoolAddress(
  token: string,
  network: EvmNetwork,
): Promise<string | null> {
  if (!network.factory || !isAddress(network.factory) || !isAddress(token)) return null;
  const client = getPublicClient(network);
  const addr = (await client.readContract({
    address: getAddress(network.factory) as Hex,
    abi: STAKING_FACTORY_ABI,
    functionName: "poolOf",
    args: [getAddress(token) as Hex],
  })) as string;
  if (!addr || addr.toLowerCase() === ZERO_ADDR) return null;
  return addr;
}

export async function quoteLaunch(
  network: EvmNetwork,
  launcher: string,
  tier: PoolTier,
  referrer?: string | null,
): Promise<LaunchQuote> {
  const base = tierFeeWei(network, tier);
  const fallback: LaunchQuote = {
    baseFee: base,
    discountBps: 0,
    userPays: base,
    referrerUsed: ZERO_ADDR,
    commissionBps: 0,
    commission: 0n,
    indirectUsed: ZERO_ADDR,
    indirectAmount: 0n,
    hop3Used: ZERO_ADDR,
    hop3Amount: 0n,
    protocolReceives: base,
    v2: false,
  };
  if (!network.factory || !isAddress(network.factory) || !isAddress(launcher)) return fallback;
  const ref =
    referrer && isAddress(referrer) && getAddress(referrer) !== getAddress(launcher)
      ? getAddress(referrer)
      : ZERO_ADDR;
  try {
    const client = getPublicClient(network);
    const result = (await client.readContract({
      address: getAddress(network.factory) as Hex,
      abi: STAKING_FACTORY_ABI,
      functionName: "quoteLaunch",
      args: [getAddress(launcher) as Hex, tier, ref as Hex],
    })) as readonly [
      bigint,
      bigint,
      bigint,
      string,
      bigint,
      bigint,
      string,
      bigint,
      string,
      bigint,
      bigint,
    ];
    return {
      baseFee: result[0],
      discountBps: Number(result[1]),
      userPays: result[2],
      referrerUsed: result[3],
      commissionBps: Number(result[4]),
      commission: result[5],
      indirectUsed: result[6],
      indirectAmount: result[7],
      hop3Used: result[8],
      hop3Amount: result[9],
      protocolReceives: result[10],
      v2: true,
    };
  } catch {
    return fallback;
  }
}

export const REF_MIN_BPS = 1_000;
export const REF_STEP_BPS = 100;
export const REF_STEP_CAP = 20;

export function directSplitBps(referredCount: bigint | number): number {
  const n = Number(referredCount);
  const extra = n >= REF_STEP_CAP ? REF_STEP_CAP : Math.max(0, n);
  return REF_MIN_BPS + extra * REF_STEP_BPS;
}

export type ReferralRow = {
  address: string;
  earned: bigint;
};

export type ReferralDesk = {
  count: bigint;
  owed: bigint;
  lifetime: bigint;
  parent: string;
  splitBps: number;
  rows: ReferralRow[];
  v2: boolean;
};

export async function readReferralDesk(
  network: EvmNetwork,
  account: string,
): Promise<ReferralDesk | null> {
  if (!network.factory || !isAddress(network.factory) || !isAddress(account)) return null;
  const client = getPublicClient(network);
  const factory = getAddress(network.factory) as Hex;
  const who = getAddress(account) as Hex;
  try {
    const [count, owed, lifetime, parent, directs] = await Promise.all([
      client.readContract({
        address: factory,
        abi: STAKING_FACTORY_ABI,
        functionName: "referralCount",
        args: [who],
      }) as Promise<bigint>,
      client.readContract({
        address: factory,
        abi: STAKING_FACTORY_ABI,
        functionName: "owedToReferrer",
        args: [who],
      }) as Promise<bigint>,
      client.readContract({
        address: factory,
        abi: STAKING_FACTORY_ABI,
        functionName: "lifetimeEarned",
        args: [who],
      }) as Promise<bigint>,
      client.readContract({
        address: factory,
        abi: STAKING_FACTORY_ABI,
        functionName: "referredBy",
        args: [who],
      }) as Promise<string>,
      client.readContract({
        address: factory,
        abi: STAKING_FACTORY_ABI,
        functionName: "directsOf",
        args: [who],
      }) as Promise<readonly string[]>,
    ]);
    const rows: ReferralRow[] = [];
    if (directs?.length) {
      const earned = await Promise.all(
        directs.map(
          (addr) =>
            client.readContract({
              address: factory,
              abi: STAKING_FACTORY_ABI,
              functionName: "earnedFrom",
              args: [who, getAddress(addr) as Hex],
            }) as Promise<bigint>,
        ),
      );
      directs.forEach((addr, i) => {
        rows.push({ address: getAddress(addr), earned: earned[i] ?? 0n });
      });
      rows.sort((a, b) => (a.earned === b.earned ? 0 : a.earned > b.earned ? -1 : 1));
    }
    return {
      count,
      owed,
      lifetime,
      parent,
      splitBps: directSplitBps(count),
      rows,
      v2: true,
    };
  } catch {
    try {
      const [count, owed, parent] = await Promise.all([
        client.readContract({
          address: factory,
          abi: STAKING_FACTORY_ABI,
          functionName: "referralCount",
          args: [who],
        }) as Promise<bigint>,
        client.readContract({
          address: factory,
          abi: STAKING_FACTORY_ABI,
          functionName: "owedToReferrer",
          args: [who],
        }) as Promise<bigint>,
        client.readContract({
          address: factory,
          abi: STAKING_FACTORY_ABI,
          functionName: "referredBy",
          args: [who],
        }) as Promise<string>,
      ]);
      return {
        count,
        owed,
        lifetime: owed,
        parent,
        splitBps: directSplitBps(count),
        rows: [],
        v2: false,
      };
    } catch {
      return null;
    }
  }
}

export async function createPool(
  walletClient: WalletClient,
  i: CreatePoolInputs,
  network: EvmNetwork,
): Promise<CreatePoolResult> {
  const err = validateCreateInputs(i);
  if (err) throw new Error(err);

  if (!network.factory || !isAddress(network.factory)) {
    throw new Error(
      `Factory address is not configured for ${network.label}. Set NEXT_PUBLIC_STAKING_FACTORY_${network.key.toUpperCase()}.`,
    );
  }

  const account = walletClient.account;
  if (!account) {
    throw new Error("No account on the wallet client. Connect an EVM wallet first.");
  }

  const walletChainId = walletClient.chain?.id ?? (await walletClient.getChainId());
  if (walletChainId !== network.chain.id) {
    throw new Error(
      `Wallet is on chain ${walletChainId}, but this pool is created on ${network.label} (${network.chain.id}). Switch network first.`,
    );
  }

  const treasury =
    i.treasury && isAddress(i.treasury) ? getAddress(i.treasury) : (ZERO_ADDR as Hex);

  const factory = getAddress(network.factory) as Hex;
  const tokenAddr = getAddress(i.token) as Hex;
  const publicClient = getPublicClient(network);
  const referrer =
    i.referrer && isAddress(i.referrer) && getAddress(i.referrer) !== getAddress(account.address)
      ? (getAddress(i.referrer) as Hex)
      : (ZERO_ADDR as Hex);
  const quote = await quoteLaunch(network, account.address, i.tier, referrer);
  const value = quote.userPays;

  const currentAllowance = (await publicClient.readContract({
    address: tokenAddr,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [account.address, factory],
  })) as bigint;

  if (currentAllowance < i.fundingAmount) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: network.chain,
      address: tokenAddr,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [factory, i.fundingAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = quote.v2
    ? await walletClient.writeContract({
        account,
        chain: network.chain,
        address: factory,
        abi: STAKING_FACTORY_ABI,
        functionName: "createPoolReferred",
        args: [
          tokenAddr,
          treasury as Hex,
          BigInt(i.durationDays),
          BigInt(i.stakeTaxBps),
          BigInt(i.unstakeTaxBps),
          i.fundingAmount,
          i.minStake,
          i.tier,
          referrer,
        ],
        value,
      })
    : await walletClient.writeContract({
        account,
        chain: network.chain,
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
        value,
      });

  return { txHash };
}

export type PoolSummary = {
  pool: string;
  token: string;
  symbol: string;
  operator: string;
  authority?: string;
  durationDays: number;
  stakeTaxBps: number;
  unstakeTaxBps: number;
  started: boolean;
  paused: boolean;
  stakeVaultBalance: bigint;
  decimals: number;
  chainKey: EvmNetworkKey;
  chainId: number;
  tierOnChain?: number;
  marketingUnlocked?: boolean;
  trendingUntil?: number;
  fundedAmount?: bigint;
  totalEmitted?: bigint;
  totalClaimed?: bigint;
  rewardVaultBalance?: bigint;
  minStake?: bigint;
  usdPrice?: number;
  stakeVolume?: bigint;
  unstakeVolume?: bigint;
  startTs?: number;
  endTs?: number;
  demo?: boolean;
  treasury?: string;
  owedToTreasury?: bigint;
};

/** UI tier: desk payment or a Marketing launch both count as Marketing (2). */
export function displayTier(
  p: Pick<PoolSummary, "tierOnChain" | "marketingUnlocked">,
  meta?: { tier?: number } | null,
): number {
  if (p.marketingUnlocked || p.tierOnChain === 2 || meta?.tier === 2) return 2;
  if (meta?.tier === 1 || p.tierOnChain === 1) return 1;
  return meta?.tier ?? p.tierOnChain ?? 0;
}

export type PoolLifecycle = "live" | "paused" | "pending" | "ended";

export function poolEndTs(
  p: Pick<PoolSummary, "endTs" | "startTs" | "durationDays">,
): number {
  if (p.endTs && p.endTs > 0) return p.endTs;
  if (p.startTs && p.startTs > 0 && p.durationDays > 0) {
    return p.startTs + p.durationDays * 86_400;
  }
  return 0;
}

export function poolFullyEmitted(
  p: Pick<PoolSummary, "fundedAmount" | "totalEmitted">,
): boolean {
  const funded = p.fundedAmount ?? 0n;
  const emitted = p.totalEmitted ?? 0n;
  return funded > 0n && emitted >= funded;
}

export function poolStatus(
  p: Pick<
    PoolSummary,
    "started" | "paused" | "endTs" | "startTs" | "durationDays" | "fundedAmount" | "totalEmitted"
  >,
  nowSec = Date.now() / 1000,
): PoolLifecycle {
  if (!p.started) return "pending";
  const end = poolEndTs(p);
  if ((end > 0 && nowSec >= end) || poolFullyEmitted(p)) return "ended";
  if (p.paused) return "paused";
  return "live";
}

export async function listPoolAddresses(network: EvmNetwork): Promise<string[]> {
  if (!network.factory || !isAddress(network.factory)) return [];
  const client = getPublicClient(network);
  const factory = getAddress(network.factory) as Hex;

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
      }) as Promise<string>,
    ),
  );
  return addrs;
}

export async function fetchPoolSummary(
  poolAddress: string,
  network: EvmNetwork,
): Promise<PoolSummary> {
  const mock = getMockPool(poolAddress, network.chain.id) ?? getMockPool(poolAddress);
  if (mock) return mock;

  const client = getPublicClient(network);
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
    authority,
    treasury,
    decimals,
    durationDays,
    stakeTaxBps,
    unstakeTaxBps,
    started,
    paused,
    stakeVaultBalance,
    owedToTreasury,
  ] = await Promise.all([
    read<string>("token"),
    read<string>("operator"),
    read<string>("authority").catch(() => ""),
    read<string>("treasury"),
    read<number>("decimals"),
    read<bigint>("durationDays"),
    read<bigint>("stakeTaxBps"),
    read<bigint>("unstakeTaxBps"),
    read<boolean>("started"),
    read<boolean>("paused"),
    read<bigint>("stakeVaultBalance"),
    read<bigint>("owedToTreasury").catch(() => 0n),
  ]);

  const [fundedAmount, totalEmitted, totalClaimed, rewardVaultBalance, minStake, totalStaked, startTs, endTs] =
    await Promise.all([
      read<bigint>("fundedAmount").catch(() => 0n),
      read<bigint>("totalEmitted").catch(() => 0n),
      read<bigint>("totalClaimed").catch(() => 0n),
      read<bigint>("rewardVaultBalance").catch(() => 0n),
      read<bigint>("minStake").catch(() => 0n),
      read<bigint>("totalStaked").catch(() => 0n),
      read<bigint>("startTs").catch(() => 0n),
      read<bigint>("endTs").catch(() => 0n),
    ]);

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

  let tierOnChain: number | undefined;
  try {
    tierOnChain = Number(await read<number>("tier"));
  } catch {
    tierOnChain = undefined;
  }

  let marketing: MarketingStatus = { unlocked: false, trending: false, trendingUntil: 0 };
  try {
    marketing = await fetchMarketingStatus(poolAddress, network);
  } catch {
    marketing = { unlocked: false, trending: false, trendingUntil: 0 };
  }

  const locked = stakeVaultBalance > 0n ? stakeVaultBalance : totalStaked;

  return {
    pool: poolAddress,
    token,
    symbol,
    operator,
    authority: authority || undefined,
    durationDays: Number(durationDays),
    stakeTaxBps: Number(stakeTaxBps),
    unstakeTaxBps: Number(unstakeTaxBps),
    started,
    paused,
    stakeVaultBalance: locked,
    decimals: Number(decimals),
    chainKey: network.key,
    chainId: network.chain.id,
    tierOnChain,
    marketingUnlocked: marketing.unlocked || tierOnChain === 2,
    trendingUntil: marketing.trendingUntil,
    fundedAmount,
    totalEmitted,
    totalClaimed,
    rewardVaultBalance,
    minStake,
    startTs: Number(startTs) || undefined,
    endTs: Number(endTs) || undefined,
    treasury,
    owedToTreasury,
  };
}

export async function listPoolsForNetwork(network: EvmNetwork): Promise<PoolSummary[]> {
  try {
    const addrs = await listPoolAddresses(network);
    const results = await Promise.allSettled(addrs.map((a) => fetchPoolSummary(a, network)));
    return results
      .filter((r): r is PromiseFulfilledResult<PoolSummary> => r.status === "fulfilled")
      .map((r) => r.value);
  } catch {
    return [];
  }
}

/** Enumerate pools on every launch chain in parallel. */
export async function listPools(): Promise<PoolSummary[]> {
  const perChain = await Promise.all(
    EVM_NETWORK_ORDER.map((key) => listPoolsForNetwork(EVM_NETWORKS[key])),
  );
  const onchain = perChain.flat();

  const seen = new Set(onchain.map((p) => `${p.chainId}:${p.pool.toLowerCase()}`));
  const local = readLocalPools().filter((p) => {
    const k = `${p.chainId}:${p.pool.toLowerCase()}`;
    if (seen.has(k) || isMockPoolAddress(p.pool) || p.demo) return false;
    seen.add(k);
    return true;
  });
  return [...local, ...onchain].filter((p) => !p.demo && !isMockPoolAddress(p.pool));
}

export function recordCreatedPool(
  inputs: CreatePoolInputs,
  decimals: number,
  symbol = "",
  network: EvmNetwork,
  poolAddress?: string,
): PoolSummary {
  const summary: PoolSummary = {
    pool: poolAddress || localPoolAddress(inputs.token, network.chain.id),
    token: inputs.token,
    symbol,
    operator: "0x0000000000000000000000000000000000000000",
    durationDays: inputs.durationDays,
    stakeTaxBps: inputs.stakeTaxBps,
    unstakeTaxBps: inputs.unstakeTaxBps,
    started: true,
    paused: false,
    stakeVaultBalance: BigInt(0),
    decimals,
    chainKey: network.key,
    chainId: network.chain.id,
    tierOnChain: inputs.tier,
    marketingUnlocked: inputs.tier === PoolTier.Marketing,
    fundedAmount: inputs.fundingAmount,
    rewardVaultBalance: inputs.fundingAmount,
    totalEmitted: 0n,
    minStake: inputs.minStake,
    startTs: Math.floor(Date.now() / 1000),
    endTs: Math.floor(Date.now() / 1000) + inputs.durationDays * 86_400,
  };
  addLocalPool(summary);
  return summary;
}

export async function readTokenBalance(
  token: string,
  owner: string,
  network: EvmNetwork,
): Promise<bigint> {
  const client = getPublicClient(network);
  return (await client.readContract({
    address: getAddress(token) as Hex,
    abi: ERC20_METADATA_ABI,
    functionName: "balanceOf",
    args: [getAddress(owner) as Hex],
  })) as bigint;
}

export async function stakeIntoPool(
  walletClient: WalletClient,
  pool: PoolSummary,
  network: EvmNetwork,
  amount: bigint,
): Promise<string> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet to stake.");
  const publicClient = getPublicClient(network);
  const poolAddr = getAddress(pool.pool) as Hex;
  const tokenAddr = getAddress(pool.token) as Hex;

  const allowance = (await publicClient.readContract({
    address: tokenAddr,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [account.address, poolAddr],
  })) as bigint;

  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: network.chain,
      address: tokenAddr,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [poolAddr, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = await walletClient.writeContract({
    account,
    chain: network.chain,
    address: poolAddr,
    abi: STAKING_POOL_ABI,
    functionName: "stake",
    args: [amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  await sweepPoolTreasury(walletClient, pool, network);
  return txHash;
}

export async function unstakeFromPool(
  walletClient: WalletClient,
  pool: PoolSummary,
  network: EvmNetwork,
  amount: bigint,
): Promise<string> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet to unstake.");
  const publicClient = getPublicClient(network);
  const txHash = await walletClient.writeContract({
    account,
    chain: network.chain,
    address: getAddress(pool.pool) as Hex,
    abi: STAKING_POOL_ABI,
    functionName: "unstake",
    args: [amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  await sweepPoolTreasury(walletClient, pool, network);
  return txHash;
}

export async function claimFromPool(
  walletClient: WalletClient,
  pool: PoolSummary,
  network: EvmNetwork,
): Promise<string> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet to claim.");
  const publicClient = getPublicClient(network);
  const txHash = await walletClient.writeContract({
    account,
    chain: network.chain,
    address: getAddress(pool.pool) as Hex,
    abi: STAKING_POOL_ABI,
    functionName: "claim",
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function readHolderRewardTokens(pool: string, network: EvmNetwork): Promise<string[]> {
  const client = getPublicClient(network);
  const poolAddr = getAddress(pool) as Hex;
  const count = (await client.readContract({
    address: poolAddr,
    abi: STAKING_POOL_ABI,
    functionName: "holderRewardTokenCount",
  })) as bigint;
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return [];
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      client.readContract({
        address: poolAddr,
        abi: STAKING_POOL_ABI,
        functionName: "holderRewardTokens",
        args: [BigInt(i)],
      }) as Promise<string>,
    ),
  );
}

export async function readPendingHolderReward(
  pool: string,
  user: string,
  rewardToken: string,
  network: EvmNetwork,
): Promise<bigint> {
  const client = getPublicClient(network);
  return (await client.readContract({
    address: getAddress(pool) as Hex,
    abi: STAKING_POOL_ABI,
    functionName: "pendingHolderReward",
    args: [getAddress(user) as Hex, getAddress(rewardToken) as Hex],
  })) as bigint;
}

export async function syncHolderReward(
  walletClient: WalletClient,
  pool: string,
  network: EvmNetwork,
  rewardToken: string,
): Promise<string> {
  return writeHolderReward(walletClient, pool, network, "syncHolderReward", rewardToken);
}

export async function claimHolderReward(
  walletClient: WalletClient,
  pool: string,
  network: EvmNetwork,
  rewardToken: string,
): Promise<string> {
  return writeHolderReward(walletClient, pool, network, "claimHolderReward", rewardToken);
}

async function writeHolderReward(
  walletClient: WalletClient,
  pool: string,
  network: EvmNetwork,
  fn: "syncHolderReward" | "claimHolderReward",
  rewardToken: string,
): Promise<string> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect an EVM wallet.");
  const publicClient = getPublicClient(network);
  const txHash = await walletClient.writeContract({
    account,
    chain: network.chain,
    address: getAddress(pool) as Hex,
    abi: STAKING_POOL_ABI,
    functionName: fn,
    args: [getAddress(rewardToken) as Hex],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Push accrued stake/unstake tax to the immutable treasury.
 * Permissionless. Returns the tx hash, or null if nothing was owed / the
 * treasury rejected the transfer. Never throws — stake/unstake already landed.
 */
export async function sweepPoolTreasury(
  walletClient: WalletClient,
  pool: PoolSummary,
  network: EvmNetwork,
): Promise<string | null> {
  const account = walletClient.account;
  if (!account) return null;
  const publicClient = getPublicClient(network);
  const poolAddr = getAddress(pool.pool) as Hex;
  try {
    const owed = (await publicClient.readContract({
      address: poolAddr,
      abi: STAKING_POOL_ABI,
      functionName: "owedToTreasury",
    })) as bigint;
    if (owed === 0n) return null;
    const hash = await walletClient.writeContract({
      account,
      chain: network.chain,
      address: poolAddr,
      abi: STAKING_POOL_ABI,
      functionName: "withdrawTreasury",
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  } catch {
    return null;
  }
}
