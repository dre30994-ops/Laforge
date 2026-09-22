import { network } from "hardhat";
import { getAddress, isAddress } from "viem";

const BRONZE_FEE = 10_000_000_000_000_000n;
const ECOSYSTEM_FEE = 30_000_000_000_000_000n;
const MARKETING_FEE = 60_000_000_000_000_000n;

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const raw = process.env.FEE_RECIPIENT?.trim() ?? "";
  if (!raw || !isAddress(raw)) {
    console.error(
      "Set FEE_RECIPIENT to the treasury that should receive launch fees (a 0x address).",
    );
    console.error("Do not use the deployer wallet.");
    console.error('PowerShell:  $env:FEE_RECIPIENT="0xYourTreasury"');
    process.exitCode = 1;
    return;
  }
  const feeRecipient = getAddress(raw);
  if (feeRecipient.toLowerCase() === deployer.account.address.toLowerCase()) {
    console.error("FEE_RECIPIENT cannot be the deployer. Use the treasury wallet.");
    process.exitCode = 1;
    return;
  }

  const membershipRaw = process.env.MEMBERSHIP_TOKEN?.trim() ?? "";
  const membershipToken =
    membershipRaw && isAddress(membershipRaw)
      ? getAddress(membershipRaw)
      : "0x0000000000000000000000000000000000000000";

  const factory = await viem.deployContract("StakingFactory", [
    BRONZE_FEE,
    ECOSYSTEM_FEE,
    MARKETING_FEE,
    feeRecipient,
    membershipToken,
  ]);

  console.log("Deployer       ", deployer.account.address, "  ← signs the tx, does not receive fees");
  console.log("Fee recipient  ", feeRecipient, "  ← receives bronze / ecosystem / marketing launch fees");
  console.log("Membership     ", membershipToken, "  ← holder-discount token (0x0 = none)");
  console.log("StakingFactory ", factory.address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
