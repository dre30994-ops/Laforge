import { Link } from "@tanstack/react-router";
import { PoolCard, type CardData } from "@/components/PoolDirectory";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { getMockPools, mockMetaMap } from "@/lib/mockPools";
import { metaForPool } from "@/lib/poolMeta";

function sampleCards(): CardData[] {
  const meta = mockMetaMap();
  return getMockPools().map((p) => ({
    ...p,
    meta: metaForPool(meta, p.token, p.pool),
    trending: false,
  }));
}

export function SampleDashboardsBanner() {
  return (
    <div
      className="rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      style={{
        background: "rgba(124, 58, 237, 0.10)",
        border: "1px solid rgba(168, 85, 247, 0.35)",
      }}
      data-testid="sample-banner"
      role="status"
    >
      <div>
        <p className="text-sm font-semibold text-hi">Sample data. Not live.</p>
        <p className="text-xs text-mid mt-0.5 leading-relaxed">
          Nothing here is a stake. Numbers, socials, and the Marketing Add-on are a walkthrough of how a
          real pool dashboard reads.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/preview"
          className="h-9 px-3 rounded-xl text-xs font-semibold text-hi border border-black/10
                     hover:bg-black/[0.04] grid place-items-center"
        >
          All samples
        </Link>
        <CreatePoolButton label="Create a real pool" showIcon={false} />
      </div>
    </div>
  );
}

export function SampleDashboardsCta({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link
        to="/preview"
        className="text-xs font-semibold text-gold-neon hover:underline"
        data-testid="sample-dashboards-link"
      >
        Preview sample dashboards
      </Link>
    );
  }
  return (
    <Link
      to="/preview"
      className="inline-flex h-10 px-4 rounded-xl text-xs font-semibold text-hi
                 border border-black/10 hover:bg-black/[0.04] items-center"
      data-testid="sample-dashboards-cta"
    >
      Preview a pool dashboard
    </Link>
  );
}

export function SampleDashboardsGrid() {
  const cards = sampleCards();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="sample-dashboards">
      {cards.map((p) => (
        <PoolCard key={`${p.chainId}:${p.pool}`} data={p} />
      ))}
    </div>
  );
}
