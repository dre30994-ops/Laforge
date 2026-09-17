import { createConnector } from "wagmi";
import { getAddress } from "viem";

type AnyProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

type ProviderFn = () => Promise<AnyProvider>;

let providerFn: ProviderFn | null = null;

export const PRIVY_CONNECTOR_ID = "io.privy.embedded";

export function registerPrivyEthereumProvider(fn: ProviderFn | null) {
  providerFn = fn;
}

export const privyEmbeddedConnector = createConnector((config) => ({
  id: PRIVY_CONNECTOR_ID,
  name: "Privy",
  type: "privy",
  async connect() {
    const provider = await requireProvider();
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    return {
      accounts: accounts.map((a) => getAddress(a)) as readonly `0x${string}`[],
      chainId: Number(chainIdHex),
    };
  },
  async disconnect() {
    config.emitter.emit("disconnect");
  },
  async getAccounts() {
    const provider = await requireProvider();
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return accounts.map((a) => getAddress(a)) as readonly `0x${string}`[];
  },
  async getChainId() {
    const provider = await requireProvider();
    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    return Number(chainIdHex);
  },
  async getProvider() {
    return requireProvider();
  },
  async isAuthorized() {
    try {
      const provider = await requireProvider();
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      return accounts.length > 0;
    } catch {
      return false;
    }
  },
  onAccountsChanged(accounts: string[]) {
    if (accounts.length === 0) config.emitter.emit("disconnect");
    else
      config.emitter.emit("change", {
        accounts: accounts.map((a: string) => getAddress(a)) as readonly `0x${string}`[],
      });
  },
  onChainChanged(chain: string) {
    config.emitter.emit("change", { chainId: Number(chain) });
  },
  onDisconnect() {
    config.emitter.emit("disconnect");
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any);


async function requireProvider(): Promise<AnyProvider> {
  if (!providerFn) throw new Error("Privy wallet is not ready.");
  return providerFn();
}
