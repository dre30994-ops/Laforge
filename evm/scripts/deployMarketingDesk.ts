import { network } from "hardhat";
import { getAddress, isAddress } from "viem";

/**
 * Deploy MarketingDesk without Ignition JSON parameters.
 * 0x factory addresses passed on the CLI are parsed as hex numbers (HHE10111).
 *
 * PowerShell:
 *   $env:FEE_RECIPIENT="0xYourTreasury"
 *   npx hardhat run scripts/deployMarketingDesk.ts --network robinhood
 *
 * FEE_RECIPIENT is the wallet that receives boosts — not the deployer.
 */

const ROBINHOOD_FACTORY = "0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691";
const SHARED_FACTORY = "0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f";
const ETH_FEE = 60_000_000_000_000_000n;

const BY_CHAIN: Record<number, { name: string; factory: string; fee: bigint; symbol: string }> = {
  4663: { name: "Robinhood", factory: ROBINHOOD_FACTORY, fee: ETH_FEE, symbol: "ETH" },
  1: { name: "Ethereum", factory: SHARED_FACTORY, fee: ETH_FEE, symbol: "ETH" },
  8453: { name: "Base", factory: SHARED_FACTORY, fee: ETH_FEE, symbol: "ETH" },
  56: { name: "BNB Smart Chain", factory: SHARED_FACTORY, fee: 200_000_000_000_000_000n, symbol: "BNB" },
  999: { name: "HyperEVM", factory: SHARED_FACTORY, fee: 1_850_000_000_000_000_000n, symbol: "HYPE" },
};

function formatNative(wei: bigint, symbol: string): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} ${symbol}` : `${whole} ${symbol}`;
}

async function main() {
  const raw = process.env.FEE_RECIPIENT?.trim() ?? "";
  if (!raw || !isAddress(raw)) {
    console.error(
      "Set FEE_RECIPIENT to the wallet that should receive Marketing boosts (a 0x address, not the deployer).",
    );
    console.error('PowerShell:  $env:FEE_RECIPIENT="0xYourTreasury"');
    process.exitCode = 1;
    return;
  }
  const feeRecipient = getAddress(raw);

  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const cfg = BY_CHAIN[chainId];
  if (!cfg) {
    console.error(`Unsupported chain id ${chainId}. Use robinhood, ethereum, base, bsc, or hyperevm.`);
    process.exitCode = 1;
    return;
  }

  const factory = process.env.FACTORY && isAddress(process.env.FACTORY)
    ? getAddress(process.env.FACTORY)
    : getAddress(cfg.factory);
  const fee = process.env.FEE ? BigInt(process.env.FEE) : cfg.fee;

  console.log("Network        ", `${cfg.name} (${chainId})`);
  console.log("Deployer       ", deployer.account.address, "  ← signs the tx, does not receive boosts");
  console.log("Fee recipient  ", feeRecipient, "  ← receives", formatNative(fee, cfg.symbol));
  console.log("Factory        ", factory);
  console.log("Fee            ", formatNative(fee, cfg.symbol));
  console.log("Deploying MarketingDesk…");

  const desk = await viem.deployContract("MarketingDesk", [fee, feeRecipient, factory]);

  console.log("MarketingDesk  ", desk.address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
