import { network } from "hardhat";

const BRONZE_FEE = 10_000_000_000_000_000n;
const ECOSYSTEM_FEE = 30_000_000_000_000_000n;
const MARKETING_FEE = 60_000_000_000_000_000n;

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const feeRecipient = process.env.FEE_RECIPIENT ?? deployer.account.address;

  const factory = await viem.deployContract("StakingFactory", [
    BRONZE_FEE,
    ECOSYSTEM_FEE,
    MARKETING_FEE,
    feeRecipient,
  ]);

  console.log("Deployer       ", deployer.account.address);
  console.log("Fee recipient  ", feeRecipient);
  console.log("StakingFactory ", factory.address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
