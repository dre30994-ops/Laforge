import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MARKETING_FEE, TIER_BRONZE, BRONZE_FEE, createPool, deployFixture } from "../lib/helpers.js";

const SLOT = 12n * 60n * 60n;

describe("MarketingDesk", async () => {
  it("unlocks Marketing for the operator who pays the exact fee", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx, { tier: TIER_BRONZE, value: BRONZE_FEE, durationDays: 2n });
    const desk = await fx.viem.deployContract("MarketingDesk", [
      MARKETING_FEE,
      fx.deployer.account.address,
      fx.factory.address,
    ]);

    const before = await fx.publicClient.getBalance({ address: fx.deployer.account.address });
    await desk.write.buyMarketing([pool.address], {
      account: fx.launcher.account,
      value: MARKETING_FEE,
    });
    const after = await fx.publicClient.getBalance({ address: fx.deployer.account.address });

    assert.equal(await desk.read.hasMarketing([pool.address]), true);
    assert.equal(await pool.read.tier(), TIER_BRONZE);
    assert.equal(await desk.read.isTrending([pool.address]), true);
    const until = (await desk.read.trendingUntil([pool.address])) as bigint;
    const unlocked = (await desk.read.unlockedAt([pool.address])) as bigint;
    assert.ok(unlocked > 0n);
    assert.ok(until >= unlocked + SLOT);
    assert.ok(after > before);
  });

  it("rejects the wrong fee", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx, { tier: TIER_BRONZE, value: BRONZE_FEE, durationDays: 2n });
    const desk = await fx.viem.deployContract("MarketingDesk", [
      MARKETING_FEE,
      fx.deployer.account.address,
      fx.factory.address,
    ]);
    await assert.rejects(
      () =>
        desk.write.buyMarketing([pool.address], {
          account: fx.launcher.account,
          value: BRONZE_FEE,
        }),
      /BadFee/,
    );
  });

  it("lets a community member pay for a factory pool", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx, { tier: TIER_BRONZE, value: BRONZE_FEE, durationDays: 2n });
    const desk = await fx.viem.deployContract("MarketingDesk", [
      MARKETING_FEE,
      fx.deployer.account.address,
      fx.factory.address,
    ]);
    await desk.write.buyMarketing([pool.address], {
      account: fx.staker.account,
      value: MARKETING_FEE,
    });
    assert.equal(await desk.read.hasMarketing([pool.address]), true);
    assert.equal(await desk.read.isTrending([pool.address]), true);
    assert.equal(await pool.read.tier(), TIER_BRONZE);
    assert.equal(
      (await pool.read.operator()).toLowerCase(),
      fx.launcher.account.address.toLowerCase(),
    );
  });

  it("extends trending on a second purchase", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx, { tier: TIER_BRONZE, value: BRONZE_FEE, durationDays: 2n });
    const desk = await fx.viem.deployContract("MarketingDesk", [
      MARKETING_FEE,
      fx.deployer.account.address,
      fx.factory.address,
    ]);
    await desk.write.buyMarketing([pool.address], {
      account: fx.staker.account,
      value: MARKETING_FEE,
    });
    const first = (await desk.read.trendingUntil([pool.address])) as bigint;
    await desk.write.buyMarketing([pool.address], {
      account: fx.launcher.account,
      value: MARKETING_FEE,
    });
    const second = (await desk.read.trendingUntil([pool.address])) as bigint;
    assert.ok(second >= first + SLOT);
    assert.equal(await desk.read.hasMarketing([pool.address]), true);
  });

  it("rejects a pool from another factory", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx, { tier: TIER_BRONZE, value: BRONZE_FEE, durationDays: 2n });
    const desk = await fx.viem.deployContract("MarketingDesk", [
      MARKETING_FEE,
      fx.deployer.account.address,
      fx.deployer.account.address,
    ]);
    await assert.rejects(
      () =>
        desk.write.buyMarketing([pool.address], {
          account: fx.staker.account,
          value: MARKETING_FEE,
        }),
      /UnknownPool/,
    );
  });
});
