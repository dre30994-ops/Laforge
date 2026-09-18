import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import type { PoolSummary } from "@/lib/factoryClient";
import { fetchTokenQuote, type TokenQuote } from "@/lib/tokenQuote";

export type PoolMarket = {
  quote: TokenQuote | null;
  lockedTokens: number;
  tvlUsd: number | null;
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
  const [loading, setLoading] = useState(true);

  const token = pool?.token;
  const chainId = pool?.chainId;
  const demo = pool?.demo;
  const seedPrice = pool?.usdPrice;

  useEffect(() => {
    if (!pool || !token || !chainId) {
      setQuote(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        const q = await fetchTokenQuote(chainId, token);
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
        setLoading(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pool, token, chainId, demo, seedPrice]);

  const dec = pool?.decimals || 18;
  const lockedTokens = tokens(pool?.stakeVaultBalance, dec) ?? 0;
  const price = quote?.priceUsd ?? null;

  return {
    quote,
    lockedTokens,
    tvlUsd: usd(lockedTokens, price),
    loading,
  };
}
