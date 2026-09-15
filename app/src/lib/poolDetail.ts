"use client";

// Fetch everything the per-pool detail page needs for a single pool, keyed by
// the pool (StakingPool) contract address:
//   - on-chain summary (token, symbol, taxes, duration, TVL, lifecycle) via viem
//   - off-chain display metadata (nickname, image, tier, banner, socials) keyed
//     by the token address
//
// The pool cards / directory already fetch these in bulk; this is the
// single-pool equivalent used by app/pool/[address]/page.tsx.

import { fetchPoolSummary, type PoolSummary } from "@/lib/factoryClient";
import { getPoolMeta, type PoolMeta } from "@/lib/poolMeta";
import { getPreviewPool, isPreviewAddress } from "@/lib/previewPools";

export type PoolDetail = {
  summary: PoolSummary;
  meta: PoolMeta | null;
};

/**
 * Load a single pool's on-chain summary and its off-chain metadata.
 * Throws if the summary can't be read (bad address / RPC failure); metadata is
 * best-effort and resolves to `null` when unavailable.
 *
 * Synthetic preview/mock pools (mock cards + mock trending tokens) are resolved
 * from the local preview registry so their detail pages work without a chain.
 */
export async function getPoolDetail(poolAddress: string): Promise<PoolDetail> {
  if (isPreviewAddress(poolAddress)) {
    const preview = getPreviewPool(poolAddress);
    if (preview) return { summary: preview.summary, meta: preview.meta };
    throw new Error("Unknown preview pool.");
  }
  const summary = await fetchPoolSummary(poolAddress);
  const meta = await getPoolMeta(summary.token).catch(() => null);
  return { summary, meta };
}
