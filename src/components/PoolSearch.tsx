import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { isAddress } from "viem";
import { listPools, type PoolSummary } from "@/lib/factoryClient";
import { readLocalPools } from "@/lib/localPools";
import { isMockPoolAddress } from "@/lib/mockPools";
import { networkByChainId } from "@/lib/evmNetworks";

/**
 * Search live + local pools by contract (pool or token) address.
 * A match is a link to that pool's dashboard.
 */
export function PoolSearch() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "searching" | "done">("idle");
  const [hits, setHits] = useState<PoolSummary[]>([]);
  const [error, setError] = useState("");

  const trimmed = query.trim();
  const looksValid = isAddress(trimmed, { strict: false });

  const hint = useMemo(() => {
    if (!trimmed) return "Search pools by contract address";
    if (!looksValid) return "Enter a 0x pool or token address";
    return "";
  }, [trimmed, looksValid]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setHits([]);
    if (!looksValid) {
      setError("That’s not a valid 0x address.");
      setStatus("done");
      return;
    }
    setStatus("searching");
    const needle = trimmed.toLowerCase();
    try {
      const [onchain, local] = await Promise.all([listPools(), Promise.resolve(readLocalPools())]);
      const all = [...local, ...onchain];
      const found = all.filter(
        (p) =>
          !p.demo &&
          !isMockPoolAddress(p.pool) &&
          (p.pool.toLowerCase() === needle || p.token.toLowerCase() === needle),
      );
      const seen = new Set<string>();
      const unique = found.filter((p) => {
        const k = `${p.chainId}:${p.pool.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setHits(unique);
      if (unique.length === 0) setError("No pool at that address on listed factories.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setStatus("done");
    }
  }

  return (
    <form onSubmit={runSearch} className="relative w-full max-w-md" data-testid="pool-search">
      <label className="sr-only" htmlFor="pool-search-input">
        Search pools by contract address
      </label>
      <div className="flex items-center gap-2">
        <input
          id="pool-search-input"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setStatus("idle");
            setError("");
            setHits([]);
          }}
          placeholder="Search by contract address (0x…)"
          className="input-term !h-10 !py-0 flex-1 text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={status === "searching"}
          className="h-10 px-4 rounded-xl text-xs font-semibold text-white border-none disabled:opacity-50"
          style={{ background: "linear-gradient(180deg, #22c55e, #16a34a)" }}
        >
          {status === "searching" ? "…" : "Search"}
        </button>
      </div>
      {hint && status === "idle" && (
        <p className="label-term !text-[9px] !normal-case !tracking-normal mt-1">{hint}</p>
      )}
      {error && (
        <p className="mt-1.5 text-[11px] text-red-500" role="status">
          {error}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="mt-1.5 rounded-xl border border-black/10 bg-[rgba(255,255,255,0.96)] shadow-lg overflow-hidden">
          {hits.map((p) => {
            const net = networkByChainId(p.chainId);
            const title = p.symbol ? `${p.symbol} Pool` : "Staking Pool";
            return (
              <li key={`${p.chainId}:${p.pool}`}>
                <Link
                  to="/pool/$chainId/$address"
                  params={{ chainId: String(p.chainId), address: p.pool }}
                  className="flex items-center justify-between gap-2 px-3 h-10 text-[12px] font-semibold text-hi hover:bg-black/[0.04]"
                >
                  <span className="truncate">{title}</span>
                  <span className="label-term !text-[8px] shrink-0">{net?.short ?? p.chainId}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
