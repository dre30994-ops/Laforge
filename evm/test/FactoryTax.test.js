const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Per-tier launch fees (msg.value must equal the chosen tier's fee exactly).
const BRONZE_FEE = 10_000_000_000_000_000n; // 0.01 ether (tier 0)
const ECOSYSTEM_FEE = 30_000_000_000_000_000n; // 0.03 ether (tier 1)
const MARKETING_FEE = 60_000_000_000_000_000n; // 0.06 ether (tier 2)
// Tier enum values passed from JS as uint.
const BRONZE = 0n;
const ECOSYSTEM = 1n;
const MARKETING = 2n;
// New fixed recipient of all tier fees.
const FEE_RECIPIENT = "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13";
const MIN_FUNDING = 10_000_000_000_000n;
const MIN_STAKE = 35_000_000_000n;
const T35K = 35_000_000_000n;
const FUNDED_200M = 200_000_000_000_000n;
const HOUR = 3600n;
const MAX_TAX = 1000n;

describe("Factory: per-pool operator/treasury, launch fee, tax config", function () {
  let factory, launcher, other, treasury, Mock;

  beforeEach(async function () {
    [launcher, other, treasury] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("StakingFactory");
    factory = await Factory.deploy(BRONZE_FEE, ECOSYSTEM_FEE, MARKETING_FEE, FEE_RECIPIENT);
    Mock = await ethers.getContractFactory("MockERC20");
  });

  // Deploy a fresh token, mint `fundingAmount` to `caller`, and approve the
  // factory to pull it during createPool (one-time atomic funding).
  async function newFundedToken(caller = launcher, fundingAmount = MIN_FUNDING) {
    const t = await Mock.deploy("Pons", "PONS", 6);
    await t.mint(caller.address, fundingAmount);
    await t.connect(caller).approve(await factory.getAddress(), fundingAmount);
    return t;
  }

  // Deploy a fresh token without any funding approval — for revert paths that
  // trigger before the funding transfer.
  async function newToken() {
    return Mock.deploy("Pons", "PONS", 6);
  }

  it("requires exactly each tier's launch fee (BadLaunchFee on mismatch)", async function () {
    // BadLaunchFee is checked before the funding transfer, so no approval needed.
    const cases = [
      { tier: BRONZE, fee: BRONZE_FEE, duration: 2n },
      { tier: ECOSYSTEM, fee: ECOSYSTEM_FEE, duration: 14n },
      { tier: MARKETING, fee: MARKETING_FEE, duration: 14n },
    ];
    for (const { tier, fee, duration } of cases) {
      const tLow = await newToken();
      const tHigh = await newToken();
      await expect(
        factory.createPool(await tLow.getAddress(), treasury.address, duration, 0n, 0n, MIN_FUNDING, MIN_STAKE, tier, {
          value: fee - 1n,
        })
      ).to.be.revertedWithCustomError(factory, "BadLaunchFee");
      await expect(
        factory.createPool(await tHigh.getAddress(), treasury.address, duration, 0n, 0n, MIN_FUNDING, MIN_STAKE, tier, {
          value: fee + 1n,
        })
      ).to.be.revertedWithCustomError(factory, "BadLaunchFee");
    }
  });

  it("feeForTier returns the fixed per-tier fee", async function () {
    expect(await factory.feeForTier(BRONZE)).to.equal(BRONZE_FEE);
    expect(await factory.feeForTier(ECOSYSTEM)).to.equal(ECOSYSTEM_FEE);
    expect(await factory.feeForTier(MARKETING)).to.equal(MARKETING_FEE);
    // Public constants match the JS mirror values.
    expect(await factory.BRONZE_FEE()).to.equal(BRONZE_FEE);
    expect(await factory.ECOSYSTEM_FEE()).to.equal(ECOSYSTEM_FEE);
    expect(await factory.MARKETING_FEE()).to.equal(MARKETING_FEE);
  });

  it("Bronze rejects durationDays>2 (BadDuration) and accepts durationDays<=2", async function () {
    // Bronze is capped at BRONZE_MAX_DURATION_DAYS (=2).
    const tBad = await newToken();
    await expect(
      factory.createPool(await tBad.getAddress(), treasury.address, 3n, 0n, 0n, MIN_FUNDING, MIN_STAKE, BRONZE, {
        value: BRONZE_FEE,
      })
    ).to.be.revertedWithCustomError(factory, "BadDuration");
    expect(await factory.BRONZE_MAX_DURATION_DAYS()).to.equal(2n);

    // <= 2 days is accepted with the Bronze fee.
    const tOk = await newFundedToken(launcher);
    await factory
      .connect(launcher)
      .createPool(await tOk.getAddress(), treasury.address, 2n, 0n, 0n, MIN_FUNDING, MIN_STAKE, BRONZE, {
        value: BRONZE_FEE,
      });
    const pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await tOk.getAddress()));
    expect(await pool.durationDays()).to.equal(2n);
    expect(await pool.started()).to.equal(true);
    expect(await pool.tier()).to.equal(BRONZE);
  });

  it("records the created tier on-chain (pool.tier) for server-side gating", async function () {
    // Marketing tier: the pool records tier=2 so the metadata worker can verify
    // (via eth_call) that a pool actually paid for Marketing before exposing its
    // social links server-side.
    const tM = await newFundedToken(launcher);
    await factory
      .connect(launcher)
      .createPool(await tM.getAddress(), treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, MARKETING, {
        value: MARKETING_FEE,
      });
    const poolM = await ethers.getContractAt("StakingPool", await factory.poolOf(await tM.getAddress()));
    expect(await poolM.tier()).to.equal(MARKETING);

    // Ecosystem tier records tier=1.
    const tE = await newFundedToken(other);
    await factory
      .connect(other)
      .createPool(await tE.getAddress(), treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    const poolE = await ethers.getContractAt("StakingPool", await factory.poolOf(await tE.getAddress()));
    expect(await poolE.tier()).to.equal(ECOSYSTEM);
  });

  it("rejects zero funding", async function () {
    const t = await newToken();
    await expect(
      factory.createPool(await t.getAddress(), treasury.address, 14n, 0n, 0n, 0n, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      })
    ).to.be.revertedWithCustomError(factory, "ZeroFunding");
  });

  it("forwards the launch fee to the fixed recipient", async function () {
    const t = await newFundedToken(launcher);
    const before = await ethers.provider.getBalance(FEE_RECIPIENT);
    await factory
      .connect(launcher)
      .createPool(await t.getAddress(), treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    const after = await ethers.provider.getBalance(FEE_RECIPIENT);
    expect(after - before).to.equal(ECOSYSTEM_FEE);
  });

  it("sets operator = launcher and the launcher-selected treasury; funds and starts", async function () {
    const t = await newFundedToken(launcher);
    await factory
      .connect(launcher)
      .createPool(await t.getAddress(), treasury.address, 14n, 250n, 500n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    const pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await t.getAddress()));
    expect(await pool.operator()).to.equal(launcher.address);
    expect(await pool.authority()).to.equal(launcher.address);
    expect(await pool.treasury()).to.equal(treasury.address);
    expect(await pool.stakeTaxBps()).to.equal(250n);
    expect(await pool.unstakeTaxBps()).to.equal(500n);
    // Funded + started atomically.
    expect(await pool.started()).to.equal(true);
    expect(await pool.fundedAmount()).to.equal(MIN_FUNDING);
  });

  it("rejects tax above the 10% cap", async function () {
    // TaxTooHigh is checked before the funding transfer.
    const t = await newToken();
    await expect(
      factory.createPool(await t.getAddress(), treasury.address, 14n, MAX_TAX + 1n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      })
    ).to.be.revertedWithCustomError(factory, "TaxTooHigh");
    await expect(
      factory.createPool(await t.getAddress(), treasury.address, 14n, 0n, MAX_TAX + 1n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      })
    ).to.be.revertedWithCustomError(factory, "TaxTooHigh");
  });

  it("rejects nonzero tax when no treasury is set", async function () {
    const t = await newToken();
    await expect(
      factory.createPool(await t.getAddress(), ethers.ZeroAddress, 14n, 1n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      })
    ).to.be.revertedWithCustomError(factory, "TaxWithoutTreasury");
  });

  it("allows a no-treasury, tax-free pool", async function () {
    const t = await newFundedToken(launcher);
    await factory.connect(launcher).createPool(await t.getAddress(), ethers.ZeroAddress, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
      value: ECOSYSTEM_FEE,
    });
    const pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await t.getAddress()));
    expect(await pool.treasury()).to.equal(ethers.ZeroAddress);
    expect(await pool.stakeTaxBps()).to.equal(0n);
  });

  it("two launchers get isolated pools with their own operator/treasury", async function () {
    const t1 = await Mock.deploy("Pons", "PONS", 6);
    const t2 = await Mock.deploy("Pons", "PONS", 6);
    await t1.mint(launcher.address, MIN_FUNDING);
    await t1.connect(launcher).approve(await factory.getAddress(), MIN_FUNDING);
    await t2.mint(other.address, MIN_FUNDING);
    await t2.connect(other).approve(await factory.getAddress(), MIN_FUNDING);

    await factory.connect(launcher).createPool(await t1.getAddress(), treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    await factory.connect(other).createPool(await t2.getAddress(), other.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });

    const p1 = await ethers.getContractAt("StakingPool", await factory.poolOf(await t1.getAddress()));
    const p2 = await ethers.getContractAt("StakingPool", await factory.poolOf(await t2.getAddress()));
    expect(await p1.operator()).to.equal(launcher.address);
    expect(await p2.operator()).to.equal(other.address);
    expect(await p1.treasury()).to.equal(treasury.address);
    expect(await p2.treasury()).to.equal(other.address);
    // Isolation: each pool records its own operator; both are started+funded.
    expect(await p1.started()).to.equal(true);
    expect(await p2.started()).to.equal(true);
    expect(await p1.fundedAmount()).to.equal(MIN_FUNDING);
    expect(await p2.fundedAmount()).to.equal(MIN_FUNDING);
  });
});

describe("Stake tax taken from principal", function () {
  let factory, launcher, treasury, alice, cranker, token, pool;
  const STAKE_TAX = 300n; // 3%

  beforeEach(async function () {
    [launcher, treasury, alice, cranker] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Pons", "PONS", 6);
    const Factory = await ethers.getContractFactory("StakingFactory");
    factory = await Factory.deploy(BRONZE_FEE, ECOSYSTEM_FEE, MARKETING_FEE, FEE_RECIPIENT);

    for (const who of [launcher, alice]) await token.mint(who.address, FUNDED_200M);
    // One-time atomic funding via the factory.
    await token.connect(launcher).approve(await factory.getAddress(), FUNDED_200M);
    await factory.connect(launcher).createPool(await token.getAddress(), treasury.address, 14n, STAKE_TAX, 0n, FUNDED_200M, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await token.getAddress()));
  });

  it("accrues the stake tax for the treasury (pull) and stakes the net amount", async function () {
    const amount = T35K * 2n; // 70k, well above min after tax
    const expectedTax = (amount * STAKE_TAX) / 10_000n;
    const net = amount - expectedTax;

    const treBefore = await token.balanceOf(treasury.address);
    await token.connect(alice).approve(await pool.getAddress(), amount);
    await pool.connect(alice).stake(amount);

    // Pull-payment: tax accrues internally; nothing is pushed to the treasury
    // during stake (so a hostile treasury can't block staking).
    expect(await token.balanceOf(treasury.address)).to.equal(treBefore);
    expect(await pool.owedToTreasury()).to.equal(expectedTax);
    expect((await pool.positions(alice.address)).amount).to.equal(net);
    expect(await pool.totalStaked()).to.equal(net);
    // Net principal must still clear the minimum stake.
    expect(net >= MIN_STAKE).to.equal(true);

    // Treasury pulls the accrued tax.
    await pool.connect(alice).withdrawTreasury();
    expect((await token.balanceOf(treasury.address)) - treBefore).to.equal(expectedTax);
    expect(await pool.owedToTreasury()).to.equal(0n);
  });
});

describe("Token-safety: fee-on-transfer and reentrancy are rejected", function () {
  let factory, launcher, treasury, alice;

  beforeEach(async function () {
    [launcher, treasury, alice] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("StakingFactory");
    factory = await Factory.deploy(BRONZE_FEE, ECOSYSTEM_FEE, MARKETING_FEE, FEE_RECIPIENT);
  });

  it("fee-on-transfer token: createPool funding reverts with InexactTransfer", async function () {
    const Fee = await ethers.getContractFactory("FeeOnTransferERC20");
    const feeToken = await Fee.deploy(6, 100n); // 1% fee
    await feeToken.mint(launcher.address, FUNDED_200M);
    await feeToken.connect(launcher).approve(await factory.getAddress(), MIN_FUNDING);
    // The factory transfers the funding into the new pool, but the pool receives
    // less than requested => the pool's strict-delta check reverts the whole tx.
    await expect(
      factory.connect(launcher).createPool(await feeToken.getAddress(), ethers.ZeroAddress, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE })
    ).to.be.revertedWithCustomError(await ethers.getContractFactory("StakingPool"), "InexactTransfer");
  });

  it("fee-on-transfer token: staking reverts with InexactTransfer", async function () {
    const Fee = await ethers.getContractFactory("FeeOnTransferERC20");
    const ft = await Fee.deploy(6, 100n);
    // Funding a fee-on-transfer token through createPool already reverts with
    // the strict-delta check — which is the token-safety guarantee. We assert it
    // reverts on the funding path (createPool), since a fee token can never be
    // successfully launched (and thus never reach a stake).
    await ft.mint(launcher.address, FUNDED_200M);
    await ft.connect(launcher).approve(await factory.getAddress(), MIN_FUNDING);
    await expect(
      factory.connect(launcher).createPool(await ft.getAddress(), ethers.ZeroAddress, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE })
    ).to.be.revertedWithCustomError(await ethers.getContractFactory("StakingPool"), "InexactTransfer");
  });

  it("reentrant token: claim reentry during payout is blocked by the guard", async function () {
    const Re = await ethers.getContractFactory("ReentrantERC20");
    const rt = await Re.deploy(6);
    await rt.mint(launcher.address, FUNDED_200M);
    await rt.connect(launcher).approve(await factory.getAddress(), FUNDED_200M);
    await factory.connect(launcher).createPool(await rt.getAddress(), ethers.ZeroAddress, 14n, 0n, 0n, FUNDED_200M, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    const p = await ethers.getContractAt("StakingPool", await factory.poolOf(await rt.getAddress()));

    // Launcher stakes, accrues, then a claim triggers a reentrant claim() on transfer.
    await rt.mint(alice.address, FUNDED_200M);
    await rt.connect(alice).approve(await p.getAddress(), FUNDED_200M);
    await p.connect(alice).stake(T35K);
    await time.increase(HOUR);
    await p.connect(launcher).crank(0);

    // Point the token's attack at the pool and enable it.
    await rt.setTarget(await p.getAddress());
    await rt.enableAttack(true);

    // The outer claim transfers reward tokens to alice; the token tries to
    // reenter claim(); the ReentrancyGuard must make the whole tx revert.
    await expect(p.connect(alice).claim()).to.be.reverted;
  });
});

describe("H-1: a hostile treasury cannot block stake/unstake (pull-payment)", function () {
  let factory, launcher, treasury, alice, token, pool;
  const UNSTAKE_TAX = 500n; // 5%
  const STAKE_AMT = T35K * 4n;

  beforeEach(async function () {
    [launcher, treasury, alice] = await ethers.getSigners();
    factory = await (await ethers.getContractFactory("StakingFactory")).deploy(BRONZE_FEE, ECOSYSTEM_FEE, MARKETING_FEE, FEE_RECIPIENT);

    // A token that reverts on any transfer to the treasury address — i.e. the
    // treasury is hostile / would brick a pushed tax payment.
    const Block = await ethers.getContractFactory("BlockRecipientERC20");
    token = await Block.deploy(6);
    await token.mint(launcher.address, FUNDED_200M);
    await token.mint(alice.address, FUNDED_200M);

    // Launch a taxed pool with this treasury.
    await token.connect(launcher).approve(await factory.getAddress(), FUNDED_200M);
    await factory
      .connect(launcher)
      .createPool(await token.getAddress(), treasury.address, 14n, 0n, UNSTAKE_TAX, FUNDED_200M, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    pool = await ethers.getContractAt("StakingPool", await factory.poolOf(await token.getAddress()));

    // Now make the token block transfers to the treasury (hostile).
    await token.setBlocked(treasury.address);

    await token.connect(alice).approve(await pool.getAddress(), FUNDED_200M);
    await pool.connect(alice).stake(STAKE_AMT);
    await time.increase(HOUR);
    await pool.connect(launcher).crank(0);
  });

  it("unstake succeeds and returns principal even though the treasury is blocked", async function () {
    const unstakeAmt = T35K * 2n;
    const expectedTax = (unstakeAmt * UNSTAKE_TAX) / 10_000n;
    const userBefore = await token.balanceOf(alice.address);

    // Would revert under a push design (transfer to blocked treasury); with the
    // pull-payment it succeeds and only accrues the tax.
    await pool.connect(alice).unstake(unstakeAmt);

    expect((await token.balanceOf(alice.address)) - userBefore).to.equal(unstakeAmt - expectedTax);
    expect(await pool.owedToTreasury()).to.equal(expectedTax);

    // The treasury's own pull reverts (it's blocked) — but that only affects the
    // treasury, never the staker, and the accrual is preserved for later.
    await expect(pool.connect(alice).withdrawTreasury()).to.be.revertedWith("recipient blocked");
    expect(await pool.owedToTreasury()).to.equal(expectedTax);
  });

  it("stake succeeds with a stake tax even though the treasury is blocked", async function () {
    // Redeploy with a stake tax instead (fresh token/pool).
    const Block = await ethers.getContractFactory("BlockRecipientERC20");
    const t2 = await Block.deploy(6);
    await t2.mint(launcher.address, FUNDED_200M);
    await t2.mint(alice.address, FUNDED_200M);
    await t2.connect(launcher).approve(await factory.getAddress(), FUNDED_200M);
    await factory
      .connect(launcher)
      .createPool(await t2.getAddress(), treasury.address, 14n, 500n, 0n, FUNDED_200M, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    const p2 = await ethers.getContractAt("StakingPool", await factory.poolOf(await t2.getAddress()));
    await t2.setBlocked(treasury.address);

    await t2.connect(alice).approve(await p2.getAddress(), FUNDED_200M);
    const amount = T35K * 2n;
    await p2.connect(alice).stake(amount); // must not revert
    expect(await p2.owedToTreasury()).to.equal((amount * 500n) / 10_000n);
  });
});
