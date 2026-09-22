// Deploy a CHEAP-FEE StakingFactory + a mintable MockERC20 for client-side
// (browser wallet) testing on a testnet. Prints the values to wire into the
// frontend (.env.local).
//
//   Set the wallet you'll connect in the browser so it receives test tokens:
//     Set-Item -Path env:MINT_TO -Value '0xYourBrowserWallet'
//     npx hardhat run scripts/deploy-cheap.js --network robinhoodTestnet
//
// Fees default to 0.0001 / 0.0003 / 0.0006 ETH (override via BRONZE_FEE/…).
// TEST ONLY — the production deploy uses scripts/deploy.js with real fees.
const { ethers, network } = require("hardhat");

const BRONZE_FEE = BigInt(process.env.BRONZE_FEE ?? "100000000000000"); // 0.0001
const ECOSYSTEM_FEE = BigInt(process.env.ECOSYSTEM_FEE ?? "300000000000000"); // 0.0003
const MARKETING_FEE = BigInt(process.env.MARKETING_FEE ?? "600000000000000"); // 0.0006
const FEE_RECIPIENT = process.env.FEE_RECIPIENT || "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13";

const DECIMALS = 18; // most Base/BSC tokens use 18; matches real-world tokens
const UNIT = 10n ** BigInt(DECIMALS);
const MINT_AMOUNT = 1_000_000_000n * UNIT; // 1B test tokens per token

// Six distinct test tokens so you can launch six separate pools (one pool per
// token). Names/symbols only differ cosmetically.
const TOKENS = [
  { name: "Test Stake Token Alpha", symbol: "TALPHA" },
  { name: "Test Stake Token Bravo", symbol: "TBRAVO" },
  { name: "Test Stake Token Charlie", symbol: "TCHARLIE" },
  { name: "Test Stake Token Delta", symbol: "TDELTA" },
  { name: "Test Stake Token Echo", symbol: "TECHO" },
  { name: "Test Stake Token Foxtrot", symbol: "TFOX" },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer — set DEPLOYER_KEY in evm/.env.");
  const mintTo = process.env.MINT_TO || deployer.address;

  console.log(`\n[${network.name}] deployer ${deployer.address}`);
  console.log(`fees: bronze=${BRONZE_FEE} ecosystem=${ECOSYSTEM_FEE} marketing=${MARKETING_FEE} wei`);
  console.log(`mint test tokens to: ${mintTo}\n`);

  // Deploy the factory first.
  const Factory = await ethers.getContractFactory("StakingFactory", deployer);
  const factory = await Factory.deploy(BRONZE_FEE, ECOSYSTEM_FEE, MARKETING_FEE, FEE_RECIPIENT, ethers.ZeroAddress);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`StakingFactory (cheap) deployed: ${factoryAddr}\n`);

  // Deploy + mint six distinct tokens.
  const Mock = await ethers.getContractFactory("MockERC20", deployer);
  const tokenAddrs = [];
  for (const t of TOKENS) {
    const token = await Mock.deploy(t.name, t.symbol, DECIMALS);
    await token.waitForDeployment();
    const addr = await token.getAddress();
    await (await token.mint(mintTo, MINT_AMOUNT)).wait();
    tokenAddrs.push({ symbol: t.symbol, addr });
    console.log(`  ${t.symbol.padEnd(9)} ${addr}  (minted ${MINT_AMOUNT / UNIT} to ${mintTo})`);
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`\n── Wire into app/.env.local ──`);
  console.log(`NEXT_PUBLIC_STAKING_FACTORY=${factoryAddr}`);
  console.log(`NEXT_PUBLIC_STAKING_FACTORY_${chainId}=${factoryAddr}`);
  console.log(`\n── Six test tokens to launch pools with (your wallet holds each) ──`);
  for (const t of tokenAddrs) console.log(`  ${t.symbol.padEnd(9)} ${t.addr}`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
