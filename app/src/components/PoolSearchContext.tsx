"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress, getAddress } from "viem";

/**
 * Shared pool-search state so the search box (rendered in the dashboard top bar,
 * beside "Create") can drive the pool list (rendered further down in
 * PoolDirectory) without making the whole server-rendered dashboard page a
 * client component. The provider is a thin client boundary; the two consumers
 * — the top-bar input and the directory — read/write the same query.
 */
type PoolSearchValue = {
  query: string;
  setQuery: (q: string) => void;
  /**
   * Lowercased address → pool (StakingPool) contract address. Populated by
   * PoolDirectory once it has fetched the pool list, so the search bar can
   * navigate correctly whether the user pastes a POOL address or a TOKEN
   * address (both map to the same pool detail page).
   */
  addressToPool: Record<string, string>;
  setAddressToPool: (m: Record<string, string>) => void;
};

const PoolSearchContext = createContext<PoolSearchValue | null>(null);

export function PoolSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [addressToPool, setAddressToPool] = useState<Record<string, string>>({});
  const value = useMemo(
    () => ({ query, setQuery, addressToPool, setAddressToPool }),
    [query, addressToPool]
  );
  return (
    <PoolSearchContext.Provider value={value}>
      {children}
    </PoolSearchContext.Provider>
  );
}

/**
 * Read the shared pool search. Returns null when used outside a provider, so
 * consumers can fall back to their own local state (keeps PoolDirectory usable
 * standalone).
 */
export function usePoolSearch(): PoolSearchValue | null {
  return useContext(PoolSearchContext);
}

/** The search input for the dashboard top bar. Writes into the shared context. */
export function PoolSearchBar({ className = "" }: { className?: string }) {
  const ctx = usePoolSearch();
  const router = useRouter();
  // Always call hooks before any early return (rules of hooks).
  const trimmed = (ctx?.query ?? "").trim();
  // A full, valid 0x address (any casing) enables direct navigation to the
  // pool's detail page. Partial input still just filters the list below.
  const isFullAddress = isAddress(trimmed, { strict: false });

  const goToPool = () => {
    if (!isFullAddress) return;
    const checksummed = getAddress(trimmed);
    // If the entered address is a known POOL or TOKEN address, use its resolved
    // pool address; otherwise navigate to the entered address as-is (the detail
    // page will surface a clean error if it isn't a real pool).
    const resolved = ctx?.addressToPool[checksummed.toLowerCase()] ?? checksummed;
    router.push(`/pool/${resolved}`);
  };

  if (!ctx) return null;
  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
        className="absolute left-3 top-1/2 -translate-y-1/2 text-lo pointer-events-none"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={ctx.query}
        onChange={(e) => ctx.setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter on a full address navigates straight to that pool.
          if (e.key === "Enter" && isFullAddress) {
            e.preventDefault();
            goToPool();
          }
        }}
        placeholder="Search pool by contract address…"
        aria-label="Search pools by contract address"
        spellCheck={false}
        className="h-10 w-56 md:w-72 max-w-[60vw] pl-9 pr-14 rounded-xl text-sm text-hi
                   bg-black/[0.03] border border-black/10 outline-none
                   focus:border-gold-neon/60 transition-colors placeholder:text-lo/70"
      />
      {/* "Go" appears only when the input is a full valid address; clicking it
          (or pressing Enter) opens that pool's detail page. */}
      {isFullAddress && (
        <button
          type="button"
          onClick={goToPool}
          title="Open this pool"
          aria-label="Open this pool"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 px-2.5 rounded-lg
                     text-[11px] font-semibold text-white cursor-pointer
                     transition-transform hover:opacity-95 active:scale-[0.98]"
          style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
        >
          Go
        </button>
      )}
    </div>
  );
}
