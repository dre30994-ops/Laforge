import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import type { PoolSummary } from "@/lib/factoryClient";
import { fetchTokenQuote, type TokenQuote } from "@/lib/tokenQuote";
import { fetchPoolFlow, type PoolFlow } from "@/lib/poolVolume";

export type PoolMarket = {
  quote: TokenQuote | null;
  flow: PoolFlow | null;
  lockedTokens: number;
  tvlUsd: number | null;
  stakeVolumeTokens: number | null;
  unstakeVolumeTokens: number | null;
  stakeVolumeUsd: number | null;
  unstakeVolumeUsd: number | null;
  loading: boolean;
};

function tokens(raw: bigint | undefined, decimals: number): number | null {
  if (raw == null) return null;
  const n = Number(formatUnits(raw, decimals || 18));
  return Number.isFinite(n) ? n : null;
}

function usd(amount: number | null, price: number | null): number | null {
  if (amount == null || price == null || !Number.isFinite(price) || price <= 0) return null;
  const v = amount * price;
  return Number.isFinite(v) ? v : null;
}

export function usePoolMarket(pool: PoolSummary | null): PoolMarket {
  const [quote, setQuote] = useState<TokenQuote | null>(null);
  const [flow, setFlow] = useState<PoolFlow | null>(null);
  const [loading, setLoading] = useState(true);

  const token = pool?.token;
  const chainId = pool?.chainId;
  const poolAddr = pool?.pool;
  const demo = pool?.demo;
  const seedIn = pool?.stakeVolume;
  const seedOut = pool?.unstakeVolume;
  const seedPrice = pool?.usdPrice;

  useEffect(() => {
    if (!pool || !token || !chainId) {
      setQuote(null);
      setFlow(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        const [q, f] = await Promise.all([
          fetchTokenQuote(chainId, token),
          fetchPoolFlow(pool),
        ]);
        if (cancelled) return;
        setQuote(
          q ??
            (seedPrice && seedPrice > 0
              ? {
                  token: token.toLowerCase(),
                  chainId,
                  priceUsd: seedPrice,
                  liquidityUsd: null,
                  volumeH24Usd: null,
                  pair: null,
                  dex: null,
                  source: demo ? "demo" : "dexscreener",
                  quality: "thin",
                  quotedAt: Date.now(),
                }
              : null),
        );
        setFlow(
          f ??
            (seedIn != null || seedOut != null
              ? { stakeVolume: seedIn ?? 0n, unstakeVolume: seedOut ?? 0n }
              : null),
        );
        setLoading(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pool, token, chainId, poolAddr, demo, seedIn, seedOut, seedPrice]);

  const dec = pool?.decimals || 18;
  const lockedTokens = tokens(pool?.stakeVaultBalance, dec) ?? 0;
  const price = quote?.priceUsd ?? null;
  const stakeVolumeTokens = tokens(flow?.stakeVolume, dec);
  const unstakeVolumeTokens = tokens(flow?.unstakeVolume, dec);

  return {
    quote,
    flow,
    lockedTokens,
    tvlUsd: usd(lockedTokens, price),
    stakeVolumeTokens,
    unstakeVolumeTokens,
    stakeVolumeUsd: usd(stakeVolumeTokens, price),
    unstakeVolumeUsd: usd(unstakeVolumeTokens, price),
    loading,
  };
}
