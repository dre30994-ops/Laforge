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
import {
  applyMockClaim,
  applyMockStake,
  applyMockUnstake,
  isMockPoolAddress,
  MOCK_DEMO_USER,
} from "@/lib/mockPools";
import { emitPoolsChanged } from "@/lib/poolEvents";

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
        return stakeIntoPool(wallet, pool, network, amount);
      }, "Stake confirmed. Tax is sent to the treasury if this pool has one.");
    },
    [parseAmount, run, mock, pool, user, ensureWallet, network],
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
        return unstakeFromPool(wallet, pool, network, amount);
      }, "Unstake confirmed. Tax is sent to the treasury if this pool has one.");
    },
    [parseAmount, run, mock, pool, user, ensureWallet, network],
  );

  const claim = useCallback(async () => {
    await run(async () => {
      if (mock) {
        applyMockClaim(pool.chainId, pool.pool, user);
        return;
      }
      const wallet = await ensureWallet();
      if (!wallet) throw new Error("Connect an EVM wallet to claim.");
      return claimFromPool(wallet, pool, network);
    }, "Claim confirmed.");
  }, [run, mock, pool, user, ensureWallet, network]);

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
