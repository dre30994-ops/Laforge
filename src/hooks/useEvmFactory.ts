import { useCallback } from "react";
import { useAccount, useConnect, useConfig } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { useChain } from "@/components/ChainProvider";
import {
  createPool as sendCreatePool,
  type CreatePoolInputs,
  type CreatePoolResult,
} from "@/lib/factoryClient";

export type EvmFactoryState = {
  ready: boolean;
  address: string | null;
  createPool: (inputs: CreatePoolInputs) => Promise<CreatePoolResult>;
};

/**
 * Chain-aware access to the EVM StakingFactory for the *currently selected*
 * launch network. Refuses to send if the wallet cannot switch onto that chain
 * — so an Ethereum wallet cannot create a BNB Chain pool.
 */
export function useEvmFactory(): EvmFactoryState {
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { network, family } = useChain();

  const createPool = useCallback(
    async (inputs: CreatePoolInputs): Promise<CreatePoolResult> => {
      if (family === "solana") {
        throw new Error("Switch to an EVM network to create a pool.");
      }

      if (!isConnected) {
        const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
        if (!injected) {
          throw new Error("No EVM wallet available. Install a wallet (e.g. MetaMask) and retry.");
        }
        await connectAsync({ connector: injected });
      }

      if (chainId !== network.chain.id) {
        try {
          await switchChain(config, { chainId: network.chain.id });
        } catch {
          throw new Error(
            `Switch your wallet to ${network.label} to create a pool there. A ${network.nativeSymbol} fee is charged on that chain only.`,
          );
        }
      }

      const walletClient = await getWalletClient(config, { chainId: network.chain.id });
      if (!walletClient) {
        throw new Error("Could not obtain a wallet client. Connect an EVM wallet first.");
      }

      const liveChain = walletClient.chain?.id ?? (await walletClient.getChainId());
      if (liveChain !== network.chain.id) {
        throw new Error(
          `Wallet is still on another network. Approve the switch to ${network.label} to create this pool.`,
        );
      }

      return sendCreatePool(walletClient, inputs, network);
    },
    [config, isConnected, connectAsync, connectors, chainId, network, family],
  );

  return { ready: isConnected && family === "evm", address: address ?? null, createPool };
}
