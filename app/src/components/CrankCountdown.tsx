"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Countdown to the pool's next 20-minute emission period boundary
 * (PERIOD_SECONDS = 1200). Emissions are denominated per 20-minute period; the
 * countdown reflects that cadence. When it crosses into a new period,
 * `onBoundaryReached` fires so the caller can refetch — no transaction is sent.
 *
 * State is driven entirely by the 1s interval tick (no setState in the effect
 * body, no Date.now() during render), satisfying the react-hooks purity rules.
 */
const PERIOD = 1200; // 20 minutes — matches StakingMath.PERIOD_SECONDS

type View =
  | { kind: "none" }
  | { kind: "ended" }
  | { kind: "counting"; remaining: number };

export function CrankCountdown({
  startTs,
  endTs,
  onBoundaryReached,
}: {
  startTs: bigint;
  endTs: bigint;
  onBoundaryReached: () => void;
}) {
  const start = Number(startTs);
  const end = Number(endTs);
  const [view, setView] = useState<View>({ kind: "none" });
  const firedForBoundary = useRef<number>(-1);

  useEffect(() => {
    const tick = () => {
      if (!start) {
        setView({ kind: "none" });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      if (end && now >= end) {
        setView({ kind: "ended" });
        return;
      }
      const elapsed = Math.max(0, now - start);
      const boundaryIndex = Math.floor(elapsed / PERIOD) + 1;
      const nextBoundaryTs = start + boundaryIndex * PERIOD;
      const remaining = Math.max(0, nextBoundaryTs - now);
      setView({ kind: "counting", remaining });
      // On crossing into a new boundary, refetch once (skip the first sample).
      if (boundaryIndex !== firedForBoundary.current) {
        if (firedForBoundary.current !== -1) onBoundaryReached();
        firedForBoundary.current = boundaryIndex;
      }
    };
    // Defer the first tick so no setState runs synchronously in the effect body.
    const kick = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
    };
  }, [start, end, onBoundaryReached]);

  if (view.kind === "none") {
    return <span className="mono text-xs text-lo">—</span>;
  }
  if (view.kind === "ended") {
    return <span className="mono text-xs text-lo">Program ended</span>;
  }
  const m = Math.floor(view.remaining / 60);
  const s = view.remaining % 60;
  return (
    <span className="mono text-sm font-bold text-gold-neon tabular-nums">
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}
