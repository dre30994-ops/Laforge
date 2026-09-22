const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DENOM = 1977n;
const HOUR = 3600n;
const DAY = 86400n;
const MIN_FUNDING = 10_000_000_000_000n; // 10M * 1e6 — used as a convenient funding amount
const MIN_STAKE = 35_000_000_000n; // 35k * 1e6

describe("StakingPool lifecycle", function () {
  let token, pool, factory;
  let launcher, treasury, alice, bob, cranker;
  let operator; // alias: operator == launcher in the per-pool model
  const ECOSYSTEM_FEE = 30_000_000_000_000_000n; // 0.03 ether (tier 1)
  const ECOSYSTEM = 1n; // Tier.Ecosystem
  const UNSTAKE_TAX = 500n; // 5% — matches the original behaviour these tests assert

  async function deployViaFactory() {
    [launcher, treasury, alice, bob, cranker] = await ethers.getSigners();
    operator = launcher; // the launcher is the operator and admin

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Pons Token", "PONS", 6);

    const Factory = await ethers.getContractFactory("StakingFactory");
    factory = await Factory.connect(launcher).deploy(10000000000000000n, 30000000000000000n, 60000000000000000n, "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13", ethers.ZeroAddress);

    // Distribute tokens (launcher needs enough to fund pools created below).
    for (const who of [operator, alice, bob]) {
      await token.mint(who.address, 500_000_000_000_000n); // 500M * 1e6
    }
  }

  // Create + fund + start a pool in one transaction: the launcher approves the
  // factory for `fundingAmount`, and createPool pulls it into the new pool and
  // starts it. Returns nothing; sets the module-level `pool`.
  async function createFundedPool(fundingAmount, { unstakeTax = 0n, stakeTax = 0n, duration = 14n } = {}) {
    await token.connect(launcher).approve(await factory.getAddress(), fundingAmount);
    await factory
      .connect(launcher)
      .createPool(await token.getAddress(), treasury.address, duration, stakeTax, unstakeTax, fundingAmount, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    const poolAddr = await factory.poolOf(await token.getAddress());
    pool = await ethers.getContractAt("StakingPool", poolAddr);
  }

  beforeEach(deployViaFactory);

  it("factory records the pool and rejects duplicates", async function () {
    await createFundedPool(MIN_FUNDING, { unstakeTax: UNSTAKE_TAX });

    expect(await factory.poolCount()).to.equal(1n);
    expect(await factory.poolOf(await token.getAddress())).to.equal(await pool.getAddress());

    // Approve the factory again so the failure is PoolExists, not an approval
    // error: the existing pool is live (not ended), so re-creation reverts.
    await token.connect(launcher).approve(await factory.getAddress(), MIN_FUNDING);
    await expect(
      factory
        .connect(launcher)
        .createPool(await token.getAddress(), treasury.address, 14n, 0n, UNSTAKE_TAX, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
          value: ECOSYSTEM_FEE,
        })
    ).to.be.revertedWithCustomError(factory, "PoolExists");
  });

  it("pool constructor set immutables from factory", async function () {
    await createFundedPool(MIN_FUNDING, { unstakeTax: UNSTAKE_TAX, duration: 14n });

    expect(await pool.operator()).to.equal(operator.address);
    expect(await pool.treasury()).to.equal(treasury.address);
    expect(await pool.authority()).to.equal(launcher.address);
    expect(await pool.unstakeTaxBps()).to.equal(UNSTAKE_TAX);
    expect(await pool.stakeTaxBps()).to.equal(0n);
    expect(await pool.durationDays()).to.equal(14n);
    expect(await pool.minStake()).to.equal(MIN_STAKE);
    expect(await pool.nextBoundaryIndex()).to.equal(1n);
    // Pool is already started + funded atomically at creation.
    expect(await pool.started()).to.equal(true);
    expect(await pool.factory()).to.equal(await factory.getAddress());
  });

  it("createPool funds and starts, deriving base rate", async function () {
    await createFundedPool(MIN_FUNDING);

    expect(await pool.started()).to.equal(true);
    expect(await pool.fundedAmount()).to.equal(MIN_FUNDING);
    expect(await pool.rewardVaultBalance()).to.equal(MIN_FUNDING);
    expect(await pool.baseRatePerPeriod()).to.equal(MIN_FUNDING / DENOM);
    expect(await pool.endTs()).to.equal((await pool.startTs()) + 14n * DAY);
  });

  it("stake enforces min stake and updates aggregates", async function () {
    await createFundedPool(MIN_FUNDING);

    await token.connect(alice).approve(await pool.getAddress(), MIN_STAKE);
    await expect(pool.connect(alice).stake(MIN_STAKE - 1n)).to.be.revertedWithCustomError(
      pool,
      "BelowMinimumStake"
    );

    await token.connect(alice).approve(await pool.getAddress(), MIN_STAKE);
    await pool.connect(alice).stake(MIN_STAKE);

    expect(await pool.totalStaked()).to.equal(MIN_STAKE);
    // Fresh stake => k=0 => weight numerator 72.
    expect(await pool.totalWeight()).to.equal(MIN_STAKE * 72n);
    expect(await pool.rampingStake()).to.equal(MIN_STAKE);
    const p = await pool.positions(alice.address);
    expect(p.amount).to.equal(MIN_STAKE);
  });

  it("full lifecycle: stake, crank, accrue rewards, claim", async function () {
    await createFundedPool(200_000_000_000_000n); // 200M
    const stakeAmt = 1_000_000_000_000n; // 1M

    await token.connect(alice).approve(await pool.getAddress(), stakeAmt);
    await pool.connect(alice).stake(stakeAmt);

    // Advance ~10 hours, cranking each hour to keep the pool fresh.
    for (let h = 0; h < 10; h++) {
      await time.increase(HOUR);
      await pool.connect(cranker).crank(0);
    }

    const pending = await pool.pendingRewards(alice.address);
    expect(pending).to.be.gt(0n);

    const balBefore = await token.balanceOf(alice.address);
    await pool.connect(alice).claim();
    const balAfter = await token.balanceOf(alice.address);
    expect(balAfter - balBefore).to.be.gt(0n);
    // Sole staker: everything emitted so far should be claimable (no unallocated
    // because there was always weight after the first stake+crank).
    expect(await pool.totalClaimed()).to.equal(balAfter - balBefore);
  });

  it("staleness gate blocks stake when not cranked", async function () {
    await createFundedPool(MIN_FUNDING);
    await time.increase(HOUR + 1n); // now stale (>= one tenure step since start)
    await token.connect(alice).approve(await pool.getAddress(), MIN_STAKE);
    await expect(pool.connect(alice).stake(MIN_STAKE)).to.be.revertedWithCustomError(
      pool,
      "PoolStale"
    );
  });

  it("unstake applies 5% tax to treasury and returns 95% to user", async function () {
    await createFundedPool(200_000_000_000_000n, { unstakeTax: UNSTAKE_TAX });
    const stakeAmt = 1_000_000_000_000n; // 1M

    await token.connect(alice).approve(await pool.getAddress(), stakeAmt);
    await pool.connect(alice).stake(stakeAmt);

    await time.increase(HOUR);
    await pool.connect(cranker).crank(0);

    const treBefore = await token.balanceOf(treasury.address);
    const userBefore = await token.balanceOf(alice.address);

    const unstakeAmt = 400_000_000_000n; // 400k
    await pool.connect(alice).unstake(unstakeAmt);

    const expectedTax = (unstakeAmt * 500n) / 10_000n;
    const expectedUser = unstakeAmt - expectedTax;

    // Pull-payment: the staker gets principal immediately; the tax is accrued
    // (not pushed) so a hostile treasury can't block unstake.
    expect((await token.balanceOf(alice.address)) - userBefore).to.equal(expectedUser);
    expect(await token.balanceOf(treasury.address)).to.equal(treBefore); // no push
    expect(await pool.owedToTreasury()).to.equal(expectedTax);
    expect(await pool.totalStaked()).to.equal(stakeAmt - unstakeAmt);

    // Treasury pulls the accrued tax.
    await pool.connect(alice).withdrawTreasury(); // permissionless; pays treasury
    expect((await token.balanceOf(treasury.address)) - treBefore).to.equal(expectedTax);
    expect(await pool.owedToTreasury()).to.equal(0n);
  });

  it("claim allowed while paused; stake blocked while paused", async function () {
    await createFundedPool(200_000_000_000_000n);
    const stakeAmt = 1_000_000_000_000n;
    await token.connect(alice).approve(await pool.getAddress(), stakeAmt);
    await pool.connect(alice).stake(stakeAmt);

    await time.increase(HOUR);
    await pool.connect(cranker).crank(0);

    await pool.connect(launcher).setPaused(true);

    await token.connect(alice).approve(await pool.getAddress(), stakeAmt);
    await expect(pool.connect(alice).stake(stakeAmt)).to.be.revertedWithCustomError(pool, "Paused");

    // Claim still works.
    await expect(pool.connect(alice).claim()).to.not.be.reverted;
  });

  it("compound folds rewards into principal", async function () {
    await createFundedPool(200_000_000_000_000n);
    const stakeAmt = 1_000_000_000_000n;
    await token.connect(alice).approve(await pool.getAddress(), stakeAmt);
    await pool.connect(alice).stake(stakeAmt);

    for (let h = 0; h < 5; h++) {
      await time.increase(HOUR);
      await pool.connect(cranker).crank(0);
    }

    const before = (await pool.positions(alice.address)).amount;
    await pool.connect(alice).compound();
    const after = (await pool.positions(alice.address)).amount;
    expect(after).to.be.gt(before);
    expect(await pool.totalStaked()).to.equal(after);
  });

  it("two-step authority transfer", async function () {
    await createFundedPool(MIN_FUNDING);

    await expect(pool.connect(bob).transferAuthority(bob.address)).to.be.revertedWithCustomError(
      pool,
      "Unauthorized"
    );
    await pool.connect(launcher).transferAuthority(bob.address);
    expect(await pool.pendingAuthority()).to.equal(bob.address);

    await expect(pool.connect(alice).acceptAuthority()).to.be.revertedWithCustomError(
      pool,
      "Unauthorized"
    );
    await pool.connect(bob).acceptAuthority();
    expect(await pool.authority()).to.equal(bob.address);
  });
});
