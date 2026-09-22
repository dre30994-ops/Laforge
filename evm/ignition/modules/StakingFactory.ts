import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/** Robinhood mainnet fees (wei of native ETH). Override via Ignition parameters. */
const BRONZE_FEE = 10_000_000_000_000_000n;
const ECOSYSTEM_FEE = 30_000_000_000_000_000n;
const MARKETING_FEE = 60_000_000_000_000_000n;

export default buildModule("StakingFactoryModule", (m) => {
  const bronzeFee = m.getParameter("bronzeFee", BRONZE_FEE);
  const ecosystemFee = m.getParameter("ecosystemFee", ECOSYSTEM_FEE);
  const marketingFee = m.getParameter("marketingFee", MARKETING_FEE);
  // Required. Never default to the deployer — launch ETH must hit the treasury.
  const feeRecipient = m.getParameter("feeRecipient");
  const membershipToken = m.getParameter(
    "membershipToken",
    "0x0000000000000000000000000000000000000000",
  );

  const factory = m.contract("StakingFactory", [
    bronzeFee,
    ecosystemFee,
    marketingFee,
    feeRecipient,
    membershipToken,
  ]);

  return { factory };
});
