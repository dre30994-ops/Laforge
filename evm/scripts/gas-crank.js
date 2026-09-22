// Measure the gas cost of crank() per hourly boundary, to estimate keeper fees.
//   npx hardhat run scripts/gas-crank.js
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const HOUR = 3600n;
const DAY = 86400n;
const UNIT = 10n ** 6n;

async function main() {
  const [launcher, treasury, alice] = await ethers.getSigners();

  const Mock = await ethers.getContractFactory("MockERC20");
  const token = await Mock.deploy("Pons", "PONS", 6);
  await token.waitForDeployment();

  const Factory = await ethers.getContractFactory("StakingFactory");
  const factory = await Factory.deploy(
    10000000000000000n, 30000000000000000n, 60000000000000000n,
    "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13", ethers.ZeroAddress
  );
  await factory.waitForDeployment();

  await token.mint(launcher.address, 500_000_000n * UNIT);
  await token.mint(alice.address, 10_000_000n * UNIT);

  const funding = 200_000_000n * UNIT;
  await token.connect(launcher).approve(await factory.getAddress(), funding);
  await factory.connect(launcher).createPool(
    await token.getAddress(), treasury.address, 30n, 0n, 0n, funding, 35_000n * UNIT, 1n,
    { value: 30000000000000000n }
  );
  const pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await token.getAddress()));

  // A staker so weight > 0 (worst-case: distribution branch runs).
  await token.connect(alice).approve(await pool.getAddress(), 1_000_000n * UNIT);
  await pool.connect(alice).stake(1_000_000n * UNIT);

  // Case 1: crank every hour (1 boundary per tx) — the keeper's steady state.
  const perHourGas = [];
  for (let h = 0; h < 6; h++) {
    await time.increase(HOUR);
    const tx = await pool.crank(0);
    const rc = await tx.wait();
    perHourGas.push(rc.gasUsed);
  }
  const avg1 = perHourGas.reduce((a, b) => a + b, 0n) / BigInt(perHourGas.length);
  console.log("crank() gas, 1 boundary/call (steady hourly keeper):");
  console.log("  samples:", perHourGas.map((g) => g.toString()).join(", "));
  console.log("  average:", avg1.toString(), "gas/call");

  // Case 2: catch up 24 boundaries in one call (amortized).
  await time.increase(24n * HOUR);
  const tx2 = await pool.crank(0);
  const rc2 = await tx2.wait();
  console.log("\ncrank() gas, 24 boundaries in one call (catch-up):");
  console.log("  total:", rc2.gasUsed.toString(), "gas");
  console.log("  per-boundary:", (rc2.gasUsed / 24n).toString(), "gas");

  // Fee projections. Robinhood Chain = Arbitrum Orbit L2; typical effective gas
  // price is sub-gwei. Show a range.
  console.log("\n── Daily keeper fee projections ──");
  const scenarios = [
    { label: "hourly crank (24/day), 1 boundary each", gasPerDay: avg1 * 24n },
    { label: "single daily catch-up (24 boundaries)", gasPerDay: rc2.gasUsed },
  ];
  const gweiPrices = [0.01, 0.05, 0.1, 0.5]; // effective gas price in gwei
  const ethUsd = 3500; // illustrative
  for (const s of scenarios) {
    console.log(`\n  ${s.label}: ${s.gasPerDay.toString()} gas/day`);
    for (const gwei of gweiPrices) {
      const weiPerGas = BigInt(Math.round(gwei * 1e9));
      const ethPerDay = Number(s.gasPerDay * weiPerGas) / 1e18;
      console.log(
        `    @ ${gwei} gwei: ${ethPerDay.toFixed(8)} ETH/day  (~$${(ethPerDay * ethUsd).toFixed(4)}/day)`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
