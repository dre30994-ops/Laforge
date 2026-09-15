const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Regression tests for audit finding C-1: the freshness gate must NOT permanently
// lock stakers out of unstake/claim after the pool ends. `crank` is permissionless
// and can always push the pool to end; once lastUpdateTs >= endTs the exit paths
// (unstake/claim) stay callable forever via the freshOrEnded modifier.

const ECOSYSTEM_FEE = 30_000_000_000_000_000n; // 0.03 ETH (tier 1)
const ECOSYSTEM = 1n;
const HOUR = 3600n;
const DAY = 86400n;
const MIN_FUNDING = 10_000_000_000_000n; // 10M * 1e6
const MIN_STAKE = 35_000_000_000n; // 35k * 1e6

describe("C-1: stakers can always exit after the pool ends", function () {
  let token, pool, factory;
  let launcher, treasury, alice, cranker;
  const DURATION = 3n; // 3-day pool keeps the test fast
  const FUNDED = 200_000_000_000_000n;
  const STAKE_AMT = 1_000_000_000_000n; // 1M

  beforeEach(async function () {
    [launcher, treasury, alice, cranker] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Pons", "PONS", 6);

    const Factory = await ethers.getContractFactory("StakingFactory");
    factory = await Factory.connect(launcher).deploy(10000000000000000n, 30000000000000000n, 60000000000000000n, "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13");

    await token.mint(launcher.address, FUNDED);
    await token.mint(alice.address, STAKE_AMT);
    await token.connect(launcher).approve(await factory.getAddress(), FUNDED);

    await factory
      .connect(launcher)
      .createPool(await token.getAddress(), treasury.address, DURATION, 0n, 0n, FUNDED, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await token.getAddress()));

    // Alice stakes near the start (fresh pool), then earns for the run.
    await token.connect(alice).approve(await pool.getAddress(), STAKE_AMT);
    await pool.connect(alice).stake(STAKE_AMT);
  });

  it("without crank, unstake is stale long after end; after crank-to-end it succeeds", async function () {
    // Jump well past end + the 1h freshness window WITHOUT cranking.
    await time.increase(DURATION * DAY + 5n * HOUR);

    // Stale: lastUpdateTs is far behind and < endTs, so freshOrEnded reverts.
    await expect(pool.connect(alice).unstake(STAKE_AMT)).to.be.revertedWithCustomError(
      pool,
      "PoolStale"
    );

    // Anyone can crank the (ended) pool to end — crank is permissionless and not
    // fresh-gated. This pushes lastUpdateTs up to endTs.
    await pool.connect(cranker).crank(0);
    expect(await pool.lastUpdateTs()).to.equal(await pool.endTs());

    // Now unstake works and returns the full principal (no unstake tax here).
    const before = await token.balanceOf(alice.address);
    await pool.connect(alice).unstake(STAKE_AMT);
    const after = await token.balanceOf(alice.address);
    expect(after - before).to.equal(STAKE_AMT);
    expect(await pool.totalStaked()).to.equal(0n);
  });

  it("claim works after end once cranked to end, and pays the earned rewards", async function () {
    await time.increase(DURATION * DAY + 10n * HOUR);

    // Crank to end so the full schedule is distributed.
    await pool.connect(cranker).crank(0);
    expect(await pool.lastUpdateTs()).to.equal(await pool.endTs());

    const pending = await pool.pendingRewards(alice.address);
    expect(pending).to.be.gt(0n); // sole staker earned essentially the whole program

    const before = await token.balanceOf(alice.address);
    await pool.connect(alice).claim();
    const after = await token.balanceOf(alice.address);
    expect(after - before).to.equal(pending);
  });

  it("exit still works even if the pool was left stale mid-program then ended", async function () {
    // Let the pool go stale mid-program (no cranks for hours), then end.
    await time.increase(1n * DAY); // mid-program, now stale
    await time.increase(DURATION * DAY); // now well past end, still uncranked

    // A single crank(0) walks all remaining boundaries to end (3 days = 72
    // boundaries, under the 250-step default).
    await pool.connect(cranker).crank(0);
    expect(await pool.lastUpdateTs()).to.equal(await pool.endTs());

    // Full exit: unstake principal + claim rewards.
    await pool.connect(alice).unstake(STAKE_AMT);
    expect(await pool.totalStaked()).to.equal(0n);
    await pool.connect(alice).claim();
    // Rewards were paid (sole staker); pending now zero.
    expect(await pool.pendingRewards(alice.address)).to.equal(0n);
  });

  it("staking is still blocked after end (fresh, not freshOrEnded)", async function () {
    await time.increase(DURATION * DAY + 5n * HOUR);
    await pool.connect(cranker).crank(0); // cranked to end

    // stake uses the strict `fresh` gate — you cannot stake into an ended pool.
    await token.mint(alice.address, MIN_STAKE);
    await token.connect(alice).approve(await pool.getAddress(), MIN_STAKE);
    await expect(pool.connect(alice).stake(MIN_STAKE)).to.be.revertedWithCustomError(
      pool,
      "PoolStale"
    );
  });
});
