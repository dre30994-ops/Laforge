import { useEffect, useRef } from "react";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { registerPrivyEthereumProvider, PRIVY_CONNECTOR_ID } from "@/lib/privyConnector";

/** After an X login, create a Privy embedded wallet if needed and attach it to wagmi. */
export function PrivyWagmiSync() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { isConnected, address } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const last = useRef<string | null>(null);
  const creating = useRef(false);

  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];

  useEffect(() => {
    if (!ready || !authenticated || wallet || creating.current) return;
    creating.current = true;
    void createWallet()
      .catch(() => {
        /* already has a wallet, or creation was skipped in the Privy dashboard */
      })
      .finally(() => {
        creating.current = false;
      });
  }, [ready, authenticated, wallet, createWallet]);

  useEffect(() => {
    if (!wallet) {
      registerPrivyEthereumProvider(null);
      return;
    }
    registerPrivyEthereumProvider(
      () =>
        wallet.getEthereumProvider() as Promise<{
          request: (args: { method: string; params?: unknown }) => Promise<unknown>;
        }>,
    );
  }, [wallet]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !wallet) {
      if (last.current && isConnected) {
        last.current = null;
        void disconnectAsync();
      }
      return;
    }
    if (isConnected && address?.toLowerCase() === wallet.address.toLowerCase()) {
      last.current = wallet.address;
      return;
    }
    const connector =
      connectors.find((c) => c.id === PRIVY_CONNECTOR_ID) ?? connectors.find((c) => c.type === "privy");
    if (!connector) return;
    last.current = wallet.address;
    void connectAsync({ connector }).catch(() => {
      last.current = null;
    });
  }, [ready, authenticated, wallet, isConnected, address, connectAsync, connectors, disconnectAsync]);

  return null;
}
