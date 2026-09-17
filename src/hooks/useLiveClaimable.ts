import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  approximatePending,
  fetchClaimableSnapshot,
  formatClaimable,
  type ClaimableSnapshot,
} from "@/lib/liveClaimable";
import { networkByChainId } from "@/lib/evmNetworks";

export function useLiveClaimable(pool?: string, chainId?: number) {
  const { address, isConnected } = useAccount();
  const [snap, setSnap] = useState<ClaimableSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const network = networkByChainId(chainId);
    if (!isConnected || !address || !pool || !network) {
      setSnap(null);
      return;
    }
    const user = address;
    const poolAddr = pool;
    const net = network;

    async function load() {
      const id = ++reqId.current;
      setLoading(true);
      const next = await fetchClaimableSnapshot(poolAddr, user, net);
      if (cancelled || id !== reqId.current) return;
      if (next) setSnap(next);
      setLoading(false);
    }

    const start = window.setTimeout(() => {
      if (!cancelled) void load();
    }, 0);

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);

    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [isConnected, address, pool, chainId]);

  const hasStake = !!snap && snap.amount > 0n;
  const pending = snap ? approximatePending(snap, now) : 0n;
  const display = snap ? formatClaimable(pending, snap.decimals) : "0.00";
  const stakedDisplay = snap ? formatClaimable(snap.amount, snap.decimals) : "0.00";

  return {
    connected: isConnected,
    hasStake,
    pending,
    display,
    stakedDisplay,
    decimals: snap?.decimals ?? 18,
    loading,
  };
}
