import { useAccount } from "wagmi";
import { useChain } from "@/components/ChainProvider";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";

/** Connected wallet for the selected family (EVM via wagmi, Solana via adapter). */
export function useConnectedAccount() {
  const { family } = useChain();
  const sol = useSolanaWallet();
  const { address, isConnected } = useAccount();

  if (family === "solana") {
    return {
      family,
      address: sol.address ?? null,
      connected: sol.connected,
    };
  }

  return {
    family,
    address: address ?? null,
    connected: isConnected,
  };
}
