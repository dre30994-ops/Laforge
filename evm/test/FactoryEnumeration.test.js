const { expect } = require("chai");
const { ethers } = require("hardhat");

// Mirrors the constants the frontend uses (app/src/lib/factoryClient.ts).
const ECOSYSTEM_FEE = 30_000_000_000_000_000n; // 0.03 ETH (tier 1)
const ECOSYSTEM = 1n; // Tier.Ecosystem
const MIN_FUNDING = 10_000_000_000_000n;
const MIN_STAKE = 35_000_000_000n;

/**
 * These tests lock in the exact factory + pool read surface the frontend
 * relies on to enumerate and render pools:
 *
 *   - listPools()        -> factory.poolCount() + factory.allPools(i)
 *   - fetchPoolSummary() -> pool.token()/operator()/treasury()/decimals()/
 *                           durationDays()/stakeTaxBps()/unstakeTaxBps()/
 *                           started()/paused()/stakeVaultBalance()
 *                           and token.symbol()
 *   - poolStatus()       -> started/paused flags
 *   - "auto-append"      -> after createPool is mined, the new pool is
 *                           immediately visible via poolCount/allPools.
 *
 * If any of these break, the pool directory silently stops showing pools, so
 * pinning them at the contract level guards the whole UI read path.
 */
describe("Factory enumeration surface (what the pool directory reads)", function () {
  let factory, launcher, other, treasury, Mock;

  beforeEach(async function () {
    [launcher, other, treasury] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("StakingFactory");
    factory = await Factory.deploy(10000000000000000n, 30000000000000000n, 60000000000000000n, "0xd196eC7D3d77bc914F0193450CFedcf483c5fF13", ethers.ZeroAddress);
    Mock = await ethers.getContractFactory("MockERC20");
  });

  // Deploy a token, mint funding to `caller`, and approve the factory to pull it
  // during createPool (one-time atomic funding).
  async function newToken(symbol = "PONS", decimals = 6, caller = launcher, fundingAmount = MIN_FUNDING) {
    const t = await Mock.deploy("Pons", symbol, decimals);
    await t.mint(caller.address, fundingAmount);
    await t.connect(caller).approve(await factory.getAddress(), fundingAmount);
    return t;
  }

  it("starts with an empty pool list", async function () {
    expect(await factory.poolCount()).to.equal(0n);
  });

  it("createPool emits PoolCreated with the token, deployed pool, and operator", async function () {
    const t = await newToken();
    const tokenAddr = await t.getAddress();

    const tx = await factory
      .connect(launcher)
      .createPool(tokenAddr, treasury.address, 14n, 250n, 500n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    const receipt = await tx.wait();

    // The pool address recorded by the factory must match the event.
    const poolAddr = await factory.poolOf(tokenAddr);
    await expect(tx)
      .to.emit(factory, "PoolCreated")
      .withArgs(
        tokenAddr,
        poolAddr,
        launcher.address,
        treasury.address,
        14n,
        250n,
        500n,
        MIN_FUNDING, // 8th arg is now fundingAmount
        MIN_STAKE,
        ECOSYSTEM // 10th arg: pricing tier
      );

    // Sanity: the pool address is a real deployed contract, not the zero addr.
    expect(poolAddr).to.not.equal(ethers.ZeroAddress);
    expect(receipt.status).to.equal(1);
  });

  it("poolCount increments and allPools(i) returns each new pool in order", async function () {
    const t1 = await newToken("AAA", 6, launcher);
    const t2 = await newToken("BBB", 6, other);
    const t3 = await newToken("CCC", 6, launcher);
    const a1 = await t1.getAddress();
    const a2 = await t2.getAddress();
    const a3 = await t3.getAddress();

    await factory.connect(launcher).createPool(a1, treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    expect(await factory.poolCount()).to.equal(1n);

    await factory.connect(other).createPool(a2, ethers.ZeroAddress, 7n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    expect(await factory.poolCount()).to.equal(2n);

    await factory.connect(launcher).createPool(a3, treasury.address, 1n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    expect(await factory.poolCount()).to.equal(3n);

    // allPools(i) order matches creation order and equals poolOf(token).
    expect(await factory.allPools(0)).to.equal(await factory.poolOf(a1));
    expect(await factory.allPools(1)).to.equal(await factory.poolOf(a2));
    expect(await factory.allPools(2)).to.equal(await factory.poolOf(a3));

    // Reconstruct the exact list the frontend's listPoolAddresses() builds.
    const count = Number(await factory.poolCount());
    const addrs = [];
    for (let i = 0; i < count; i++) addrs.push(await factory.allPools(i));
    expect(addrs).to.deep.equal([
      await factory.poolOf(a1),
      await factory.poolOf(a2),
      await factory.poolOf(a3),
    ]);
  });

  it("a duplicate pool for the same token reverts and does not grow the list", async function () {
    const t = await newToken();
    const tokenAddr = await t.getAddress();

    await factory.connect(launcher).createPool(tokenAddr, treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE });
    expect(await factory.poolCount()).to.equal(1n);

    // Approve `other` too so the failure is PoolExists, not an approval error.
    await t.mint(other.address, MIN_FUNDING);
    await t.connect(other).approve(await factory.getAddress(), MIN_FUNDING);
    await expect(
      factory.connect(other).createPool(tokenAddr, treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, { value: ECOSYSTEM_FEE })
    ).to.be.revertedWithCustomError(factory, "PoolExists");

    // The failed create must not have appended anything.
    expect(await factory.poolCount()).to.equal(1n);
  });

  it("deployed pool getters return exactly what fetchPoolSummary reads", async function () {
    const t = await newToken("GOLD", 8);
    const tokenAddr = await t.getAddress();

    await factory
      .connect(launcher)
      .createPool(tokenAddr, treasury.address, 7n, 250n, 500n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });

    const poolAddr = await factory.poolOf(tokenAddr);
    const pool = await ethers.getContractAt("StakingPool", poolAddr);

    // Every field PoolSummary is built from:
    expect(await pool.token()).to.equal(tokenAddr);
    expect(await pool.operator()).to.equal(launcher.address);
    expect(await pool.treasury()).to.equal(treasury.address);
    expect(await pool.decimals()).to.equal(8n);
    expect(await pool.durationDays()).to.equal(7n);
    expect(await pool.stakeTaxBps()).to.equal(250n);
    expect(await pool.unstakeTaxBps()).to.equal(500n);
    expect(await pool.started()).to.equal(true); // "live" immediately (atomic funding+start)
    expect(await pool.paused()).to.equal(false);
    expect(await pool.stakeVaultBalance()).to.equal(0n);

    // The token symbol the card displays.
    const token = await ethers.getContractAt("MockERC20", tokenAddr);
    expect(await token.symbol()).to.equal("GOLD");
  });

  it("started/paused reflect lifecycle so the status pill is correct", async function () {
    const t = await newToken();
    const tokenAddr = await t.getAddress();
    await factory
      .connect(launcher)
      .createPool(tokenAddr, ethers.ZeroAddress, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    const pool = await ethers.getContractAt("StakingPool", await factory.poolOf(tokenAddr));

    // Created pools are funded + started atomically -> "live".
    expect(await pool.started()).to.equal(true);
    expect(await pool.paused()).to.equal(false);

    // Authority can pause -> "paused".
    await pool.connect(launcher).setPaused(true);
    expect(await pool.started()).to.equal(true);
    expect(await pool.paused()).to.equal(true);
  });

  it("a freshly-created pool is immediately enumerable (auto-append data source)", async function () {
    // Simulates what the frontend does right after a createPool tx is mined:
    // refetch the list and expect the new pool to be present.
    const before = Number(await factory.poolCount());

    const t = await newToken("NEW");
    const tokenAddr = await t.getAddress();
    const tx = await factory
      .connect(launcher)
      .createPool(tokenAddr, treasury.address, 14n, 0n, 0n, MIN_FUNDING, MIN_STAKE, ECOSYSTEM, {
        value: ECOSYSTEM_FEE,
      });
    await tx.wait(); // mined — mirrors waiting for the receipt in the UI

    const after = Number(await factory.poolCount());
    expect(after).to.equal(before + 1);

    // The new pool is the last entry and resolves from its token address.
    const newPool = await factory.allPools(after - 1);
    expect(newPool).to.equal(await factory.poolOf(tokenAddr));
    expect(newPool).to.not.equal(ethers.ZeroAddress);
  });
});
