import { formatUnits } from "viem";
import type { PoolSummary } from "@/lib/factoryClient";

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function asTokens(raw: bigint | undefined, decimals: number): number | null {
  if (raw == null) return null;
  const n = Number(formatUnits(raw, decimals || 18));
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return formatCompact(n);
}

export function PoolVaultStats({ pool }: { pool: PoolSummary }) {
  const dec = pool.decimals || 18;
  const locked = asTokens(pool.stakeVaultBalance, dec);
  const left = asTokens(pool.rewardVaultBalance, dec);
  const emitted = asTokens(pool.totalEmitted, dec);

  const rows = [
    {
      k: "Total tokens locked",
      v: fmt(locked),
      sub: pool.symbol ? `$${pool.symbol}` : "staked",
    },
    {
      k: "Total tokens left",
      v: fmt(left),
      sub: "rewards remaining",
    },
    {
      k: "Tokens emitted so far",
      v: fmt(emitted),
      sub: "paid out",
    },
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="pool-vault-stats">
      {rows.map((row) => (
        <div key={row.k} className="glass !rounded-2xl p-4">
          <div className="mono text-lg font-bold text-gold-neon leading-tight">{row.v}</div>
          <div className="label-term !normal-case mt-1">{row.k}</div>
          <div className="label-term !text-[9px] !normal-case !tracking-normal text-lo mt-0.5">{row.sub}</div>
        </div>
      ))}
    </section>
  );
}
