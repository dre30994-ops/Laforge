import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TIER_ECOSYSTEM, createPool, deployFixture } from "../lib/helpers.js";

describe("StakingPool", async () => {
  it("initializes funded rate > 0", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx);
    const rate = await pool.read.baseRatePerPeriod();
    assert.ok(rate > 0n);
    assert.equal(await pool.read.fundedAmount(), fx.funding);
  });

  it("stake then unstake returns principal when tax is 0", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx);
    const amount = 10n ** 20n;

    await fx.token.write.approve([pool.address, amount], { account: fx.staker.account });
    await pool.write.stake([amount], { account: fx.staker.account });

    const pos = await pool.read.positions([fx.staker.account.address]);
    assert.equal(pos[0], amount);

    const before = await fx.token.read.balanceOf([fx.staker.account.address]);
    await pool.write.unstake([amount], { account: fx.staker.account });
    const after = await fx.token.read.balanceOf([fx.staker.account.address]);
    assert.equal(after - before, amount);
  });

  it("rejects stake after program end", async () => {
    const fx = await deployFixture();
    const { networkHelpers } = fx.connection;
    const pool = await createPool(fx, { durationDays: 1n, tier: TIER_ECOSYSTEM });

    await networkHelpers.time.increase(86_400 + 1);
    await pool.write.crank([0n]);

    const amount = 10n ** 20n;
    await fx.token.write.approve([pool.address, amount], { account: fx.staker.account });
    await assert.rejects(
      () => pool.write.stake([amount], { account: fx.staker.account }),
      /ProgramEnded/,
    );
  });

  it("unstake and claim still work after end once cranked", async () => {
    const fx = await deployFixture();
    const { networkHelpers } = fx.connection;
    const pool = await createPool(fx, { durationDays: 1n });
    const amount = 10n ** 20n;

    await fx.token.write.approve([pool.address, amount], { account: fx.staker.account });
    await pool.write.stake([amount], { account: fx.staker.account });

    await networkHelpers.time.increase(86_400 + 1);
    await pool.write.unstake([amount], { account: fx.staker.account });

    const pos = await pool.read.positions([fx.staker.account.address]);
    assert.equal(pos[0], 0n);
  });

  it("setMinStake cannot exceed 10x constructor value", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx);
    await assert.rejects(
      () => pool.write.setMinStake([fx.minStake * 11n], { account: fx.launcher.account }),
      /MinStakeTooHigh/,
    );
  });

  it("withdrawUnallocated reverts while stake remains", async () => {
    const fx = await deployFixture();
    const { networkHelpers } = fx.connection;
    const pool = await createPool(fx, { durationDays: 1n });
    const amount = 10n ** 20n;

    await fx.token.write.approve([pool.address, amount], { account: fx.staker.account });
    await pool.write.stake([amount], { account: fx.staker.account });

    await networkHelpers.time.increase(86_400 + 7 * 86_400 + 10);
    await assert.rejects(
      () => pool.write.withdrawUnallocated([1n], { account: fx.launcher.account }),
      /RemainingStake/,
    );
  });
});
