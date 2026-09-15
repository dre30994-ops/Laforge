// Read-only inspector: given a factory address, print poolCount and each pool's
// summary + (optionally) a specific staker's position. Sends NO transactions.
//
//   FACTORY=0x... npx hardhat run scripts/inspect.js --network robinhoodTestnet
//   FACTORY=0x... STAKER=0x... npx hardhat run scripts/inspect.js --network robinhoodTestnet
const { ethers, network } = require("hardhat");

async function main() {
  // Accept via env OR trailing CLI args (hardhat passes script args after `--`).
  const argv = process.argv.slice(2).filter((a) => a.startsWith("0x"));
  const factoryAddr = process.env.FACTORY || argv[0];
  if (!factoryAddr) throw new Error("Set FACTORY=0x... or pass it as an arg.");
  const staker = process.env.STAKER || argv[1] || null;

  const factory = await ethers.getContractAt("StakingFactory", factoryAddr);
  const count = await factory.poolCount();
  console.log(`\n[${network.name}] factory ${factoryAddr}`);
  console.log(`poolCount: ${count}`);

  for (let i = 0n; i < count; i++) {
    const poolAddr = await factory.allPools(i);
    const pool = await ethers.getContractAt("StakingPool", poolAddr);
    const [token, tier, dur, started, paused, tvl, totalStaked, decimals] = await Promise.all([
      pool.token(),
      pool.tier(),
      pool.durationDays(),
      pool.started(),
      pool.paused(),
      pool.stakeVaultBalance(),
      pool.totalStaked(),
      pool.decimals(),
    ]);
    const unit = 10n ** BigInt(decimals);
    console.log(`\n  #${i}  pool=${poolAddr}`);
    console.log(`      token=${token} tier=${tier} duration=${dur}d started=${started} paused=${paused}`);
    console.log(`      TVL(stakeVault)=${Number(tvl) / Number(unit)}  totalStaked=${Number(totalStaked) / Number(unit)}`);

    if (staker) {
      const p = await pool.positions(staker);
      const pending = await pool.pendingRewards(staker);
      console.log(`      [staker ${staker}] amount=${Number(p.amount) / Number(unit)} pending=${Number(pending) / Number(unit)} exists=${p.exists}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
