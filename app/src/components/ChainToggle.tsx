"use client";

import { useChain } from "@/components/ChainProvider";

/**
 * The chain lever — a two-position switch that flips the active chain between
 * Robinhood (EVM) and Solana. Persisted via ChainProvider (localStorage).
 *
 * Left  = Robinhood / EVM (gold accent, matching the app theme) — default
 * Right = Solana (purple accent)
 */
export function ChainToggle() {
  const { chain, toggleChain, hydrated } = useChain();
  const isRobinhood = chain === "robinhood";

  return (
    <div className="w-full">
      <div className="flex items-center justify-between px-1 mb-1.5">
        <span className="label-term !text-[9px]">Chain</span>
        <span className="label-term !text-[9px] text-hi">
          {isRobinhood ? "Robinhood · EVM" : "Solana"}
        </span>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={isRobinhood}
        aria-label={`Switch chain (currently ${isRobinhood ? "Robinhood EVM" : "Solana"})`}
        onClick={toggleChain}
        disabled={!hydrated}
        className="relative w-full h-10 rounded-xl border border-black/10 bg-black/[0.03]
                   overflow-hidden select-none disabled:opacity-50
                   transition-colors"
      >
        {/* Sliding knob — left when Robinhood (default), right when Solana */}
        <span
          className="absolute top-1 bottom-1 w-[calc(50%-6px)] rounded-lg transition-all duration-200 ease-out"
          style={{
            left: isRobinhood ? "4px" : "calc(50% + 2px)",
            background: isRobinhood
              ? "linear-gradient(180deg, var(--neon-gold), var(--amber))"
              : "linear-gradient(180deg, #9945FF, #7A2BE2)",
          }}
        />

        {/* Labels — Robinhood on the left, Solana on the right */}
        <span className="absolute inset-0 grid grid-cols-2 items-center text-[11px] font-semibold"
          style={{ fontFamily: "var(--font-mono, monospace)" }}>
          <span className={isRobinhood ? "text-[#0a0c0f]" : "text-lo"}>Robinhood</span>
          <span className={isRobinhood ? "text-lo" : "text-[#0a0c0f]"}>Solana</span>
        </span>
      </button>
    </div>
  );
}
