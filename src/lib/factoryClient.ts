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

  const txHash = await walletClient.writeContract({
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
    value: tierFeeWei(network, i.tier),
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

export function poolStatus(p: Pick<PoolSummary, "started" | "paused">):
  | "live"
  | "paused"
  | "pending" {
  if (p.paused) return "paused";
  return p.started ? "live" : "pending";
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

  const [fundedAmount, totalEmitted, totalClaimed, rewardVaultBalance, minStake, totalStaked, startTs] =
    await Promise.all([
      read<bigint>("fundedAmount").catch(() => 0n),
      read<bigint>("totalEmitted").catch(() => 0n),
      read<bigint>("totalClaimed").catch(() => 0n),
      read<bigint>("rewardVaultBalance").catch(() => 0n),
      read<bigint>("minStake").catch(() => 0n),
      read<bigint>("totalStaked").catch(() => 0n),
      read<bigint>("startTs").catch(() => 0n),
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
