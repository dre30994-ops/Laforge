import { getAddress, isAddress } from "viem";
import type { EvmNetwork } from "@/lib/evmNetworks";

export type AddressCheck = {
  ok: boolean;
  error?: string;
  warning?: string;
};

export function checkEvmAddress(raw: string, network: EvmNetwork): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false };

  if (looksLikeSolana(value)) {
    return {
      ok: false,
      error: `That looks like a Solana address. ${network.short} uses EVM addresses that start with 0x.`,
    };
  }

  if (!value.startsWith("0x") && !value.startsWith("0X")) {
    return {
      ok: false,
      error: `This isn’t a valid ${network.short} address. Paste a 0x address (${network.addressHint})`,
    };
  }

  if (value.length !== 42) {
    return {
      ok: false,
      error: `This isn’t a valid ${network.short} address. Expected 42 characters (0x + 40 hex), got ${value.length}.`,
    };
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return {
      ok: false,
      error: `This isn’t a valid ${network.short} address. Use hexadecimal characters 0–9 and a–f only.`,
    };
  }

  if (!isAddress(value, { strict: false })) {
    return { ok: false, error: `Invalid ${network.short} address.` };
  }

  try {
    const checksummed = getAddress(value);
    if (value !== value.toLowerCase() && value !== checksummed) {
      return {
        ok: true,
        warning: `Checksum doesn’t match this ${network.short} address. Did you mean ${checksummed}?`,
      };
    }
  } catch {
    return { ok: false, error: `Invalid ${network.short} checksum.` };
  }

  return { ok: true };
}

function looksLikeSolana(value: string): boolean {
  return !value.startsWith("0x") && !value.startsWith("0X") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
