import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Sidecar — do not redeploy StakingFactory. One desk per chain, bound to that
 * chain's live factory.
 *
 * Do NOT pass 0x factory/recipient addresses on the PowerShell command line.
 * Ignition JSON5 treats unquoted 0x… as a hex number and throws HHE10111.
 *
 * Preferred: scripts/deployMarketingDesk.ts with $env:FEE_RECIPIENT.
 * Ignition fallback: --parameters ignition/parameters/ethereum.json
 * (quote every 0x address; encode fee as "60000000000000000n").
 */
const MARKETING_FEE = 60_000_000_000_000_000n;
const ROBINHOOD_FACTORY = "0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691";

export default buildModule("MarketingDeskModule", (m) => {
  const fee = m.getParameter("fee", MARKETING_FEE);
  // Required. Never default to the deployer.
  const feeRecipient = m.getParameter("feeRecipient");
  const factory = m.getParameter("factory", ROBINHOOD_FACTORY);

  const desk = m.contract("MarketingDesk", [fee, feeRecipient, factory]);
  return { desk };
});
