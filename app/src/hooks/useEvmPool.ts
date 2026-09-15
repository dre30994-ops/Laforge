"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useConfig } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { robinhoodChain } from "@/lib/chains";
import {
  fetchEvmPosition,
  stakeToPool,
  unstakeFromPool,
  claimFromPool,
  crankPool,
  withdrawTreasuryOf,
  waitForPoolTx,
  type EvmPoolPosition,
} from "@/lib/poolClient";

export type PoolTxStatus = "idle" | "preparing" | "signing" | "confirming" | "success" | "error";

export interface PoolTxState {
  status: PoolTxStatus;
  txHash: string | null;
  error: string | null;
}

const EMPTY_POSITION: EvmPoolPosition = {
  staked: BigInt(0),
  pending: BigInt(0),
  totalClaimed: BigInt(0),
  walletBalance: BigInt(0),
  weightedDepositTs: BigInt(0),
  hasPosition: false,
  minStake: BigInt(0),
  paused: false,
  started: false,
  fundedAmount: BigInt(0),
  totalEmitted: BigInt(0),
  poolTotalClaimed: BigInt(0),
  startTs: BigInt(0),
  endTs: BigInt(0),
  lastUpdateTs: BigInt(0),
  owedToTreasury: BigInt(0),
  treasury: "0x0000000000000000000000000000000000000000",
  operator: "0x0000000000000000000000000000000000000000",
  baseRatePerPeriod: BigInt(0),
  totalWeight: BigInt(0),
};

/** How often to re-read the on-chain position while connected (ms). */
const POLL_INTERVAL_MS = 30_000;

/**
 * Chain-aware access to a single EVM StakingPool: reads the connected wallet's
 * position and sends stake / unstake / claim transactions.
 *
 * `tokenAddress` is the pool's staking/reward ERC-20 (needed for the stake
 * approval). It comes from the pool summary the detail page already loads.
 */
export function useEvmPool(poolAddress: string, tokenAddress: string) {
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();

  const [position, setPosition] = useState<EvmPoolPosition>(EMPTY_POSITION);
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState<PoolTxState>({ status: "idle", txHash: null, error: null });

  // Guard against setState after unmount (long-running txs).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const enabled = isConnected && !!address && !!poolAddress;

  const refetch = useCallback(async () => {
    if (!address || !poolAddress) {
      setPosition(EMPTY_POSITION);
      return;
    }
    setLoading(true);
    try {
      const p = await fetchEvmPosition(poolAddress, address);
      if (mounted.current) setPosition(p);
    } catch {
      if (mounted.current) setPosition(EMPTY_POSITION);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [address, poolAddress]);

  // Initial + polling reads (deferred so no synchronous setState in the effect).
  useEffect(() => {
    let cancelled = false;
    const kick = setTimeout(() => {
      if (cancelled) return;
      if (!enabled) {
        setPosition(EMPTY_POSITION);
        return;
      }
      void refetch();
    }, 0);
    const id = enabled ? setInterval(() => void refetch(), POLL_INTERVAL_MS) : undefined;
    return () => {
      cancelled = true;
      clearTimeout(kick);
      if (id) clearInterval(id);
    };
  }, [enabled, refetch]);

  /** Ensure a connected wallet on Robinhood Chain, return a viem WalletClient. */
  const getWallet = useCallback(async () => {
    if (!isConnected) {
      const phantom = connectors.find((c) => /phantom/i.test(c.name) || /phantom/i.test(c.id));
      const injected = connectors.find((c) => c.type === "injected");
      const target = phantom ?? injected ?? connectors[0];
      if (!target) {
        throw new Error("No EVM wallet available. Install a wallet (e.g. Phantom or MetaMask) and retry.");
      }
      await connectAsync({ connector: target });
    }
    await switchChain(config, { chainId: robinhoodChain.id });
    const walletClient = await getWalletClient(config, { chainId: robinhoodChain.id });
    if (!walletClient) throw new Error("Could not obtain a wallet client.");
    return walletClient;
  }, [config, isConnected, connectAsync, connectors]);

  /** Shared tx runner: preparing → signing → confirming → success/error. */
  const run = useCallback(
    async (
      action: (wc: Awaited<ReturnType<typeof getWallet>>) => Promise<{ txHash: string }>
    ): Promise<boolean> => {
      setTx({ status: "preparing", txHash: null, error: null });
      try {
        const wc = await getWallet();
        setTx({ status: "signing", txHash: null, error: null });
        const { txHash } = await action(wc);
        setTx({ status: "confirming", txHash, error: null });
        const ok = await waitForPoolTx(txHash);
        if (!ok) {
          if (mounted.current) setTx({ status: "error", txHash, error: "Transaction reverted." });
          return false;
        }
        if (mounted.current) setTx({ status: "success", txHash, error: null });
        void refetch();
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Transaction failed.";
        if (mounted.current) setTx({ status: "error", txHash: null, error: msg });
        return false;
      }
    },
    [getWallet, refetch]
  );

  const stake = useCallback(
    (amount: bigint) =>
      run((wc) => stakeToPool(wc, poolAddress, tokenAddress, amount)),
    [run, poolAddress, tokenAddress]
  );

  const unstake = useCallback(
    (amount: bigint) => run((wc) => unstakeFromPool(wc, poolAddress, amount)),
    [run, poolAddress]
  );

  const claim = useCallback(
    () => run((wc) => claimFromPool(wc, poolAddress)),
    [run, poolAddress]
  );

  const crank = useCallback(
    () => run((wc) => crankPool(wc, poolAddress)),
    [run, poolAddress]
  );

  const withdrawTreasury = useCallback(
    () => run((wc) => withdrawTreasuryOf(wc, poolAddress)),
    [run, poolAddress]
  );

  const reset = useCallback(() => setTx({ status: "idle", txHash: null, error: null }), []);

  // ── Opt-in auto-claim ──────────────────────────────────────────────────
  // The StakingPool contract cannot PUSH rewards; tokens only move on a
  // staker-signed claim/unstake. So "auto-claim" here means: while enabled, the
  // app periodically cranks + claims ON THE STAKER'S BEHALF — each claim still
  // needs a wallet signature and costs gas. It is off by default and persisted
  // per pool. This removes the manual step, not the signature/gas.
  const autoKey = `forge.autoClaim.${poolAddress.toLowerCase()}`;
  const [autoClaim, setAutoClaimState] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      try {
        setAutoClaimState(window.localStorage.getItem(autoKey) === "1");
      } catch {
        /* ignore */
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [autoKey]);
  const setAutoClaim = useCallback(
    (on: boolean) => {
      setAutoClaimState(on);
      try {
        window.localStorage.setItem(autoKey, on ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [autoKey]
  );

  // Periodically claim when enabled and there is something to claim. Guarded so
  // only one claim is in flight at a time and it never fires while another tx
  // is running.
  const autoBusy = useRef(false);
  useEffect(() => {
    if (!autoClaim || !enabled) return;
    const id = setInterval(async () => {
      if (autoBusy.current) return;
      const busyNow =
        tx.status === "preparing" || tx.status === "signing" || tx.status === "confirming";
      if (busyNow) return;
      if (position.pending <= BigInt(0)) return;
      autoBusy.current = true;
      try {
        await claim();
      } finally {
        autoBusy.current = false;
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [autoClaim, enabled, position.pending, tx.status, claim]);

  return {
    connected: isConnected,
    address: address ?? null,
    enabled,
    loading,
    position,
    tx,
    stake,
    unstake,
    claim,
    crank,
    withdrawTreasury,
    autoClaim,
    setAutoClaim,
    refetch,
    reset,
    connect: getWallet,
  };
}
