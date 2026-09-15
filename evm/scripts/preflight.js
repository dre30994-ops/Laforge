// Read-only preflight: confirm the Robinhood testnet RPC is reachable, the
// chain id matches, and report the deployer address + balance IF a key is set.
// Sends NO transactions.
const { ethers, network } = require("hardhat");

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(`network name:   ${network.name}`);
  console.log(`chainId (rpc):  ${net.chainId}`);

  const block = await ethers.provider.getBlockNumber();
  console.log(`latest block:   ${block}`);

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    console.log("deployer:       (none — set DEPLOYER_KEY in evm/.env to deploy)");
    return;
  }
  const dep = signers[0];
  const bal = await ethers.provider.getBalance(dep.address);
  console.log(`deployer:       ${dep.address}`);
  console.log(`balance:        ${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) {
    console.log("⚠ deployer has 0 ETH — fund it from the testnet faucet before deploying.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
