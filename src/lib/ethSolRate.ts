const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WSOL = "So11111111111111111111111111111111111111112";
const TTL_MS = 60_000;

export type EthSolRate = {
  ethUsd: number;
  solUsd: number;
  solPerEth: number;
  quotedAt: number;
};

let memory: { rate: EthSolRate; until: number } | null = null;
let inflight: Promise<EthSolRate | null> | null = null;

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function priceUsd(token: string): Promise<number | null> {
  const urls = [
    `/api/dexscreener/latest/dex/tokens/${token}`,
    `https://api.dexscreener.com/latest/dex/tokens/${token}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[];
      };
      const pairs = json.pairs ?? [];
      let best: { price: number; liq: number } | null = null;
      for (const p of pairs) {
        const price = num(p.priceUsd);
        if (price == null) continue;
        const liq = p.liquidity?.usd ?? 0;
        if (!best || liq > best.liq) best = { price, liq };
      }
      if (best) return best.price;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function fetchEthSolRate(): Promise<EthSolRate | null> {
  if (memory && memory.until > Date.now()) return memory.rate;
  if (inflight) return inflight;
  inflight = (async () => {
    const [ethUsd, solUsd] = await Promise.all([priceUsd(WETH), priceUsd(WSOL)]);
    if (ethUsd == null || solUsd == null) return memory?.rate ?? null;
    const rate: EthSolRate = {
      ethUsd,
      solUsd,
      solPerEth: ethUsd / solUsd,
      quotedAt: Date.now(),
    };
    memory = { rate, until: Date.now() + TTL_MS };
    return rate;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

const ETH_DECIMALS = 18n;
const SCALE = 1_000_000_000n;

export function weiEthToSol(wei: bigint, solPerEth: number): number {
  if (wei === 0n || !Number.isFinite(solPerEth) || solPerEth <= 0) return 0;
  const scaled = Number((wei * SCALE) / 10n ** ETH_DECIMALS) / Number(SCALE);
  return scaled * solPerEth;
}

export function formatSol(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "0 SOL";
  if (amount >= 1) return `${amount.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
  if (amount >= 0.0001) return `${amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
  return `${amount.toPrecision(3)} SOL`;
}
