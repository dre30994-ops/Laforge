import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPool, deployFixture } from "../lib/helpers.js";

describe("holder reward forwarding", async () => {
  it("splits a quote-token payout by stake and ignores a late staker", async () => {
    const fx = await deployFixture();
    const pool = await createPool(fx);
    const quote = await fx.viem.deployContract("contracts/mocks/MockERC20.sol:MockERC20", ["Quote", "QUOTE", 6]);

    const aliceAmt = 100n * 10n ** 18n;
    const bobAmt = 300n * 10n ** 18n;
    await fx.token.write.approve([pool.address, aliceAmt], { account: fx.staker.account });
    await pool.write.stake([aliceAmt], { account: fx.staker.account });
    await fx.token.write.approve([pool.address, bobAmt], { account: fx.launcher.account });
    await pool.write.stake([bobAmt], { account: fx.launcher.account });

    const pot = 1_000_000n;
    await quote.write.mint([pool.address, pot]);
    await pool.write.syncHolderReward([quote.address], { account: fx.staker.account });

    assert.equal(await pool.read.pendingHolderReward([fx.staker.account.address, quote.address]), pot / 4n);
    assert.equal(await pool.read.pendingHolderReward([fx.launcher.account.address, quote.address]), (pot * 3n) / 4n);

    const before = await quote.read.balanceOf([fx.staker.account.address]);
    await pool.write.claimHolderReward([quote.address], { account: fx.staker.account });
    assert.equal((await quote.read.balanceOf([fx.staker.account.address])) - before, pot / 4n);

    const late = 100n * 10n ** 18n;
    await fx.token.write.mint([fx.treasury.account.address, late]);
    await fx.token.write.approve([pool.address, late], { account: fx.treasury.account });
    await pool.write.stake([late], { account: fx.treasury.account });
    assert.equal(await pool.read.pendingHolderReward([fx.treasury.account.address, quote.address]), 0n);
  });
});
