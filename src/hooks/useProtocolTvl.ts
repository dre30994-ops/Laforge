import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { listPools, type PoolSummary } from "@/lib/factoryClient";
import { fetchTokenQuotes, quoteMapKey } from "@/lib/tokenQuote";
import { onPoolsChanged } from "@/lib/poolEvents";
import { EVM_NETWORKS, EVM_VISIBLE_NETWORKS, isVisibleNetwork, type EvmNetworkKey } from "@/lib/evmNetworks";

export type ChainTvl = {
  chainKey: EvmNetworkKey;
  tvlUsd: number;
  pools: number;
  priced: number;
};

export type ProtocolTvl = {
  tvlUsd: number;
  pools: number;
  priced: number;
  unpriced: number;
  byChain: ChainTvl[];
  loading: boolean;
};

const EMPTY: Omit<ProtocolTvl, "loading"> = {
  tvlUsd: 0,
  pools: 0,
  priced: 0,
  unpriced: 0,
  byChain: [],
};

const CACHE_TTL_MS = 30_000;
let cached: { at: number; value: Omit<ProtocolTvl, "loading"> } | null = null;
let inflight: Promise<Omit<ProtocolTvl, "loading">> | null = null;

function asTokens(raw: bigint | undefined, decimals: number): number {
  if (raw == null) return 0;
  const n = Number(formatUnits(raw, decimals || 18));
  return Number.isFinite(n) ? n : 0;
}

/** USD of every token sitting in the pool: staked principal, remaining rewards, unpaid tax. */
function lockedUsd(pool: PoolSummary, price: number | undefined): number | null {
  if (price == null || !(price > 0)) return null;
  const dec = pool.decimals || 18;
  const n =
    asTokens(pool.stakeVaultBalance, dec) +
    asTokens(pool.rewardVaultBalance, dec) +
    asTokens(pool.owedToTreasury, dec);
  const usd = n * price;
  return Number.isFinite(usd) ? usd : null;
}

async function computeProtocolTvl(): Promise<Omit<ProtocolTvl, "loading">> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const pools = (await listPools()).filter((p) => !p.demo);
    const quotes = await fetchTokenQuotes(
      pools.map((p) => ({ chainId: p.chainId, token: p.token })),
    );

    const chainAcc = new Map<EvmNetworkKey, ChainTvl>();
    let tvlUsd = 0;
    let priced = 0;
    for (const p of pools) {
      const q = quotes.get(quoteMapKey(p.chainId, p.token));
      const usd = lockedUsd(p, q?.priceUsd);
      const key = p.chainKey;
      const row = chainAcc.get(key) ?? {
        chainKey: key,
        tvlUsd: 0,
        pools: 0,
        priced: 0,
      };
      row.pools += 1;
      if (usd != null) {
        row.tvlUsd += usd;
        row.priced += 1;
        tvlUsd += usd;
        priced += 1;
      }
      chainAcc.set(key, row);
    }

    const value: Omit<ProtocolTvl, "loading"> = {
      tvlUsd,
      pools: pools.length,
      priced,
      unpriced: pools.length - priced,
      byChain: [...chainAcc.values()].sort((a, b) => b.tvlUsd - a.tvlUsd),
    };
    cached = { at: Date.now(), value };
    return value;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

function invalidateProtocolTvl(): void {
  cached = null;
}

/**
 * USD value of tokens locked in every live pool, on every launch chain
 * (Robinhood, Ethereum, Base, BNB Chain, HyperEVM). Each token is quoted
 * on its own chain's DEX so a HyperEVM or BSC farm is not priced as if it
 * were on Ethereum.
 */
export function useProtocolTvl(enabled = true): ProtocolTvl {
  const [state, setState] = useState<ProtocolTvl>({
    ...EMPTY,
    loading: enabled,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const value = await computeProtocolTvl();
        if (!cancelled) setState({ ...value, loading: false });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    }

    const t = window.setTimeout(() => void load(), 0);
    const off = onPoolsChanged(() => {
      invalidateProtocolTvl();
      void load();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      off();
    };
  }, [enabled]);

  return state;
}

export function chainTvlCaption(tvl: ProtocolTvl): string {
  const visibleNames = EVM_VISIBLE_NETWORKS.map((k) => EVM_NETWORKS[k]?.short ?? k);
  if (tvl.loading) return "quoting…";
  const named = tvl.byChain
    .filter((c) => isVisibleNetwork(c.chainKey) && c.priced > 0)
    .map((c) => EVM_NETWORKS[c.chainKey]?.short ?? c.chainKey);
  const chains = named.length > 0 ? named.join(" · ") : visibleNames.join(" · ");
  const visibleUnpriced = tvl.byChain
    .filter((c) => isVisibleNetwork(c.chainKey))
    .reduce((n, c) => n + Math.max(0, c.pools - c.priced), 0);
  if (visibleUnpriced > 0) return `${chains} · ${visibleUnpriced} awaiting DEX pair`;
  return chains;
}
