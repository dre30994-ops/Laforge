// Deploy 6 MORE mintable test tokens and mint a large balance to MINT_TO
// (defaults to the deployer). Does NOT touch the factory.
//
//   Set-Item -Path env:MINT_TO -Value '0xYourWallet'   (optional)
//   npx hardhat run scripts/mint-more.js --network robinhoodTestnet
const { ethers, network } = require("hardhat");

const DECIMALS = 18;
const UNIT = 10n ** BigInt(DECIMALS);
const MINT_AMOUNT = 1_000_000_000n * UNIT; // 1B per token

// Second batch — distinct names/symbols from the first six.
const TOKENS = [
  { name: "Test Stake Token Golf", symbol: "TGOLF" },
  { name: "Test Stake Token Hotel", symbol: "THOTEL" },
  { name: "Test Stake Token India", symbol: "TINDIA" },
  { name: "Test Stake Token Juliet", symbol: "TJULIET" },
  { name: "Test Stake Token Kilo", symbol: "TKILO" },
  { name: "Test Stake Token Lima", symbol: "TLIMA" },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer — set DEPLOYER_KEY in evm/.env.");
  const mintTo = process.env.MINT_TO || deployer.address;

  console.log(`\n[${network.name}] deployer ${deployer.address}`);
  console.log(`minting 6 more test tokens to: ${mintTo}\n`);

  const Mock = await ethers.getContractFactory("MockERC20", deployer);
  const out = [];
  for (const t of TOKENS) {
    const token = await Mock.deploy(t.name, t.symbol, DECIMALS);
    await token.waitForDeployment();
    const addr = await token.getAddress();
    await (await token.mint(mintTo, MINT_AMOUNT)).wait();
    out.push({ symbol: t.symbol, addr });
    console.log(`  ${t.symbol.padEnd(9)} ${addr}  (minted ${MINT_AMOUNT / UNIT} to ${mintTo})`);
  }

  console.log(`\n── Six additional test tokens (your wallet holds each) ──`);
  for (const t of out) console.log(`  ${t.symbol.padEnd(9)} ${t.addr}`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
