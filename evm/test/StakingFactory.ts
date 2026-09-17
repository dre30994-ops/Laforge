import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRONZE_FEE,
  ECOSYSTEM_FEE,
  MARKETING_FEE,
  TIER_BRONZE,
  TIER_ECOSYSTEM,
  createPool,
  deployFixture,
} from "../lib/helpers.js";

describe("StakingFactory", async () => {
  it("deploys with strictly increasing fees", async () => {
    const { factory } = await deployFixture();
    assert.equal(await factory.read.BRONZE_FEE(), BRONZE_FEE);
    assert.equal(await factory.read.ECOSYSTEM_FEE(), ECOSYSTEM_FEE);
    assert.equal(await factory.read.MARKETING_FEE(), MARKETING_FEE);
  });

  it("createPool records poolOf and allPools", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx);
    assert.equal((await fx.factory.read.poolOf([fx.token.address])).toLowerCase(), pool.address.toLowerCase());
    assert.equal(await fx.factory.read.poolCount(), 1n);
    assert.equal(await pool.read.started(), true);
    assert.equal(await pool.read.durationDays(), 14n);
  });

  it("rejects Bronze duration above 2 days", async () => {
    const fx = await deployFixture();
    await assert.rejects(
      () =>
        createPool(fx, {
          durationDays: 3n,
          tier: TIER_BRONZE,
          value: BRONZE_FEE,
        }),
      /BadDuration/,
    );
  });

  it("rejects wrong launch fee", async () => {
    const fx = await deployFixture();
    await assert.rejects(
      () => createPool(fx, { tier: TIER_ECOSYSTEM, value: BRONZE_FEE }),
      /BadLaunchFee/,
    );
  });

  it("rejects zero minStake", async () => {
    const fx = await deployFixture();
    await assert.rejects(() => createPool(fx, { minStake: 0n }), /ZeroMinStake/);
  });

  it("rejects tax without treasury", async () => {
    const fx = await deployFixture();
    await assert.rejects(() => createPool(fx, { stakeTaxBps: 100n }), /TaxWithoutTreasury/);
  });
});
