"use client";

// Shared PREVIEW / MOCK pool data so the pool cards, the trending carousel, and
// the per-pool detail page all agree on the same synthetic pools. This lets the
// mock cards + mock trending tokens be clickable and render a working detail
// page without any on-chain deployment.
//
// Toggle off with NEXT_PUBLIC_PREVIEW_TIER_CARDS="0" (cards) and
// NEXT_PUBLIC_PREVIEW_TRENDING="0" (carousel). Delete this file + its imports to
// remove previews entirely.

import type { PoolSummary } from "@/lib/factoryClient";
import type { PoolMeta } from "@/lib/poolMeta";

export type PreviewPool = { summary: PoolSummary; meta: PoolMeta };

export const SHOW_PREVIEW_CARDS =
  (process.env.NEXT_PUBLIC_PREVIEW_TIER_CARDS ?? "1") !== "0";
export const SHOW_MOCK_TRENDING =
  (process.env.NEXT_PUBLIC_PREVIEW_TRENDING ?? "1") !== "0";

/** True for any synthetic preview/mock pool address. */
export function isPreviewAddress(addr: string): boolean {
  return /^0x(PREVIEW|MOCK)/i.test(addr);
}

// ── SVG placeholder helpers (no external assets) ──
function swatch(from: string, to: string, size = 400, rx = 0): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/></linearGradient></defs><rect width='${size}' height='${size}' rx='${rx}' fill='url(#g)'/></svg>`
  )}`;
}
function bannerSvg(from: string, to: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='240'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/></linearGradient></defs><rect width='800' height='240' fill='url(#g)'/></svg>`
  )}`;
}

function baseSummary(i: number, over: Partial<PoolSummary>): PoolSummary {
  return {
    pool: `0xPREVIEWpool${i.toString().padStart(28, "0")}`,
    token: `0xPREVIEWtoken${i.toString().padStart(27, "0")}`,
    symbol: "",
    operator: "0x0000000000000000000000000000000000000000",
    durationDays: 7,
    stakeTaxBps: 100,
    unstakeTaxBps: 150,
    started: true,
    paused: false,
    stakeVaultBalance: BigInt("125000000000000000000000"),
    decimals: 18,
    ...over,
  };
}

/** 3 tier preview cards (1 Bronze / 1 Ecosystem / 1 Marketing). */
function buildPreviewCards(): PreviewPool[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const out: PreviewPool[] = [];
  let idx = 0;

  for (let n = 1; n <= 1; n++) {
    idx++;
    out.push({
      summary: baseSummary(idx, { symbol: `BRZ${n}`, durationDays: 2 }),
      meta: { nickname: `Bronze Pool ${n}`, image: swatch("#b45309", "#f59e0b"), tier: 0 },
    });
  }
  for (let n = 1; n <= 1; n++) {
    idx++;
    out.push({
      summary: baseSummary(idx, { symbol: `ECO${n}`, durationDays: 14 }),
      meta: {
        nickname: `Ecosystem Pool ${n}`,
        image: swatch("#0ea5e9", "#22d3ee"),
        banner: bannerSvg("#0369a1", "#22d3ee"),
        tier: 1,
        socials: {
          website: `https://ecosystem-${n}.example`,
          twitter: `https://x.com/ecosystem_${n}`,
          telegram: `https://t.me/ecosystem_${n}`,
        },
      },
    });
  }
  for (let n = 1; n <= 1; n++) {
    idx++;
    out.push({
      summary: baseSummary(idx, { symbol: `MKT${n}`, durationDays: 30 }),
      meta: {
        nickname: `Marketing Pool ${n}`,
        image: swatch("#7c3aed", "#ec4899"),
        banner: bannerSvg("#6d28d9", "#ec4899"),
        tier: 2,
        socials: {
          website: `https://marketing-${n}.example`,
          twitter: `https://x.com/marketing_${n}`,
          telegram: `https://t.me/marketing_${n}`,
          discord: `https://discord.gg/marketing_${n}`,
        },
        marketing: { verifiedBadge: true, trendingUntil: nowSec + 7 * 24 * 60 * 60 },
      },
    });
  }
  return out;
}

/** 4 mock trending Marketing pools for the carousel (each a real detail page). */
function buildMockTrending(): PreviewPool[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const defs = [
    { sym: "PHNX", from: "#f97316", to: "#ef4444", hoursLeft: 11, dur: 30 },
    { sym: "NOVA", from: "#8b5cf6", to: "#ec4899", hoursLeft: 8, dur: 21 },
    { sym: "GRID", from: "#06b6d4", to: "#22d3ee", hoursLeft: 5, dur: 14 },
    { sym: "AURA", from: "#22c55e", to: "#84cc16", hoursLeft: 2, dur: 7 },
  ];
  return defs.map((d, i) => ({
    summary: {
      pool: `0xMOCKtrendingpool${i.toString().padStart(24, "0")}`,
      token: `0xMOCKtrendingtoken${i.toString().padStart(23, "0")}`,
      symbol: d.sym,
      operator: "0x0000000000000000000000000000000000000000",
      durationDays: d.dur,
      stakeTaxBps: 100,
      unstakeTaxBps: 200,
      started: true,
      paused: false,
      stakeVaultBalance: BigInt("500000000000000000000000"),
      decimals: 18,
    } as PoolSummary,
    meta: {
      nickname: `$${d.sym}`,
      image: swatch(d.from, d.to, 64, 12),
      banner: bannerSvg(d.from, d.to),
      tier: 2,
      socials: {
        website: `https://${d.sym.toLowerCase()}.example`,
        twitter: `https://x.com/${d.sym.toLowerCase()}`,
        telegram: `https://t.me/${d.sym.toLowerCase()}`,
      },
      marketing: {
        verifiedBadge: true,
        trendingUntil: nowSec + d.hoursLeft * 60 * 60,
      },
    } as PoolMeta,
  }));
}

export const PREVIEW_CARDS: PreviewPool[] = SHOW_PREVIEW_CARDS ? buildPreviewCards() : [];
export const MOCK_TRENDING: PreviewPool[] = SHOW_MOCK_TRENDING ? buildMockTrending() : [];

/** All synthetic pools, keyed by lowercased pool address. */
const REGISTRY: Map<string, PreviewPool> = (() => {
  const m = new Map<string, PreviewPool>();
  for (const p of [...PREVIEW_CARDS, ...MOCK_TRENDING]) {
    m.set(p.summary.pool.toLowerCase(), p);
  }
  return m;
})();

/** Look up a synthetic pool by pool address (or null if not a preview). */
export function getPreviewPool(poolAddress: string): PreviewPool | null {
  return REGISTRY.get(poolAddress.toLowerCase()) ?? null;
}
