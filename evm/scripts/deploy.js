// Deploy the StakingFactory to any supported EVM network.
//
//   npx hardhat run scripts/deploy.js --network base
//
// The factory's tier fees and fee recipient are immutable constructor args:
//   constructor(uint256 bronzeFee, uint256 ecosystemFee, uint256 marketingFee, address feeRecipient)
// Requirements enforced on-chain: bronzeFee != 0, strictly increasing
// (bronzeFee < ecosystemFee < marketingFee), and feeRecipient != address(0).
//
// This script selects the correct per-chain fees + recipient automatically from
// the Hardhat network name (see NETWORK_CONFIG below). Any value can still be
// overridden per-run via env vars: BRONZE_FEE / ECOSYSTEM_FEE / MARKETING_FEE
// (wei) and FEE_RECIPIENT (0x…).
const { ethers, network } = require("hardhat");

// Fee amounts in wei of each chain's NATIVE gas token.
const ETH_FEES = {
  bronze: 10_000_000_000_000_000n, // 0.01
  ecosystem: 30_000_000_000_000_000n, // 0.03
  marketing: 60_000_000_000_000_000n, // 0.06
};
const BNB_FEES = {
  bronze: 35_000_000_000_000_000n, // 0.035 BNB
  ecosystem: 100_000_000_000_000_000n, // 0.1 BNB
  marketing: 200_000_000_000_000_000n, // 0.2 BNB
};
const POL_FEES = {
  bronze: 260_000_000_000_000_000_000n, // 260 POL
  ecosystem: 782_000_000_000_000_000_000n, // 782 POL
  marketing: 1_565_000_000_000_000_000_000n, // 1565 POL
};

// Fee recipients.
const RECIPIENT_D196 = "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13";
const RECIPIENT_97CC = "0x97CCA3947a634A5327cB5Fe8c8DCb0f684E7d3a0";

// Per-network deployment config, keyed by the Hardhat network name. Testnets
// reuse their mainnet counterpart's fees/recipient.
const NETWORK_CONFIG = {
  // Ethereum — ETH, recipient 0xd196
  ethereum: { fees: ETH_FEES, recipient: RECIPIENT_D196, native: "ETH" },
  sepolia: { fees: ETH_FEES, recipient: RECIPIENT_D196, native: "ETH" },
  // Robinhood — ETH, recipient 0xd196
  robinhood: { fees: ETH_FEES, recipient: RECIPIENT_D196, native: "ETH" },
  robinhoodTestnet: { fees: ETH_FEES, recipient: RECIPIENT_D196, native: "ETH" },
  // Base — ETH, recipient 0xd196
  base: { fees: ETH_FEES, recipient: RECIPIENT_D196, native: "ETH" },
  baseSepolia: { fees: ETH_FEES, recipient: RECIPIENT_D196, native: "ETH" },
  // Arbitrum One — ETH, recipient 0x97CC
  arbitrum: { fees: ETH_FEES, recipient: RECIPIENT_97CC, native: "ETH" },
  arbitrumSepolia: { fees: ETH_FEES, recipient: RECIPIENT_97CC, native: "ETH" },
  // Optimism — ETH, recipient 0x97CC
  optimism: { fees: ETH_FEES, recipient: RECIPIENT_97CC, native: "ETH" },
  optimismSepolia: { fees: ETH_FEES, recipient: RECIPIENT_97CC, native: "ETH" },
  // BSC — BNB, recipient 0x97CC
  bsc: { fees: BNB_FEES, recipient: RECIPIENT_97CC, native: "BNB" },
  bscTestnet: { fees: BNB_FEES, recipient: RECIPIENT_97CC, native: "BNB" },
  // Polygon PoS — POL, recipient 0xd196
  polygon: { fees: POL_FEES, recipient: RECIPIENT_D196, native: "POL" },
  polygonAmoy: { fees: POL_FEES, recipient: RECIPIENT_D196, native: "POL" },
};

async function main() {
  const name = network.name;
  const cfg = NETWORK_CONFIG[name];
  if (!cfg && !process.env.BRONZE_FEE) {
    throw new Error(
      `No fee config for network "${name}". Add it to NETWORK_CONFIG in scripts/deploy.js ` +
        `or set BRONZE_FEE/ECOSYSTEM_FEE/MARKETING_FEE/FEE_RECIPIENT env vars.`
    );
  }

  // Env overrides win over the per-network config; otherwise use the map.
  const bronzeFee = process.env.BRONZE_FEE ? BigInt(process.env.BRONZE_FEE) : cfg.fees.bronze;
  const ecosystemFee = process.env.ECOSYSTEM_FEE ? BigInt(process.env.ECOSYSTEM_FEE) : cfg.fees.ecosystem;
  const marketingFee = process.env.MARKETING_FEE ? BigInt(process.env.MARKETING_FEE) : cfg.fees.marketing;
  const feeRecipient = process.env.FEE_RECIPIENT || cfg.recipient;
  const native = cfg ? cfg.native : "native";

  console.log(`Deploying StakingFactory to "${name}"…`);
  console.log(`  bronzeFee:    ${bronzeFee} wei`);
  console.log(`  ecosystemFee: ${ecosystemFee} wei`);
  console.log(`  marketingFee: ${marketingFee} wei  (${native}-denominated)`);
  console.log(`  feeRecipient: ${feeRecipient}`);

  const Factory = await ethers.getContractFactory("StakingFactory");
  const factory = await Factory.deploy(bronzeFee, ecosystemFee, marketingFee, feeRecipient, ethers.ZeroAddress);
  await factory.waitForDeployment();

  const addr = await factory.getAddress();
  console.log("\nStakingFactory deployed to:", addr);
  console.log("  BRONZE_FEE:   ", (await factory.BRONZE_FEE()).toString());
  console.log("  ECOSYSTEM_FEE:", (await factory.ECOSYSTEM_FEE()).toString());
  console.log("  MARKETING_FEE:", (await factory.MARKETING_FEE()).toString());
  console.log("  FEE_RECIPIENT:", await factory.FEE_RECIPIENT());
  console.log("  MAX_TAX_BPS:  ", (await factory.MAX_TAX_BPS()).toString());
  console.log(
    `\nSet the frontend factory address for chain ${
      (await ethers.provider.getNetwork()).chainId
    }:  NEXT_PUBLIC_STAKING_FACTORY_<chainId>=${addr}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
