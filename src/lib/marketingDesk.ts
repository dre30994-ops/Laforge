import {
  createPublicClient,
  http,
  getAddress,
  isAddress,
  type Hex,
  type WalletClient,
} from "viem";
import type { EvmNetwork } from "@/lib/evmNetworks";

export const SLOT_SECONDS = 12 * 60 * 60;

export const MARKETING_DESK_ABI = [
  {
    type: "function",
    name: "buyMarketing",
    stateMutability: "payable",
    inputs: [{ name: "pool", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "hasMarketing",
    stateMutability: "view",
    inputs: [{ name: "pool", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isTrending",
    stateMutability: "view",
    inputs: [{ name: "pool", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "trendingUntil",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unlockedAt",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type MarketingStatus = {
  unlocked: boolean;
  trending: boolean;
  trendingUntil: number;
};

export function deskConfigured(network: EvmNetwork): boolean {
  return !!network.desk && isAddress(network.desk);
}

export function formatMarketingFee(network: EvmNetwork): string {
  const wei = network.fees.marketing;
  const whole = wei / 1_000_000_000_000_000_000n;
  const frac = wei % 1_000_000_000_000_000_000n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  const amt = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return `${amt} ${network.nativeSymbol}`;
}

function deskClient(network: EvmNetwork) {
  const rpc = network.chain.rpcUrls.default.http[0];
  return createPublicClient({
    chain: network.chain,
    transport: http(rpc, { timeout: 12_000, retryCount: 1 }),
  });
}

export async function fetchMarketingStatus(
  pool: string,
  network: EvmNetwork,
): Promise<MarketingStatus> {
  const empty: MarketingStatus = { unlocked: false, trending: false, trendingUntil: 0 };
  if (!deskConfigured(network) || !isAddress(pool)) return empty;
  try {
    const client = deskClient(network);
    const desk = getAddress(network.desk) as Hex;
    const addr = getAddress(pool) as Hex;
    const [unlocked, until] = await Promise.all([
      client.readContract({
        address: desk,
        abi: MARKETING_DESK_ABI,
        functionName: "hasMarketing",
        args: [addr],
      }) as Promise<boolean>,
      client.readContract({
        address: desk,
        abi: MARKETING_DESK_ABI,
        functionName: "trendingUntil",
        args: [addr],
      }) as Promise<bigint>,
    ]);
    const trendingUntil = Number(until);
    return {
      unlocked,
      trending: trendingUntil > Date.now() / 1000,
      trendingUntil,
    };
  } catch {
    return empty;
  }
}

export async function buyMarketing(
  walletClient: WalletClient,
  pool: string,
  network: EvmNetwork,
): Promise<{ txHash: string }> {
  if (!deskConfigured(network)) {
    throw new Error(`Marketing desk is not deployed on ${network.label} yet.`);
  }
  const account = walletClient.account;
  if (!account) throw new Error("Connect a wallet first.");
  const walletChainId = walletClient.chain?.id ?? (await walletClient.getChainId());
  if (walletChainId !== network.chain.id) {
    throw new Error(`Switch to ${network.label} to pay the ${network.nativeSymbol} marketing fee.`);
  }
  const client = deskClient(network);
  const desk = getAddress(network.desk) as Hex;
  let fee = network.fees.marketing;
  try {
    fee = (await client.readContract({
      address: desk,
      abi: MARKETING_DESK_ABI,
      functionName: "FEE",
    })) as bigint;
  } catch {
    fee = network.fees.marketing;
  }
  const txHash = await walletClient.writeContract({
    account,
    chain: network.chain,
    address: desk,
    abi: MARKETING_DESK_ABI,
    functionName: "buyMarketing",
    args: [getAddress(pool) as Hex],
    value: fee,
  });
  await client.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}
