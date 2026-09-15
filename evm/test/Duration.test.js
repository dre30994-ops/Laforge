const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { OraclePool, denomForDuration, DAY, HOUR } = require("./oracle");

const ECOSYSTEM_FEE = 30_000_000_000_000_000n; // 0.03 ether (tier 1)
const ECOSYSTEM = 1n; // Tier.Ecosystem
const MIN_FUNDING = 100_000_000_000n; // 100k * 1e6 (new lower default)
const MIN_STAKE = 35_000_000_000n;
const T35K = 35_000_000_000n;
const FUNDED = 200_000_000_000_000n;

describe("Configurable duration (1–30 days)", function () {
  let math;
  before(async function () {
    const H = await ethers.getContractFactory("MathHarness");
    math = await H.deploy();
  });

  it("denomForDuration matches the oracle and the 14-day default equals DENOM", async function () {
    for (let d = 1n; d <= 14n; d++) {
      const onchain = await math.denomForDuration(d);
      expect(onchain).to.equal(denomForDuration(d));
    }
    expect(await math.denomForDuration(14n)).to.equal(1977n); // DENOM
  });

  it("denom grows with duration and plateau adds 144 period-units/day beyond day 3", async function () {
    // The ramp now completes in 1 day: denom(1) = 6*210/12 = 105 period-units.
    expect(await math.denomForDuration(1n)).to.equal(105n);
    // Beyond the 1-day ramp, each extra day is pure plateau: 72 periods * 2.0x = 144.
    const d3 = await math.denomForDuration(3n);
    const d4 = await math.denomForDuration(4n);
    expect(d4 - d3).to.equal(144n);
    const d13 = await math.denomForDuration(13n);
    const d14 = await math.denomForDuration(14n);
    expect(d14 - d13).to.equal(144n);
    // Day 2 is already full plateau too (ramp ended at day 1).
    const d1 = await math.denomForDuration(1n);
    const d2 = await math.denomForDuration(2n);
    expect(d2 - d1).to.equal(144n);
  });

  it("emission reaches 2.0x at day 1 (ramp step 12 at 24h)", async function () {
    // Emission step index = floor(hours / hoursPerStep), hoursPerStep = 2h/1h = 2.
    // At hour 24 the step index is 12 => plateau numerator 24 => 2.0x.
    expect(await math.emissionMultBps(12n)).to.equal(20_000n);
    // The last ramp step (step 11, reached at hour 22) is still below 2.0x.
    expect(await math.emissionMultBps(11n)).to.be.lt(20_000n);
    // A 1-day pool's whole schedule is the ramp: denom(1) = 105 period-units,
    // so total emission = baseRate * 105 (exact; ramp numerator divisible by 12).
    const r0 = 200_000_000_000_000n / 105n;
    expect(await math.cumulativeEmitted(r0, 86400n)).to.equal(r0 * 105n);
  });

  it("remainingPeriodUnitsFor is zero at/after the chosen end", async function () {
    expect(await math.remainingPeriodUnitsFor(7n * 86400n, 7n)).to.equal(0n);
    expect(await math.remainingPeriodUnitsFor(8n * 86400n, 7n)).to.equal(0n);
    // At start it's the full MULT_DENOM-scaled denom.
    expect(await math.remainingPeriodUnitsFor(0n, 7n)).to.equal(denomForDuration(7n) * 12n);
  });
});

describe("Factory rejects out-of-range duration", function () {
  let factory, launcher, treasury, Mock;
  beforeEach(async function () {
    [launcher, treasury] = await ethers.getSigners();
    factory = await (await ethers.getContractFactory("StakingFactory")).deploy(10000000000000000n, 30000000000000000n, 60000000000000000n, "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13");
    Mock = await ethers.getContractFactory("MockERC20");
  });

  it("reverts on 0 and 31 days", async function () {
    const t1 = await Mock.deploy("A", "A", 6);
    const t2 = await Mock.deploy("B", "B", 6);
    await expect(
      factory.createPool(await t1.getAddress(), ethers.ZeroAddress, 0n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE })
    ).to.be.revertedWithCustomError(factory, "BadDuration");
    await expect(
      factory.createPool(await t2.getAddress(), ethers.ZeroAddress, 31n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE })
    ).to.be.revertedWithCustomError(factory, "BadDuration");
  });

  it("accepts 1 and 30 days", async function () {
    const t1 = await Mock.deploy("A", "A", 6);
    const t30 = await Mock.deploy("B", "B", 6);
    // One-time atomic funding: launcher must hold + approve the factory.
    await t1.mint(launcher.address, MIN_FUNDING);
    await t1.connect(launcher).approve(await factory.getAddress(), MIN_FUNDING);
    await t30.mint(launcher.address, MIN_FUNDING);
    await t30.connect(launcher).approve(await factory.getAddress(), MIN_FUNDING);
    await factory.connect(launcher).createPool(await t1.getAddress(), ethers.ZeroAddress, 1n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    await factory.connect(launcher).createPool(await t30.getAddress(), ethers.ZeroAddress, 30n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    const p1 = await ethers.getContractAt("StakingPool", await factory.poolOf(await t1.getAddress()));
    const p30 = await ethers.getContractAt("StakingPool", await factory.poolOf(await t30.getAddress()));
    expect(await p1.durationDays()).to.equal(1n);
    expect(await p30.durationDays()).to.equal(30n);
  });
});

describe("Differential: a 7-day pool matches the oracle", function () {
  let token, pool, authority, operator, treasury, cranker, alice;
  let oracle, baseTime;
  const DURATION = 7n;

  beforeEach(async function () {
    const s = await ethers.getSigners();
    [authority, operator, treasury, cranker, alice] = s;

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Pons", "PONS", 6);

    const Factory = await ethers.getContractFactory("StakingFactory");
    const factory = await Factory.deploy(10000000000000000n, 30000000000000000n, 60000000000000000n, "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13");
    const factoryAddr = await factory.getAddress();

    // Mint + approve everything BEFORE createPool so createPool is the last
    // setup tx before the first stake (stake lands 1 block after startTs). This
    // reproduces the original manual fund/start timing and keeps the crank's
    // boundary-based cohort maturity consistent with the elapsed-based tenure
    // read (avoids a spurious off-by-one at full maturity). The pool address is
    // deterministic from the factory nonce, so stakers can pre-approve it.
    await token.mint(authority.address, FUNDED);
    for (const who of [operator, alice]) {
      await token.mint(who.address, 1_000_000_000_000_000n);
    }
    await token.connect(authority).approve(factoryAddr, FUNDED);

    const factoryNonce = await ethers.provider.getTransactionCount(factoryAddr);
    const predictedPool = ethers.getCreateAddress({ from: factoryAddr, nonce: factoryNonce });
    for (const who of [operator, alice]) {
      await token.connect(who).approve(predictedPool, ethers.MaxUint256);
    }

    await factory
      .connect(authority)
      .createPool(await token.getAddress(), treasury.address, DURATION, 0n, 0n, FUNDED, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await token.getAddress()));
    expect(await pool.getAddress()).to.equal(predictedPool);

    baseTime = await pool.startTs();

    oracle = new OraclePool(baseTime, DURATION);
    oracle.minStake = MIN_STAKE;
    oracle.fund(FUNDED);
    oracle.start();
    oracle.lastUpdateTs = baseTime;
  });

  async function crankTo(offset) {
    const target = baseTime + offset;
    await time.setNextBlockTimestamp(target);
    await pool.connect(cranker).crank(0);
    oracle.crank(target);
  }

  it("end date is start + 7 days and base rate uses the 7-day denom", async function () {
    expect(await pool.endTs()).to.equal(baseTime + DURATION * DAY);
    expect(await pool.baseRatePerPeriod()).to.equal(oracle.baseRate);
    expect(await pool.baseRatePerPeriod()).to.equal(FUNDED / denomForDuration(DURATION));
  });

  it("aggregates and payout match the oracle across the 7-day run", async function () {
    await pool.connect(alice).stake(T35K * 4n);
    oracle.stake("A", T35K * 4n, baseTime);

    // Crank hourly for 30 hours (spans the ramp) and check pending in lockstep.
    for (let h = 1n; h <= 30n; h++) {
      await crankTo(h * HOUR);
    }
    expect(await pool.totalWeight()).to.equal(oracle.totalWeight);
    expect(await pool.accRewardPerWeight()).to.equal(oracle.acc);
    expect(await pool.totalEmitted()).to.equal(oracle.totalEmitted);
    expect(await pool.pendingRewards(alice.address)).to.equal(oracle.pendingRewards("A"));

    // Crank to the 7-day end; emissions must stop there.
    for (let h = 31n; h <= DURATION * 24n; h++) {
      await crankTo(h * HOUR);
    }
    const emittedAtEnd = await pool.totalEmitted();
    // Cranking past end emits nothing further.
    await time.setNextBlockTimestamp(baseTime + (DURATION + 2n) * DAY);
    await pool.connect(cranker).crank(0);
    expect(await pool.totalEmitted()).to.equal(emittedAtEnd);
    // Total emitted over the whole 7-day program ≈ baseRate * denom(7).
    const exact = (await pool.baseRatePerPeriod()) * denomForDuration(DURATION);
    expect(emittedAtEnd <= exact).to.equal(true);
    expect(exact - emittedAtEnd < 1000n).to.equal(true);
  });
});

describe("Differential: a 30-day pool stays exact past the old 16-day capacity", function () {
  let token, pool, authority, operator, treasury, cranker, alice;
  let oracle, baseTime;
  const DURATION = 30n;

  beforeEach(async function () {
    const s = await ethers.getSigners();
    [authority, operator, treasury, cranker, alice] = s;

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Pons", "PONS", 6);

    const Factory = await ethers.getContractFactory("StakingFactory");
    const factory = await Factory.deploy(10000000000000000n, 30000000000000000n, 60000000000000000n, "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13");
    const factoryAddr = await factory.getAddress();

    // Mint + approve everything BEFORE createPool so createPool is the last
    // setup tx before the first stake (stake lands 1 block after startTs). This
    // reproduces the original manual fund/start timing and keeps the crank's
    // boundary-based cohort maturity consistent with the elapsed-based tenure
    // read (avoids a spurious off-by-one at full maturity). The pool address is
    // deterministic from the factory nonce, so stakers can pre-approve it.
    await token.mint(authority.address, FUNDED);
    for (const who of [operator, alice]) {
      await token.mint(who.address, 1_000_000_000_000_000n);
    }
    await token.connect(authority).approve(factoryAddr, FUNDED);

    const factoryNonce = await ethers.provider.getTransactionCount(factoryAddr);
    const predictedPool = ethers.getCreateAddress({ from: factoryAddr, nonce: factoryNonce });
    for (const who of [operator, alice]) {
      await token.connect(who).approve(predictedPool, ethers.MaxUint256);
    }

    await factory
      .connect(authority)
      .createPool(await token.getAddress(), treasury.address, DURATION, 0n, 0n, FUNDED, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await token.getAddress()));
    expect(await pool.getAddress()).to.equal(predictedPool);

    baseTime = await pool.startTs();

    oracle = new OraclePool(baseTime, DURATION);
    oracle.minStake = MIN_STAKE;
    oracle.fund(FUNDED);
    oracle.start();
    oracle.lastUpdateTs = baseTime;
  });

  it("end date is start + 30 days and base rate uses the 30-day denom", async function () {
    expect(await pool.endTs()).to.equal(baseTime + DURATION * DAY);
    expect(await pool.baseRatePerPeriod()).to.equal(FUNDED / denomForDuration(DURATION));
  });

  it("accrual crossing day 15→17 (past old CHECKPOINT_CAPACITY=384) matches the oracle", async function () {
    // A day-0 staker whose tenure is long-since maxed; its checkpoint read index
    // (depositBoundaryIndex + min(k,72)) climbs past boundary 384 (16 days) as
    // the pool cranks, which the old capacity could not hold. This is the exact
    // regression the capacity resize fixes.
    await pool.connect(alice).stake(T35K * 4n);
    oracle.stake("A", T35K * 4n, baseTime);

    async function crankTo(offset) {
      const target = baseTime + offset;
      await time.setNextBlockTimestamp(target);
      await pool.connect(cranker).crank(0); // default max steps (250) per call
      // Chain a second crank in case a single call didn't reach the target
      // (>250 boundaries of catch-up).
      await pool.connect(cranker).crank(0);
      await pool.connect(cranker).crank(0);
      oracle.crank(target);
    }

    // Jump to hour 360 (day 15) in coarse steps, then crank hourly through the
    // critical day 15→17 window that straddles the old 384-boundary limit.
    await crankTo(360n * HOUR);
    for (let h = 361n; h <= 408n; h++) {
      await crankTo(h * HOUR);
    }

    expect(await pool.totalWeight()).to.equal(oracle.totalWeight);
    expect(await pool.accRewardPerWeight()).to.equal(oracle.acc);
    expect(await pool.totalEmitted()).to.equal(oracle.totalEmitted);
    expect(await pool.pendingRewards(alice.address)).to.equal(oracle.pendingRewards("A"));

    // A claim at this point must equal the oracle's payout exactly (proves the
    // checkpoint read past boundary 384 returned the right g_k, not a zero slot).
    const before = await token.balanceOf(alice.address);
    await time.setNextBlockTimestamp(baseTime + 409n * HOUR);
    await pool.connect(cranker).crank(0);
    oracle.crank(baseTime + 409n * HOUR);
    const oraclePayout = oracle.claim("A", baseTime + 409n * HOUR);
    await pool.connect(alice).claim();
    const after = await token.balanceOf(alice.address);
    expect(after - before).to.equal(oraclePayout);
  });

  it("emits ~baseRate*denom(30) by the 30-day end and nothing after", async function () {
    // No stakers: all emission lands in `unallocated`, but totalEmitted still
    // tracks the analytic schedule. Crank to the end in large jumps.
    for (let d = 1n; d <= 30n; d++) {
      const target = baseTime + d * DAY;
      await time.setNextBlockTimestamp(target);
      // Each day is 24 boundaries; default 250-step crank clears it in one call.
      await pool.connect(cranker).crank(0);
      oracle.crank(target);
    }
    const emittedAtEnd = await pool.totalEmitted();
    expect(emittedAtEnd).to.equal(oracle.totalEmitted);

    // Cranking past end emits nothing further.
    await time.setNextBlockTimestamp(baseTime + (DURATION + 2n) * DAY);
    await pool.connect(cranker).crank(0);
    expect(await pool.totalEmitted()).to.equal(emittedAtEnd);

    // Analytic total for 30 days: baseRate * denom(30), minus bounded per-hour
    // flooring dust.
    const exact = (await pool.baseRatePerPeriod()) * denomForDuration(DURATION);
    expect(emittedAtEnd <= exact).to.equal(true);
    expect(exact - emittedAtEnd < 5000n).to.equal(true);
  });
});
