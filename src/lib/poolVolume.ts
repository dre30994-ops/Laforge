import { parseAbiItem, type Hex } from "viem";
import { getPublicClient, type PoolSummary } from "@/lib/factoryClient";
import { networkByChainId, type EvmNetwork } from "@/lib/evmNetworks";

/**
 * Lifetime stake / unstake flow, read from the pool's own events.
 * Volume is not stored as a counter on-chain; summing Staked / Unstaked
 * logs is the reliable record of tokens that moved in and out.
 */

const STAKED = parseAbiItem(
  "event Staked(address indexed user, uint256 amount, uint256 newAmount)",
);
const UNSTAKED = parseAbiItem(
  "event Unstaked(address indexed user, uint256 amount, uint256 userAmount, uint256 tax)",
);

export type PoolFlow = {
  stakeVolume: bigint;
  unstakeVolume: bigint;
};

const memory = new Map<string, { flow: PoolFlow; until: number }>();
const TTL_MS = 30_000;
const CHUNK = 8_000n;

const BLOCK_SECONDS: Record<number, number> = {
  1: 12,
  8453: 2,
  56: 3,
  999: 1,
  4663: 1,
};

function keyOf(chainId: number, pool: string): string {
  return `${chainId}:${pool.toLowerCase()}`;
}

function lookbackBlocks(chainId: number, durationDays: number, startTs?: number): bigint {
  const sec = BLOCK_SECONDS[chainId] || 12;
  const windowSec =
    startTs && startTs > 0
      ? Math.max(60, Math.floor(Date.now() / 1000) - startTs + 600)
      : (durationDays + 2) * 86_400;
  return BigInt(Math.ceil(windowSec / sec) + 500);
}

async function sumLogs(
  network: EvmNetwork,
  pool: Hex,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolFlow> {
  const client = getPublicClient(network);
  let stakeVolume = 0n;
  let unstakeVolume = 0n;
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;
    const [staked, unstaked] = await Promise.all([
      client.getLogs({ address: pool, event: STAKED, fromBlock: start, toBlock: end }),
      client.getLogs({ address: pool, event: UNSTAKED, fromBlock: start, toBlock: end }),
    ]);
    for (const log of staked) stakeVolume += log.args.amount ?? 0n;
    for (const log of unstaked) unstakeVolume += log.args.amount ?? 0n;
    start = end + 1n;
  }
  return { stakeVolume, unstakeVolume };
}

/** Token units that have staked in / unstaked out of this pool. */
export async function fetchPoolFlow(pool: PoolSummary): Promise<PoolFlow | null> {
  if (pool.demo) {
    return {
      stakeVolume: pool.stakeVolume ?? 0n,
      unstakeVolume: pool.unstakeVolume ?? 0n,
    };
  }

  const key = keyOf(pool.chainId, pool.pool);
  const hit = memory.get(key);
  if (hit && hit.until > Date.now()) return hit.flow;

  const network = networkByChainId(pool.chainId);
  if (!network) {
    if (pool.stakeVolume != null || pool.unstakeVolume != null) {
      return {
        stakeVolume: pool.stakeVolume ?? 0n,
        unstakeVolume: pool.unstakeVolume ?? 0n,
      };
    }
    return null;
  }

  try {
    const client = getPublicClient(network);
    const latest = await client.getBlockNumber();
    const back = lookbackBlocks(pool.chainId, pool.durationDays, pool.startTs);
    const fromBlock = latest > back ? latest - back : 0n;
    const flow = await sumLogs(network, pool.pool as Hex, fromBlock, latest);
    memory.set(key, { flow, until: Date.now() + TTL_MS });
    return flow;
  } catch {
    if (pool.stakeVolume != null || pool.unstakeVolume != null) {
      return {
        stakeVolume: pool.stakeVolume ?? 0n,
        unstakeVolume: pool.unstakeVolume ?? 0n,
      };
    }
    return null;
  }
}
