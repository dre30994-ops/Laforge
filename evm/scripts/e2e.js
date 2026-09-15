// End-to-end lifecycle proof: deploy factory + mock token, create & fund a pool,
// then stake → crank → claim → unstake, printing balances and tx hashes.
//
// Local (no key, no funds):
//   npx hardhat run scripts/e2e.js
// Robinhood testnet (needs a funded DEPLOYER_KEY in evm/.env):
//   npx hardhat run scripts/e2e.js --network robinhoodTestnet
//
// On a network with a single signer (a testnet with only DEPLOYER_KEY), the
// deployer plays every role (launcher/treasury/staker). On the local Hardhat
// network (many signers) distinct accounts are used.
const { ethers, network } = require("hardhat");

const DAY = 86400n;
const HOUR = 3600n;

// Tier 1 (Ecosystem) fee must match the factory constructor below.
const BRONZE_FEE = 10_000_000_000_000_000n; // 0.01
const ECOSYSTEM_FEE = 30_000_000_000_000_000n; // 0.03
const MARKETING_FEE = 60_000_000_000_000_000n; // 0.06
const FEE_RECIPIENT = "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13";
const TIER_BRONZE = 0n;
const TIER_ECOSYSTEM = 1n;

const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const FUNDING = 200_000_000n * UNIT; // 200M reward tokens
const MIN_STAKE = 35_000n * UNIT; // 35k
const STAKE_AMT = 1_000_000n * UNIT; // 1M
const UNSTAKE_TAX_BPS = 500n; // 5%

// Tier + duration for the E2E pool. Default to the cheapest tier (Bronze,
// 0.01 ETH, max 2-day duration) so a lightly-funded testnet wallet can run it.
// Override with E2E_TIER=ecosystem for the 0.03 ETH tier.
const useEcosystem = (process.env.E2E_TIER || "bronze").toLowerCase() === "ecosystem";
const E2E_TIER = useEcosystem ? TIER_ECOSYSTEM : TIER_BRONZE;
const E2E_FEE = useEcosystem ? ECOSYSTEM_FEE : BRONZE_FEE;
const DURATION_DAYS = useEcosystem ? 14n : 2n; // Bronze is capped at 2 days

// Local network can time-travel; a live testnet cannot. Detect it.
const isLocal = network.name === "hardhat" || network.name === "localhost";

function fmt(x) {
  return (Number(x) / Number(UNIT)).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

async function increaseTime(seconds) {
  // Only available on the local EVM. On a live testnet we skip (rewards will be
  // small but nonzero because block timestamps advance in real time).
  if (!isLocal) return;
  const helpers = require("@nomicfoundation/hardhat-network-helpers");
  await helpers.time.increase(seconds);
}

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No signer. On a testnet, set DEPLOYER_KEY in evm/.env and fund it."
    );
  }
  const launcher = signers[0];
  const treasury = signers[1] ?? signers[0];
  const staker = signers[2] ?? signers[0];

  console.log(`\n=== E2E on "${network.name}" (local=${isLocal}) ===`);
  console.log(`launcher: ${launcher.address}`);
  console.log(`treasury: ${treasury.address}`);
  console.log(`staker:   ${staker.address}\n`);

  // 1. Deploy a mock ERC-20 (stands in for a Pons token) and the factory.
  const Mock = await ethers.getContractFactory("MockERC20", launcher);
  const token = await Mock.deploy("Pons Token", "PONS", DECIMALS);
  await token.waitForDeployment();
  console.log(`MockERC20 deployed: ${await token.getAddress()}`);

  const Factory = await ethers.getContractFactory("StakingFactory", launcher);
  const factory = await Factory.deploy(BRONZE_FEE, ECOSYSTEM_FEE, MARKETING_FEE, FEE_RECIPIENT);
  await factory.waitForDeployment();
  console.log(`StakingFactory deployed: ${await factory.getAddress()}`);

  // 2. Fund accounts. Launcher needs FUNDING to fund the pool; staker needs
  //    tokens to stake. (If launcher==staker they share one balance.)
  await (await token.mint(launcher.address, FUNDING)).wait();
  if (staker.address !== launcher.address) {
    await (await token.mint(staker.address, STAKE_AMT * 2n)).wait();
  } else {
    await (await token.mint(launcher.address, STAKE_AMT * 2n)).wait();
  }

  // 3. Create + fund + start the pool atomically (approve factory, then create).
  await (await token.connect(launcher).approve(await factory.getAddress(), FUNDING)).wait();
  const createTx = await factory
    .connect(launcher)
    .createPool(
      await token.getAddress(),
      treasury.address,
      DURATION_DAYS,
      0n, // stakeTaxBps
      UNSTAKE_TAX_BPS,
      FUNDING,
      MIN_STAKE,
      E2E_TIER,
      { value: E2E_FEE }
    );
  await createTx.wait();
  const poolAddr = await factory.poolOf(await token.getAddress());
  const pool = await ethers.getContractAt("StakingPool", poolAddr);
  console.log(`Pool created:      ${poolAddr}`);
  console.log(`  started=${await pool.started()} funded=${fmt(await pool.fundedAmount())} baseRate/period=${await pool.baseRatePerPeriod()}`);
  console.log(`  endTs=${await pool.endTs()} (start + ${DURATION_DAYS}d)\n`);

  // 4. STAKE.
  await (await token.connect(staker).approve(poolAddr, STAKE_AMT)).wait();
  const stakeTx = await pool.connect(staker).stake(STAKE_AMT);
  await stakeTx.wait();
  const posAfterStake = await pool.positions(staker.address);
  console.log(`STAKE ${fmt(STAKE_AMT)}  tx=${stakeTx.hash}`);
  console.log(`  position.amount=${fmt(posAfterStake.amount)} totalStaked=${fmt(await pool.totalStaked())} totalWeight=${await pool.totalWeight()}\n`);

  // 5. Advance ~10h, cranking hourly to keep the pool fresh & accrue rewards.
  const hours = 10;
  for (let h = 0; h < hours; h++) {
    await increaseTime(HOUR);
    await (await pool.connect(staker).crank(0)).wait();
  }
  const pending = await pool.pendingRewards(staker.address);
  console.log(`After ${hours}× hourly crank: pendingRewards=${fmt(pending)}`);
  if (!isLocal && pending === 0n) {
    console.log("  (live testnet: little wall-clock elapsed, so pending may be ~0)\n");
  } else {
    console.log("");
  }

  // 6. CLAIM.
  const balBeforeClaim = await token.balanceOf(staker.address);
  const claimTx = await pool.connect(staker).claim();
  await claimTx.wait();
  const balAfterClaim = await token.balanceOf(staker.address);
  console.log(`CLAIM  tx=${claimTx.hash}`);
  console.log(`  received=${fmt(balAfterClaim - balBeforeClaim)} totalClaimed=${fmt(await pool.totalClaimed())}\n`);

  // 7. UNSTAKE (partial) — expect 5% tax accrued to treasury (pull-payment).
  const unstakeAmt = STAKE_AMT / 2n;
  const userBeforeUnstake = await token.balanceOf(staker.address);
  const unstakeTx = await pool.connect(staker).unstake(unstakeAmt);
  await unstakeTx.wait();
  const userAfterUnstake = await token.balanceOf(staker.address);
  const expectedTax = (unstakeAmt * UNSTAKE_TAX_BPS) / 10_000n;
  const expectedUser = unstakeAmt - expectedTax;
  console.log(`UNSTAKE ${fmt(unstakeAmt)}  tx=${unstakeTx.hash}`);
  console.log(`  returned=${fmt(userAfterUnstake - userBeforeUnstake)} (expected ${fmt(expectedUser)} after ${UNSTAKE_TAX_BPS} bps tax)`);
  console.log(`  owedToTreasury=${fmt(await pool.owedToTreasury())} (expected ${fmt(expectedTax)})`);
  console.log(`  totalStaked=${fmt(await pool.totalStaked())}\n`);

  // 8. Treasury pull (permissionless).
  const treBefore = await token.balanceOf(treasury.address);
  await (await pool.connect(staker).withdrawTreasury()).wait();
  const treAfter = await token.balanceOf(treasury.address);
  console.log(`withdrawTreasury: treasury received=${fmt(treAfter - treBefore)}\n`);

  // 9. Assertions.
  const ok =
    userAfterUnstake - userBeforeUnstake === expectedUser &&
    treAfter - treBefore === expectedTax &&
    balAfterClaim - balBeforeClaim >= 0n;
  console.log(ok ? "✓ E2E PASSED" : "✗ E2E FAILED");
  if (!ok) process.exitCode = 1;

  if (network.name === "robinhoodTestnet") {
    console.log(`\nFactory (wire into frontend): NEXT_PUBLIC_STAKING_FACTORY_46630=${await factory.getAddress()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
