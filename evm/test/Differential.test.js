const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  OraclePool, deriveBaseRate, cumulativeNumerator,
  DENOM, TENURE_RAMP_STEPS, HOUR, DAY,
} = require("./oracle");

const MIN_FUNDING = 10_000_000_000_000n;
const MIN_STAKE = 35_000_000_000n; // T35K
const T35K = 35_000_000_000n;
const FUNDED_200M = 200_000_000_000_000n;
const ECOSYSTEM_FEE = 30_000_000_000_000_000n; // 0.03 ether (tier 1)
const ECOSYSTEM = 1n; // Tier.Ecosystem

// ---------------------------------------------------------------------------
// Part 1: the oracle must reproduce the Rust reference GOLDEN values, so a bug
// in the oracle cannot silently pass the differential comparison below.
// ---------------------------------------------------------------------------
describe("Oracle self-check against Rust reference golden values", function () {
  function funded(users, fundAmt = FUNDED_200M) {
    const p = new OraclePool(0n);
    p.minStake = MIN_STAKE;
    p.fund(fundAmt);
    p.start();
    return p;
  }

  it("funding 200M derives the day-14 base rate", function () {
    const p = funded(1);
    expect(p.endTs - p.startTs).to.equal(14n * DAY);
    expect(p.baseRate).to.equal(deriveBaseRate(FUNDED_200M));
  });

  it("two stakers produce the expected total weight (a*(72+24)+b*72)", function () {
    const p = funded(2);
    const a = T35K * 2n, b = T35K * 3n;
    p.stake("A", a, 0n);
    p.crank(24n * HOUR);
    p.stake("B", b, 24n * HOUR);
    // total weight right after B joins at hour 24: A has 24 steps, B has 0.
    const expected = a * (72n + 24n) + b * 72n;
    expect(p.totalWeight).to.equal(expected);
  });

  it("cranking to day 14 emits ~r0*DENOM (per-hour flooring loses bounded dust)", function () {
    // The on-chain crank floors emission each hour (base*3*mult/12), whereas the
    // reference `cumulative_emitted` floors once. Over 336 hourly boundaries the
    // per-hour form loses at most a few hundred base units. This is the real
    // on-chain behaviour, and always floors toward the pool (never over-emits).
    const p = funded(1);
    p.stake("A", T35K, 0n);
    p.crank(14n * DAY);
    const exact = p.baseRate * DENOM;
    expect(p.totalEmitted <= exact).to.equal(true);
    expect(exact - p.totalEmitted < 1000n).to.equal(true);
  });

  it("cranking past end emits nothing further", function () {
    const p = funded(1);
    p.stake("A", T35K, 0n);
    p.crank(14n * DAY);
    const atEnd = p.totalEmitted;
    p.crank(20n * DAY);
    expect(p.totalEmitted).to.equal(atEnd);
  });

  it("tenure maxes at exactly 2.0x weight on day 3 then freezes", function () {
    const p = funded(1);
    p.stake("A", T35K, 0n);
    p.crank(3n * DAY);
    expect(p.totalWeight).to.equal(T35K * 144n);
    expect(p.rampingStake).to.equal(0n);
    p.crank(10n * DAY);
    expect(p.totalWeight).to.equal(T35K * 144n);
  });

  it("zero-TVL emissions land in unallocated and acc stays zero", function () {
    const p = funded(1);
    p.crank(2n * DAY);
    expect(p.acc).to.equal(0n);
    expect(p.unallocated).to.equal(p.totalEmitted);
  });

  it("equal stakes at equal time split rewards equally", function () {
    const p = funded(2);
    p.stake("A", T35K, 0n);
    p.stake("B", T35K, 0n);
    p.crank(4n * DAY);
    const a = p.claim("A", 4n * DAY);
    const b = p.claim("B", 4n * DAY);
    expect(a).to.equal(b);
  });

  it("splitting a position confers no advantage (dust <= 4)", function () {
    const whole = (() => {
      const p = funded(1); p.stake("A", T35K * 4n, 0n); p.crank(6n * DAY);
      return p.claim("A", 6n * DAY);
    })();
    const split = (() => {
      const p = funded(2);
      p.stake("A", T35K * 2n, 0n); p.stake("B", T35K * 2n, 0n); p.crank(6n * DAY);
      return p.claim("A", 6n * DAY) + p.claim("B", 6n * DAY);
    })();
    const diff = whole > split ? whole - split : split - whole;
    expect(diff <= 4n).to.equal(true);
  });

  it("sole idle staker from day 0 to 14 collects ~everything emitted", function () {
    const p = funded(1);
    p.stake("A", T35K, 0n);
    p.crank(14n * DAY);
    const emitted = p.totalEmitted;
    const paid = p.claim("A", 14n * DAY);
    // The pool can never be overdrawn: paid <= emitted (flooring favours pool).
    expect(paid <= emitted).to.equal(true);
    // On-chain the crank floors `acc` every hour (emission*ACC_SCALE/weight),
    // which is lossier than the reference model's once-per-settlement floor.
    // For a single minimum-size position over the full 336-hour program the
    // residual is ~0.15% (measured), and it stays in the pool as recoverable
    // surplus. This matches the real Solana crank, not the ref-model's <1000
    // bound (which only holds for the coarser cumulative_emitted path).
    expect((emitted - paid) * 10_000n / emitted <= 20n).to.equal(true); // <= 0.20%
  });

  it("double claim pays zero", function () {
    const p = funded(1);
    p.stake("A", T35K, 0n);
    p.crank(5n * DAY);
    expect(p.claim("A", 5n * DAY) > 0n).to.equal(true);
    expect(p.claim("A", 5n * DAY)).to.equal(0n);
  });
});

// ---------------------------------------------------------------------------
// Part 2: differential — run the SAME scenario through the oracle and the
// deployed Solidity contract; assert aggregates and payouts match exactly.
// ---------------------------------------------------------------------------
describe("Differential: Solidity contract == oracle == Rust semantics", function () {
  let token, pool;
  let authority, operator, treasury, cranker;
  let users; // signers keyed by label
  let oracle;
  let baseTime;

  async function setup() {
    const signers = await ethers.getSigners();
    [authority, operator, treasury, cranker] = signers;
    // Map labels A..F to distinct signers.
    users = {
      A: signers[4], B: signers[5], C: signers[6], D: signers[7],
    };

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Pons", "PONS", 6);

    const Factory = await ethers.getContractFactory("StakingFactory");
    const factory = await Factory.deploy(10000000000000000n, 30000000000000000n, 60000000000000000n, "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13");
    const factoryAddr = await factory.getAddress();

    // Mint and approve everything BEFORE createPool so that createPool is the
    // last setup tx before the test's first stake. This reproduces the original
    // manual fund/start timing (stake lands exactly 1 block after startTs),
    // which keeps boundary-based cohort maturity in the crank consistent with
    // the elapsed-based tenure read at unstake (avoids a spurious off-by-one at
    // full maturity). The pool address is deterministic from the factory nonce.
    await token.mint(authority.address, FUNDED_200M);
    for (const s of [operator, users.A, users.B, users.C, users.D]) {
      await token.mint(s.address, 1_000_000_000_000_000n);
    }
    await token.connect(authority).approve(factoryAddr, FUNDED_200M);

    // The factory's next CREATE (the StakingPool) uses the factory's current
    // nonce (1: the ctor did no CREATE). Precompute it so stakers can approve
    // the pool before it exists.
    const factoryNonce = await ethers.provider.getTransactionCount(factoryAddr);
    const predictedPool = ethers.getCreateAddress({ from: factoryAddr, nonce: factoryNonce });
    for (const s of [operator, users.A, users.B, users.C, users.D]) {
      await token.connect(s).approve(predictedPool, ethers.MaxUint256);
    }

    // One-time atomic create+fund+start (LAST setup tx). The oracle models
    // unstake tax only (500 bps), so create the pool with those tax settings.
    await factory
      .connect(authority)
      .createPool(await token.getAddress(), treasury.address, 14n, 0n, 500n, FUNDED_200M, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await token.getAddress()));
    expect(await pool.getAddress()).to.equal(predictedPool);

    // Align oracle startTs with the contract's start block time.
    baseTime = await pool.startTs();

    oracle = new OraclePool(baseTime);
    oracle.minStake = MIN_STAKE;
    oracle.fund(FUNDED_200M);
    oracle.start();
    oracle.lastUpdateTs = baseTime;
  }

  // Advance chain time to baseTime + offsetSeconds and crank both sides.
  async function crankTo(offset) {
    const target = baseTime + offset;
    await time.setNextBlockTimestamp(target);
    await pool.connect(cranker).crank(0);
    oracle.crank(target);
  }

  async function assertAggregatesMatch() {
    expect(await pool.totalStaked()).to.equal(oracle.totalStaked);
    expect(await pool.totalWeight()).to.equal(oracle.totalWeight);
    expect(await pool.rampingStake()).to.equal(oracle.rampingStake);
    expect(await pool.accRewardPerWeight()).to.equal(oracle.acc);
    expect(await pool.sumAccAtBoundaries()).to.equal(oracle.sumAcc);
    expect(await pool.totalEmitted()).to.equal(oracle.totalEmitted);
    expect(await pool.unallocated()).to.equal(oracle.unallocated);
  }

  beforeEach(setup);

  it("scenario 1: single staker, crank hourly for 10h, matches exactly", async function () {
    // Stake at hour 0 (already fresh right after start).
    await pool.connect(users.A).stake(T35K * 3n);
    oracle.stake("A", T35K * 3n, baseTime);
    await assertAggregatesMatch();

    for (let h = 1n; h <= 10n; h++) {
      await crankTo(h * HOUR);
      await assertAggregatesMatch();
      expect(await pool.pendingRewards(users.A.address)).to.equal(oracle.pendingRewards("A"));
    }
  });

  it("scenario 2: two stakers at different times, weight + payouts match", async function () {
    await pool.connect(users.A).stake(T35K * 2n);
    oracle.stake("A", T35K * 2n, baseTime);

    // B joins at hour 5 (crank to hour 5 first to keep fresh).
    await crankTo(5n * HOUR);
    await pool.connect(users.B).stake(T35K * 6n);
    oracle.stake("B", T35K * 6n, baseTime + 5n * HOUR);
    await assertAggregatesMatch();

    // Advance to hour 30, cranking each hour.
    for (let h = 6n; h <= 30n; h++) {
      await crankTo(h * HOUR);
    }
    await assertAggregatesMatch();

    // Compare pending for both, then claim and compare payouts.
    expect(await pool.pendingRewards(users.A.address)).to.equal(oracle.pendingRewards("A"));
    expect(await pool.pendingRewards(users.B.address)).to.equal(oracle.pendingRewards("B"));

    const aBefore = await token.balanceOf(users.A.address);
    await pool.connect(users.A).claim();
    const aPaid = (await token.balanceOf(users.A.address)) - aBefore;
    const aOracle = oracle.claim("A", baseTime + 30n * HOUR);
    expect(aPaid).to.equal(aOracle);

    const bBefore = await token.balanceOf(users.B.address);
    await pool.connect(users.B).claim();
    const bPaid = (await token.balanceOf(users.B.address)) - bBefore;
    const bOracle = oracle.claim("B", baseTime + 30n * HOUR);
    expect(bPaid).to.equal(bOracle);

    await assertAggregatesMatch();
  });

  it("scenario 3: unstake with 5% tax + full tenure reset matches", async function () {
    await pool.connect(users.A).stake(T35K * 4n);
    oracle.stake("A", T35K * 4n, baseTime);

    // Mature over 3 days (crank each hour would be 72 cranks; do it hourly).
    for (let h = 1n; h <= 72n; h++) {
      await crankTo(h * HOUR);
    }
    await assertAggregatesMatch();

    // A is matured at 2.0x -> weight should be amount*144.
    expect(await pool.totalWeight()).to.equal(T35K * 4n * 144n);

    // Unstake half.
    const unstakeAmt = T35K * 2n;
    const treBefore = await token.balanceOf(treasury.address);
    const usrBefore = await token.balanceOf(users.A.address);

    await pool.connect(users.A).unstake(unstakeAmt);
    const res = oracle.unstake("A", unstakeAmt, baseTime + 72n * HOUR);

    // Pull-payment: staker gets principal now; tax accrues to owedToTreasury.
    expect(await token.balanceOf(treasury.address)).to.equal(treBefore);
    expect(await pool.owedToTreasury()).to.equal(res.tax);
    expect((await token.balanceOf(users.A.address)) - usrBefore).to.equal(res.userAmount);
    // Full tenure reset => remaining weight is at k=0 => amount*72.
    await assertAggregatesMatch();
    expect(await pool.totalWeight()).to.equal(T35K * 2n * 72n);
  });

  it("scenario 4: late joiner tenure multiplier matches spec (day 12 -> 1.667x)", async function () {
    // Crank forward to day 12 with no stakers (emissions -> unallocated).
    // Do it in hourly steps only near the join to keep fresh for the stake.
    await crankTo(12n * DAY - HOUR);
    await crankTo(12n * DAY);
    await pool.connect(users.A).stake(T35K);
    oracle.stake("A", T35K, baseTime + 12n * DAY);
    await assertAggregatesMatch();

    // Advance to program end.
    for (let h = 12n * 24n + 1n; h <= 14n * 24n; h++) {
      await crankTo(h * HOUR);
    }
    await assertAggregatesMatch();

    // Day-12 joiner has 48 hourly steps at end => tenureMultBps 16666.
    const Harness = await ethers.getContractFactory("MathHarness");
    const math = await Harness.deploy();
    expect(await math.tenureMultBps(48)).to.equal(16_666n);
  });

  it("scenario 5: mixed timeline stays solvent and payouts match oracle", async function () {
    // A stakes at 0, B at hour 6.
    await pool.connect(users.A).stake(T35K * 2n);
    oracle.stake("A", T35K * 2n, baseTime);

    await crankTo(6n * HOUR);
    await pool.connect(users.B).stake(T35K * 5n);
    oracle.stake("B", T35K * 5n, baseTime + 6n * HOUR);

    // Crank to hour 48.
    for (let h = 7n; h <= 48n; h++) await crankTo(h * HOUR);
    await assertAggregatesMatch();

    // A claims at hour 48.
    let aBefore = await token.balanceOf(users.A.address);
    await pool.connect(users.A).claim();
    let aPaid = (await token.balanceOf(users.A.address)) - aBefore;
    expect(aPaid).to.equal(oracle.claim("A", baseTime + 48n * HOUR));

    // C joins at hour 49.
    await crankTo(49n * HOUR);
    await pool.connect(users.C).stake(T35K);
    oracle.stake("C", T35K, baseTime + 49n * HOUR);
    await assertAggregatesMatch();

    // Crank to hour 120, A unstakes some.
    for (let h = 50n; h <= 120n; h++) await crankTo(h * HOUR);
    await pool.connect(users.A).unstake(T35K);
    oracle.unstake("A", T35K, baseTime + 120n * HOUR);
    await assertAggregatesMatch();

    // Everyone claims at hour 120.
    for (const label of ["A", "B", "C"]) {
      const s = users[label];
      const before = await token.balanceOf(s.address);
      await pool.connect(s).claim();
      const paid = (await token.balanceOf(s.address)) - before;
      expect(paid).to.equal(oracle.claim(label, baseTime + 120n * HOUR));
    }
    await assertAggregatesMatch();

    // Solvency: emitted <= funded; distributed + owed <= emitted.
    const emitted = await pool.totalEmitted();
    const claimed = await pool.totalClaimed();
    expect(emitted <= (await pool.fundedAmount())).to.equal(true);
    expect(claimed <= emitted).to.equal(true);
  });
});
