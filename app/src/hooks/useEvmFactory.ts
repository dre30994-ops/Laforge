"use client";

import { useCallback } from "react";
import { useAccount, useConnect, useConfig } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { robinhoodChain } from "@/lib/chains";
import {
  createPool as sendCreatePool,
  type CreatePoolInputs,
  type CreatePoolResult,
} from "@/lib/factoryClient";

export type EvmFactoryState = {
  /** True when an EVM wallet is connected and ready to send. */
  ready: boolean;
  /** The connected EVM wallet address, or null. */
  address: string | null;
  /** Launch a pool via StakingFactory.createPool on Robinhood Chain. */
  createPool: (inputs: CreatePoolInputs) => Promise<CreatePoolResult>;
};

/**
 * Chain-aware access to the EVM StakingFactory, backed by wagmi + viem.
 *
 * `createPool` ensures the wallet is on Robinhood Chain, obtains a viem
 * WalletClient from the active wagmi connector, and delegates to the factory
 * client (which handles the funding approval + createPool tx). Preserves the
 * previous `EvmFactoryState` shape so callers are unchanged.
 *
 * NOTE: the app currently launches pools on Robinhood Chain (matching the chain
 * toggle). Multi-chain pool creation (Base/BSC/Arbitrum/…) is a follow-up that
 * plugs a per-chain factory address + target chain into this same flow.
 */
export function useEvmFactory(): EvmFactoryState {
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();

  const createPool = useCallback(
    async (inputs: CreatePoolInputs): Promise<CreatePoolResult> => {
      // Connect a wallet if none is connected yet. Prefer Phantom when present
      // (EIP-6963 exposes each installed wallet as its own connector).
      if (!isConnected) {
        const phantom = connectors.find((c) => /phantom/i.test(c.name) || /phantom/i.test(c.id));
        const injected = connectors.find((c) => c.type === "injected");
        const target = phantom ?? injected ?? connectors[0];
        if (!target) {
          throw new Error("No EVM wallet available. Install a wallet (e.g. Phantom or MetaMask) and retry.");
        }
        await connectAsync({ connector: target });
      }

      // Ensure the wallet is on Robinhood Chain, then get a viem WalletClient.
      await switchChain(config, { chainId: robinhoodChain.id });
      const walletClient = await getWalletClient(config, { chainId: robinhoodChain.id });
      if (!walletClient) {
        throw new Error("Could not obtain a wallet client. Connect an EVM wallet first.");
      }

      return sendCreatePool(walletClient, inputs);
    },
    [config, isConnected, connectAsync, connectors]
  );

  return { ready: isConnected, address: address ?? null, createPool };
}
