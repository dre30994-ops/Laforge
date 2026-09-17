import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPool, deployFixture } from "../lib/helpers.js";

/**
 * C-1: unstake / restake / compound while ramping must not leave a ghost
 * `maturing[]` entry that underflows `rampingStake` on crank.
 */
describe("Ghost cohort (C-1)", async () => {
  it("full unstake then crank 72h does not revert", async () => {
    const fx = await deployFixture();
    const { networkHelpers } = fx.connection;
    const pool = await createPool(fx);
    const amount = 10n ** 20n;

    await fx.token.write.approve([pool.address, amount], { account: fx.staker.account });
    await pool.write.stake([amount], { account: fx.staker.account });

    const pos = await pool.read.positions([fx.staker.account.address]);
    assert.ok(pos[8] > 0n, "maturingIndex should be set");

    await pool.write.unstake([amount], { account: fx.staker.account });
    const after = await pool.read.positions([fx.staker.account.address]);
    assert.equal(after[8], 0n, "maturingIndex cleared");
    assert.equal(await pool.read.rampingStake(), 0n);

    await networkHelpers.time.increase(72 * 3600);
    await pool.write.crank([0n]);
    assert.equal(await pool.read.rampingStake(), 0n);
  });

  it("restake then crank does not underflow rampingStake", async () => {
    const fx = await deployFixture();
    const { networkHelpers } = fx.connection;
    const pool = await createPool(fx);
    const first = 10n ** 20n;
    const second = 5n * 10n ** 19n;

    await fx.token.write.approve([pool.address, first + second], {
      account: fx.staker.account,
    });
    await pool.write.stake([first], { account: fx.staker.account });

    await networkHelpers.time.increase(10 * 3600);
    await pool.write.crank([0n]);
    await pool.write.stake([second], { account: fx.staker.account });

    assert.equal(await pool.read.rampingStake(), first + second);

    await networkHelpers.time.increase(72 * 3600);
    await pool.write.crank([0n]);
    await pool.write.crank([0n]);
    await pool.write.crank([0n]);
  });

  it("two stakers: one full exit does not freeze the other", async () => {
    const fx = await deployFixture();
    const { networkHelpers } = fx.connection;
    const pool = await createPool(fx);
    const amount = 10n ** 20n;

    await fx.token.write.approve([pool.address, amount], { account: fx.staker.account });
    await fx.token.write.approve([pool.address, amount], { account: fx.launcher.account });

    await pool.write.stake([amount], { account: fx.staker.account });
    await pool.write.stake([amount], { account: fx.launcher.account });
    assert.equal(await pool.read.rampingStake(), amount * 2n);

    await pool.write.unstake([amount], { account: fx.staker.account });
    assert.equal(await pool.read.rampingStake(), amount);

    await networkHelpers.time.increase(72 * 3600);
    await pool.write.crank([0n]);
    await pool.write.crank([0n]);

    await pool.write.unstake([amount], { account: fx.launcher.account });
    assert.equal(await pool.read.totalStaked(), 0n);
  });
});
