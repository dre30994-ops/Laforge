import { publicEnv } from "@/lib/publicEnv";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  associatedTokenAddress,
  computePending,
  fetchPool,
  fetchPosition,
  fetchTokenBalance,
  poolPda,
  positionPda,
  programId,
  stakingMint,
  type ParsedPool,
  type ParsedPosition,
} from "@/lib/stakingClient";
import { tenureMultiplierAfter } from "@/lib/economics";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";

const RPC_URL =
  publicEnv("RPC_URL") || "https://api.devnet.solana.com";

/** How often to re-read on-chain data while a wallet is connected (ms). */
const POLL_INTERVAL_MS = 30_000;

export interface PositionData {
  /** Staked principal, base units. 0 when no position. */
  staked: bigint;
  /** Wallet SPL balance of the staking mint, base units. */
  walletBalance: bigint;
  /** Exact unclaimed rewards (settled + accrued since last settlement), base units. */
  pending: bigint;
  /** Only the settled `pending_rewards` field on-chain, base units. */
  pendingSettled: bigint;
  /** Lifetime claimed, base units. */
  totalClaimed: bigint;
  /** Tenure multiplier (1.0x–2.0x) derived from weighted_deposit_ts. */
  tenureMultiplier: number;
  /** Whether a position account exists on-chain. */
  hasPosition: boolean;
  /** Pool lifecycle flags. */
  poolStarted: boolean;
  poolPaused: boolean;
}

const EMPTY: PositionData = {
  staked: BigInt(0),
  walletBalance: BigInt(0),
  pending: BigInt(0),
  pendingSettled: BigInt(0),
  totalClaimed: BigInt(0),
  tenureMultiplier: 1.0,
  hasPosition: false,
  poolStarted: false,
  poolPaused: false,
};

export interface UsePositionResult {
  data: PositionData;
  loading: boolean;
  error: string | null;
  /** Manually re-read on-chain state (e.g. after a successful transaction). */
  refetch: () => Promise<void>;
  /** True once a Solana wallet is connected and the mint is configured. */
  enabled: boolean;
}

/**
 * Read the connected wallet's on-chain staking position, pool state, and token
 * balance directly from Solana RPC (NEXT_PUBLIC_RPC_URL). This does NOT use a
 * wallet connection — reads are independent of the connected wallet.
 *
 * Behaviour:
 * - Fetches once when a wallet connects.
 * - Polls every POLL_INTERVAL_MS while connected (paused when the tab is
 *   hidden to avoid wasting RPC calls).
 * - Exposes `refetch()` to pull fresh state immediately after a transaction.
 */
export function usePosition(): UsePositionResult {
  const { connected, address } = useSolanaWallet();

  const [data, setData] = useState<PositionData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  // Whether we have everything needed to read (wallet + mint env var).
  const mintConfigured = !!publicEnv("STAKING_MINT");
  const enabled = connected && !!address && mintConfigured;

  // Guard against setting state after unmount / stale responses.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !address) {
      setData(EMPTY);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const pid = programId();
      const mint = stakingMint();
      const owner = new PublicKey(address);
      const pool = poolPda(mint, pid);
      const position = positionPda(pool, owner, pid);

      // Read pool first to learn the token program for the ATA.
      const parsedPool: ParsedPool | null = await fetchPool(connection, pool);
      const tokenProgram = parsedPool?.tokenProgram;
      const userAta = associatedTokenAddress(
        owner,
        mint,
        tokenProgram
      );

      const [parsedPosition, walletBalance]: [ParsedPosition | null, bigint] =
        await Promise.all([
          fetchPosition(connection, position),
          fetchTokenBalance(connection, userAta),
        ]);

      // Ignore if a newer request superseded this one.
      if (reqId !== reqIdRef.current) return;

      let tenureMultiplier = 1.0;
      let exactPending = parsedPosition?.pendingRewards ?? BigInt(0);
      if (parsedPosition && parsedPosition.amount > BigInt(0)) {
        const nowSec = Date.now() / 1000;
        const heldDays =
          Math.max(0, nowSec - Number(parsedPosition.weightedDepositTs)) / 86_400;
        tenureMultiplier = tenureMultiplierAfter(heldDays);

        // Exact live pending: settled + accrual since last settlement. Reads at
        // most one 16-byte Schedule checkpoint via RPC dataSlice.
        if (parsedPool) {
          try {
            exactPending = await computePending(connection, parsedPool, parsedPosition);
          } catch {
            // Fall back to the settled value if the checkpoint read fails.
            exactPending = parsedPosition.pendingRewards;
          }
          if (reqId !== reqIdRef.current) return;
        }
      }

      setData({
        staked: parsedPosition?.amount ?? BigInt(0),
        walletBalance,
        pending: exactPending,
        pendingSettled: parsedPosition?.pendingRewards ?? BigInt(0),
        totalClaimed: parsedPosition?.totalClaimed ?? BigInt(0),
        tenureMultiplier,
        hasPosition: !!parsedPosition,
        poolStarted: parsedPool?.started ?? false,
        poolPaused: parsedPool?.paused ?? false,
      });
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [enabled, address, connection]);

  // Fetch on connect / address change, and poll on an interval while visible.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled && document.visibilityState === "visible") void load();
    };

    // Defer the initial load so no setState runs synchronously inside the
    // effect body (avoids cascading renders). load() handles the disabled
    // case by resetting to EMPTY.
    const initial = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);

    if (!enabled) {
      return () => {
        cancelled = true;
        clearTimeout(initial);
      };
    }

    const id = setInterval(tick, POLL_INTERVAL_MS);

    // Refresh immediately when the tab regains focus.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  return { data, loading, error, refetch: load, enabled };
}
