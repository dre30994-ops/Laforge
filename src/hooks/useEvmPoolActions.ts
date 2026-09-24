import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import {
  claimFromPool,
  stakeIntoPool,
  unstakeFromPool,
  type PoolSummary,
} from "@/lib/factoryClient";
import type { EvmNetwork } from "@/lib/evmNetworks";
import { shortAddress } from "@/lib/brand";
import {
  applyMockClaim,
  applyMockStake,
  applyMockUnstake,
  isMockPoolAddress,
  MOCK_DEMO_USER,
} from "@/lib/mockPools";
import { emitPoolsChanged } from "@/lib/poolEvents";
import { recordActivity, upsertUserStake } from "@/lib/userLedger";

type Status = "idle" | "pending" | "done" | "error";

export function useEvmPoolActions(pool: PoolSummary, network: EvmNetwork) {
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  const mock = isMockPoolAddress(pool.pool);
  const user = address || MOCK_DEMO_USER;

  const parseAmount = useCallback(
    (raw: string): bigint => {
      const trimmed = raw.trim();
      if (!trimmed) return 0n;
      return parseUnits(trimmed, pool.decimals || 18);
    },
    [pool.decimals],
  );

  const ensureWallet = useCallback(async () => {
    if (mock) return null;
    if (!isConnected) throw new Error("Connect an EVM wallet to use this pool.");
    if (chainId !== network.chain.id) {
      await switchChain(config, { chainId: network.chain.id });
    }
    const walletClient = await getWalletClient(config, { chainId: network.chain.id });
    if (!walletClient) throw new Error("Could not obtain a wallet client.");
    return walletClient;
  }, [mock, isConnected, chainId, network.chain.id, config]);

  const run = useCallback(
    async (fn: () => Promise<string | void>, ok: string) => {
      setStatus("pending");
      setMessage("");
      setTxHash("");
      try {
        const hash = await fn();
        if (typeof hash === "string" && hash) setTxHash(hash);
        setStatus("done");
        setMessage(ok);
        emitPoolsChanged();
      } catch (e: unknown) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Transaction failed.");
      }
    },
    [],
  );

  const taxDest =
    pool.treasury && pool.treasury !== "0x0000000000000000000000000000000000000000"
      ? shortAddress(pool.treasury)
      : null;
  const taxNote = taxDest
    ? ` Tax (if any) is released to the pool treasury ${taxDest}.`
    : " This pool has no treasury, so stake/unstake tax is 0.";

  const note = useCallback(
    (kind: "stake" | "unstake" | "claim", amount: string, txHash: string) => {
      if (!address) return;
      recordActivity({
        address,
        kind,
        pool: pool.pool,
        token: pool.token,
        chainId: pool.chainId,
        symbol: pool.symbol,
        amount: amount || "—",
        txHash,
      });
      if (kind !== "claim") {
        upsertUserStake({
          address,
          pool: pool.pool,
          token: pool.token,
          chainId: pool.chainId,
          symbol: pool.symbol,
          amount: amount || "0",
          active: kind === "stake",
        });
      }
    },
    [address, pool],
  );

  const stake = useCallback(
    async (raw: string) => {
      const amount = parseAmount(raw);
      if (amount <= 0n) {
        setStatus("error");
        setMessage("Enter an amount to stake.");
        return;
      }
      await run(async () => {
        if (mock) {
          applyMockStake(pool.chainId, pool.pool, amount, user);
          return;
        }
        const wallet = await ensureWallet();
        if (!wallet) throw new Error("Connect an EVM wallet to stake.");
        const hash = await stakeIntoPool(wallet, pool, network, amount);
        note("stake", raw, hash);
        return hash;
      }, `Stake confirmed.${taxNote}`);
    },
    [parseAmount, run, mock, pool, user, ensureWallet, network, taxNote, note],
  );

  const unstake = useCallback(
    async (raw: string) => {
      const amount = parseAmount(raw);
      if (amount <= 0n) {
        setStatus("error");
        setMessage("Enter an amount to unstake.");
        return;
      }
      await run(async () => {
        if (mock) {
          applyMockUnstake(pool.chainId, pool.pool, amount, user);
          return;
        }
        const wallet = await ensureWallet();
        if (!wallet) throw new Error("Connect an EVM wallet to unstake.");
        const hash = await unstakeFromPool(wallet, pool, network, amount);
        note("unstake", raw, hash);
        return hash;
      }, `Unstake confirmed.${taxNote}`);
    },
    [parseAmount, run, mock, pool, user, ensureWallet, network, taxNote, note],
  );

  const claim = useCallback(async () => {
    await run(async () => {
      if (mock) {
        applyMockClaim(pool.chainId, pool.pool, user);
        return;
      }
      const wallet = await ensureWallet();
      if (!wallet) throw new Error("Connect an EVM wallet to claim.");
      const hash = await claimFromPool(wallet, pool, network);
      note("claim", "", hash);
      return hash;
    }, "Claim confirmed.");
  }, [run, mock, pool, user, ensureWallet, network, note]);

  return {
    mock,
    status,
    message,
    txHash,
    stake,
    unstake,
    claim,
    connected: mock || isConnected,
    address: mock ? user : address,
  };
}
