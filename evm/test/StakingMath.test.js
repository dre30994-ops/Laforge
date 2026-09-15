const { expect } = require("chai");
const { ethers } = require("hardhat");

// These golden values are taken directly from the Rust reference tests in
// crates/staking-math (constants.rs, emission.rs, weight.rs, accrual.rs).
describe("StakingMath parity with Rust reference", function () {
  let math;
  const DENOM = 1977n; // 1-day ramp (105) + 13-day plateau (1_872)
  const MULT_DENOM = 12n;
  const ACC_SCALE = 10n ** 18n;
  const SECONDS_PER_DAY = 86400n;

  before(async function () {
    const Harness = await ethers.getContractFactory("MathHarness");
    math = await Harness.deploy();
  });

  it("derive_base_rate matches known deposits", async function () {
    expect(await math.deriveBaseRate(10_000_000_000_000n)).to.equal(5_058_168_942n);
    expect(await math.deriveBaseRate(50_000_000_000_000n)).to.equal(25_290_844_714n);
    expect(await math.deriveBaseRate(200_000_000_000_000n)).to.equal(101_163_378_856n);
  });

  it("emission multiplier numerator ramps then plateaus", async function () {
    expect(await math.emissionMultNumerator(0)).to.equal(12n);
    expect(await math.emissionMultNumerator(6)).to.equal(18n);
    expect(await math.emissionMultNumerator(11)).to.equal(23n);
    expect(await math.emissionMultNumerator(12)).to.equal(24n);
    expect(await math.emissionMultNumerator(1000)).to.equal(24n);
  });

  it("emission multiplier bps endpoints are exact", async function () {
    expect(await math.emissionMultBps(0)).to.equal(10_000n);
    expect(await math.emissionMultBps(12)).to.equal(20_000n);
  });

  it("plateau step is exactly double the base step", async function () {
    const r0 = 200_000_000_000_000n / DENOM;
    const base = await math.emissionForStep(r0, 0);
    const plateau = await math.emissionForStep(r0, 12);
    expect(plateau).to.equal(base * 2n);
    expect(base).to.equal(r0 * 6n); // PERIODS_PER_EMISSION_STEP = 6 (2-hour step)
  });

  it("cumulative counts whole periods only", async function () {
    const r0 = 200_000_000_000_000n / DENOM;
    expect(await math.cumulativeEmitted(r0, 0)).to.equal(0n);
    expect(await math.cumulativeEmitted(r0, 1199)).to.equal(0n);
    expect(await math.cumulativeEmitted(r0, 1200)).to.equal(r0);
  });

  it("ramp completes in 1 day: 105 period-units (numerator 1260)", async function () {
    const oneDay = 1n * SECONDS_PER_DAY;
    const num = await math.cumulativeNumerator(oneDay);
    expect(num).to.equal(1_260n);
    expect(num / MULT_DENOM).to.equal(105n);
  });

  it("full-program numerator is 23724 and divisible by DENOM", async function () {
    const num = await math.cumulativeNumerator(14n * SECONDS_PER_DAY);
    expect(num).to.equal(23_724n);
    expect(num % MULT_DENOM).to.equal(0n);
    expect(num / MULT_DENOM).to.equal(DENOM);
  });

  it("remaining period units at start equals full program, zero at end", async function () {
    expect(await math.remainingPeriodUnits(0)).to.equal(23_724n);
    expect(await math.remainingPeriodUnits(14n * SECONDS_PER_DAY)).to.equal(0n);
  });

  it("remaining + elapsed always equals 23724 across every hour", async function () {
    for (let hour = 0n; hour <= 14n * 24n; hour++) {
      const elapsed = hour * 3600n;
      const soFar = await math.cumulativeNumerator(elapsed);
      const remaining = await math.remainingPeriodUnits(elapsed);
      expect(soFar + remaining).to.equal(23_724n);
    }
  });

  it("weight numerator endpoints", async function () {
    expect(await math.weightNumerator(0)).to.equal(72n);
    expect(await math.weightNumerator(36)).to.equal(108n);
    expect(await math.weightNumerator(72)).to.equal(144n);
    expect(await math.weightNumerator(1000)).to.equal(144n);
  });

  it("tenure multiplier bps matches spec (late joiners)", async function () {
    expect(await math.tenureMultBps(72)).to.equal(20_000n);
    expect(await math.tenureMultBps(48)).to.equal(16_666n);
    expect(await math.tenureMultBps(24)).to.equal(13_333n);
    expect(await math.tenureMultBps(0)).to.equal(10_000n);
  });

  it("weighted deposit ts defeats wait-then-dump", async function () {
    const now = 3n * SECONDS_PER_DAY;
    const ts = await math.weightedDepositTs(1_000_000n, 0n, 10_000_000_000_000n, now);
    const steps = (now - ts) / 3600n;
    expect(steps).to.equal(0n);
  });

  it("weighted deposit ts of a fresh position is now; equal stakes midpoint", async function () {
    expect(await math.weightedDepositTs(0n, 0n, 5000n, 12345n)).to.equal(12345n);
    expect(await math.weightedDepositTs(1000n, 100n, 1000n, 900n)).to.equal(500n);
  });

  it("accrual reduces to the verified k=1 case", async function () {
    // stake * [73*A_now - 72*A_0 - A_1] / ACC_SCALE, deposit at boundary 0.
    const a0 = 0n, a1 = 5000n, aNow = 9000n;
    const g0 = a0, g1 = g0 + a1;
    // Use stake = ACC_SCALE so the division cancels for an exact bracket check.
    const stake = ACC_SCALE;
    const got = await math.accrual(stake, a0, g0, 0n, 1n, aNow, g1);
    const expected = 73n * aNow - 72n * a0 - a1;
    expect(got).to.equal(expected);
  });

  it("accrual matured position collapses to constant weight 144", async function () {
    const stake = ACC_SCALE;
    const got = await math.accrual(stake, 1000n, 77_777n, 72n, 72n, 4000n, 77_777n);
    expect(got).to.equal(144n * (4000n - 1000n));
  });

  it("accrual split settlement equals single settlement", async function () {
    const a = (n) => 100n * n;
    const g = (n) => 100n * ((n * (n + 1n)) / 2n);
    const stake = ACC_SCALE;

    const single = await math.accrual(stake, a(0n), g(0n), 0n, 10n, a(10n), g(10n));
    const first = await math.accrual(stake, a(0n), g(0n), 0n, 4n, a(4n), g(4n));
    const second = await math.accrual(stake, a(4n), g(4n), 4n, 10n, a(10n), g(10n));
    expect(first + second).to.equal(single);
  });

  it("accrual with zero stake is zero", async function () {
    expect(await math.accrual(0n, 0n, 0n, 0n, 50n, 12345n, 0n)).to.equal(0n);
  });
});
