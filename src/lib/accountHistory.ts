import { formatUnits, getAddress, isAddress, parseAbiItem, type Hex } from "viem";
import { getPublicClient, listPools, type PoolSummary } from "@/lib/factoryClient";
import { networkByChainId } from "@/lib/evmNetworks";
import { getPoolMeta } from "@/lib/poolMeta";
import type { ActivityItem, ActivityKind, UserStake } from "@/lib/userLedger";

const STAKED = parseAbiItem(
  "event Staked(address indexed user, uint256 amount, uint256 newAmount)",
);
const UNSTAKED = parseAbiItem(
  "event Unstaked(address indexed user, uint256 amount, uint256 userAmount, uint256 tax)",
);
const CLAIMED = parseAbiItem("event Claimed(address indexed user, uint256 amount)");

function pretty(amount: bigint, decimals: number): string {
  const raw = formatUnits(amount, decimals || 18);
  if (!raw.includes(".")) return raw;
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed || "0";
}

async function readLogs(
  network: Parameters<typeof getPublicClient>[0],
  pool: Hex,
  user: Hex,
  event: typeof STAKED | typeof UNSTAKED | typeof CLAIMED,
) {
  const client = getPublicClient(network);
  const pull = (fromBlock: bigint) =>
    client.getLogs({ address: pool, event, args: { user }, fromBlock });
  try {
    return await pull(0n);
  } catch {
    try {
      const latest = await client.getBlockNumber();
      const from = latest > 900_000n ? latest - 900_000n : 0n;
      return await pull(from);
    } catch {
      return [];
    }
  }
}

async function poolFace(pool: PoolSummary): Promise<{ name?: string; image?: string }> {
  try {
    const meta = await getPoolMeta(pool.token);
    return { name: meta?.nickname, image: meta?.image };
  } catch {
    return {};
  }
}

export async function loadOnchainAccount(address: string): Promise<{
  stakes: UserStake[];
  activity: ActivityItem[];
}> {
  if (!isAddress(address)) return { stakes: [], activity: [] };
  const user = getAddress(address);
  const who = user.toLowerCase();
  const pools = await listPools();
  const stakes: UserStake[] = [];
  const activity: ActivityItem[] = [];

  await Promise.all(
    pools.map(async (pool) => {
      const network = networkByChainId(pool.chainId);
      if (!network) return;
      const client = getPublicClient(network);
      const poolAddr = getAddress(pool.pool) as Hex;
      const face = await poolFace(pool);

      try {
        const pos = (await client.readContract({
          address: poolAddr,
          abi: [
            {
              type: "function",
              name: "positions",
              stateMutability: "view",
              inputs: [{ type: "address" }],
              outputs: [
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "bool" },
              ],
            },
          ],
          functionName: "positions",
          args: [user as Hex],
        })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
        const amount = pos[0];
        const claimed = pos[7];
        const exists = pos[9];
        if (exists || amount > 0n || claimed > 0n) {
          stakes.push({
            id: `${pool.chainId}:${pool.pool.toLowerCase()}:${who}`,
            address: who,
            pool: pool.pool.toLowerCase(),
            token: pool.token.toLowerCase(),
            chainId: pool.chainId,
            symbol: pool.symbol,
            name: face.name,
            image: face.image,
            amount: pretty(amount, pool.decimals),
            active: amount > 0n,
            updatedAt: Date.now(),
          });
        }
      } catch {
        /* pool has no position reader */
      }

      const kinds: { event: typeof STAKED | typeof UNSTAKED | typeof CLAIMED; kind: ActivityKind; pick: (args: Record<string, unknown>) => bigint }[] = [
        { event: STAKED, kind: "stake", pick: (a) => a.amount as bigint },
        { event: UNSTAKED, kind: "unstake", pick: (a) => a.amount as bigint },
        { event: CLAIMED, kind: "claim", pick: (a) => a.amount as bigint },
      ];
      for (const row of kinds) {
        const logs = await readLogs(network, poolAddr, user as Hex, row.event);
        for (const log of logs) {
          const args = (log.args ?? {}) as Record<string, unknown>;
          const amount = row.pick(args);
          if (typeof amount !== "bigint") continue;
          activity.push({
            id: `${log.transactionHash}:${log.logIndex}`,
            address: who,
            kind: row.kind,
            pool: pool.pool.toLowerCase(),
            token: pool.token.toLowerCase(),
            chainId: pool.chainId,
            symbol: pool.symbol,
            name: face.name,
            image: face.image,
            amount: pretty(amount, pool.decimals),
            at: 0,
            txHash: log.transactionHash,
          });
        }
      }
    }),
  );

  const clients = new Map<number, ReturnType<typeof getPublicClient>>();
  await Promise.all(
    activity.map(async (item) => {
      if (!item.txHash || item.at > 0) return;
      const network = networkByChainId(item.chainId);
      if (!network) return;
      let client = clients.get(item.chainId);
      if (!client) {
        client = getPublicClient(network);
        clients.set(item.chainId, client);
      }
      try {
        const receipt = await client.getTransactionReceipt({ hash: item.txHash as Hex });
        const block = await client.getBlock({ blockNumber: receipt.blockNumber });
        item.at = Number(block.timestamp) * 1000;
      } catch {
        item.at = 0;
      }
    }),
  );

  activity.sort((a, b) => b.at - a.at);
  stakes.sort((a, b) => Number(b.active) - Number(a.active));
  return { stakes, activity };
}

export function mergeActivity(chain: ActivityItem[], local: ActivityItem[]): ActivityItem[] {
  const seen = new Set(chain.map((e) => `${e.txHash ?? ""}:${e.kind}:${e.pool}`));
  const extra = local.filter((e) => !seen.has(`${e.txHash ?? e.id}:${e.kind}:${e.pool}`));
  return [...chain, ...extra].sort((a, b) => b.at - a.at);
}

export function mergeStakes(chain: UserStake[], local: UserStake[]): UserStake[] {
  const byPool = new Map(chain.map((s) => [`${s.chainId}:${s.pool}`, s]));
  for (const s of local) {
    const key = `${s.chainId}:${s.pool.toLowerCase()}`;
    const on = byPool.get(key);
    if (!on) byPool.set(key, s);
    else if (!on.name && s.name) on.name = s.name;
    else if (!on.image && s.image) on.image = s.image;
  }
  return [...byPool.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
}
