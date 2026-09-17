import { useLiveClaimable } from "@/hooks/useLiveClaimable";

/**
 * Live claimable readout for a pool the connected wallet has a stake in.
 * On-chain pending is sampled, then interpolated between cranks so the
 * number ticks up in real time.
 */
export function ClaimableTicker({
  pool,
  chainId,
  symbol,
  compact = false,
}: {
  pool: string;
  chainId: number;
  symbol?: string;
  compact?: boolean;
}) {
  const { connected, hasStake, display, stakedDisplay, loading } = useLiveClaimable(pool, chainId);
  if (!connected || !hasStake) return null;

  if (compact) {
    return (
      <div className="text-right shrink-0" data-testid="claimable-compact">
        <div className="mono text-sm font-semibold text-pos tabular-nums">{display}</div>
        <div className="label-term !text-[8px]">claimable{symbol ? ` ${symbol}` : ""}</div>
      </div>
    );
  }

  return (
    <section className="glass glass-gold p-5 animate-rise" data-testid="claimable-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-term mb-1">Your position</p>
          <h2 className="text-sm font-semibold text-hi tracking-tight">Claimable rewards</h2>
          <p className="text-xs text-mid mt-1 leading-relaxed">
            Approximate, updating live. Exact payout is settled on-chain when you claim.
          </p>
        </div>
        <span className="pulse-dot mt-1" />
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="mono text-3xl md:text-4xl font-bold text-pos tabular-nums leading-none">
            {loading && display === "0.00" ? "…" : display}
          </div>
          <div className="label-term mt-2">{symbol ? `$${symbol}` : "tokens"} · unclaimed</div>
        </div>
        <div className="text-right">
          <div className="mono text-lg font-semibold text-hi tabular-nums">{stakedDisplay}</div>
          <div className="label-term mt-1">staked</div>
        </div>
      </div>
    </section>
  );
}
