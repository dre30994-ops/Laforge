import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRONZE_FEE,
  ECOSYSTEM_FEE,
  MARKETING_FEE,
  TIER_ECOSYSTEM,
  createPool,
  deployFixture,
} from "../lib/helpers.js";
import type { Address } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const BPS = 10_000n;

describe("launch fee: holder discount + referral + indirect", () => {
  it("quote equals the tier fee when membership token is unset", async () => {
    const fx = await deployFixture();
    const quote = (await fx.factory.read.quoteLaunchFee([
      fx.launcher.account.address,
      TIER_ECOSYSTEM,
    ])) as bigint;
    assert.equal(quote, ECOSYSTEM_FEE);
  });

  it("discounts 5% at 10_000 membership tokens", async () => {
    const fx = await deployFixture();
    const membership = await fx.viem.deployContract("contracts/mocks/MockERC20.sol:MockERC20", [
      "LAFORGE",
      "LFG",
      18,
    ]);
    await membership.write.mint([fx.launcher.account.address, 10_000n * 10n ** 18n]);
    const factory = await fx.viem.deployContract("StakingFactory", [
      BRONZE_FEE,
      ECOSYSTEM_FEE,
      MARKETING_FEE,
      fx.treasury.account.address,
      membership.address,
    ]);
    const disc = (await factory.read.holderDiscountBps([fx.launcher.account.address])) as bigint;
    assert.equal(disc, 500n);
    const quote = (await factory.read.quoteLaunchFee([
      fx.launcher.account.address,
      TIER_ECOSYSTEM,
    ])) as bigint;
    assert.equal(quote, ECOSYSTEM_FEE - (ECOSYSTEM_FEE * 500n) / BPS);
  });

  it("accrues 10% of the paid fee to the direct referrer", async () => {
    const fx = await deployFixture();
    const referrer = fx.staker.account.address;
    const beforeTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    await createPool(fx, { referrer });
    const commission = (ECOSYSTEM_FEE * 1_000n) / BPS;
    assert.equal((await fx.factory.read.owedToReferrer([referrer])) as bigint, commission);
    assert.equal((await fx.factory.read.lifetimeEarned([referrer])) as bigint, commission);
    const directs = (await fx.factory.read.directsOf([referrer])) as string[];
    assert.equal(directs.length, 1);
    assert.equal(directs[0].toLowerCase(), fx.launcher.account.address.toLowerCase());
    assert.equal(
      (await fx.factory.read.earnedFrom([referrer, fx.launcher.account.address])) as bigint,
      commission,
    );
    assert.equal((await fx.factory.read.referralCount([referrer])) as bigint, 1n);
    assert.equal(
      ((await fx.factory.read.referredBy([fx.launcher.account.address])) as string).toLowerCase(),
      referrer.toLowerCase(),
    );
    const afterTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    assert.equal(afterTreasury - beforeTreasury, ECOSYSTEM_FEE - commission);
  });

  it("pays the upline 5% of the direct commission as an override", async () => {
    const fx = await deployFixture();
    const direct = fx.staker.account.address;
    const parent = fx.deployer.account.address;
    await fx.factory.write.bindReferrer([parent], { account: fx.staker.account });
    assert.equal(
      ((await fx.factory.read.referredBy([direct])) as string).toLowerCase(),
      parent.toLowerCase(),
    );

    const beforeTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    await createPool(fx, { referrer: direct });

    const directCut = (ECOSYSTEM_FEE * 1_000n) / BPS;
    const indirectCut = (directCut * 500n) / BPS;
    assert.equal((await fx.factory.read.owedToReferrer([direct])) as bigint, directCut);
    assert.equal((await fx.factory.read.owedToReferrer([parent])) as bigint, indirectCut);
    const afterTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    assert.equal(afterTreasury - beforeTreasury, ECOSYSTEM_FEE - directCut - indirectCut);
  });

  it("pays hop 3 as 2% of hop 2 and ignores hop 4", async () => {
    const fx = await deployFixture();
    const wallets = await fx.viem.getWalletClients();
    const direct = fx.staker.account.address;
    const hop2 = fx.deployer.account.address;
    const hop3 = fx.extra.account.address;
    const hop4 = wallets[5].account.address;

    await fx.factory.write.bindReferrer([hop2], { account: fx.staker.account });
    await fx.factory.write.bindReferrer([hop3], { account: fx.deployer.account });
    await fx.factory.write.bindReferrer([hop4], { account: fx.extra.account });

    const beforeTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    await createPool(fx, { referrer: direct });

    const directCut = (ECOSYSTEM_FEE * 1_000n) / BPS;
    const hop2Cut = (directCut * 500n) / BPS;
    const hop3Cut = (hop2Cut * 200n) / BPS;
    assert.equal((await fx.factory.read.owedToReferrer([direct])) as bigint, directCut);
    assert.equal((await fx.factory.read.owedToReferrer([hop2])) as bigint, hop2Cut);
    assert.equal((await fx.factory.read.owedToReferrer([hop3])) as bigint, hop3Cut);
    assert.equal((await fx.factory.read.owedToReferrer([hop4])) as bigint, 0n);
    const afterTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    assert.equal(afterTreasury - beforeTreasury, ECOSYSTEM_FEE - directCut - hop2Cut - hop3Cut);
  });

  it("does not pay an indirect override when the parent is the launcher", async () => {
    const fx = await deployFixture();
    const direct = fx.staker.account.address;
    await fx.factory.write.bindReferrer([fx.launcher.account.address], {
      account: fx.staker.account,
    });
    await createPool(fx, { referrer: direct });
    const directCut = (ECOSYSTEM_FEE * 1_000n) / BPS;
    assert.equal((await fx.factory.read.owedToReferrer([direct])) as bigint, directCut);
    assert.equal(
      (await fx.factory.read.owedToReferrer([fx.launcher.account.address])) as bigint,
      0n,
    );
  });

  it("ignores self-referral", async () => {
    const fx = await deployFixture();
    await createPool(fx, { referrer: fx.launcher.account.address });
    assert.equal((await fx.factory.read.owedToReferrer([fx.launcher.account.address])) as bigint, 0n);
  });

  it("lets the referrer pull accrued commission", async () => {
    const fx = await deployFixture();
    const referrer = fx.staker.account.address;
    await createPool(fx, { referrer });
    const owed = (await fx.factory.read.owedToReferrer([referrer])) as bigint;
    const before = await fx.publicClient.getBalance({ address: referrer });
    const hash = await fx.factory.write.claimReferral({ account: fx.staker.account });
    const receipt = await fx.publicClient.waitForTransactionReceipt({ hash });
    const gas = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
    const after = await fx.publicClient.getBalance({ address: referrer });
    assert.equal(after + gas - before, owed);
    assert.equal((await fx.factory.read.owedToReferrer([referrer])) as bigint, 0n);
  });

  it("bindReferrer is once-only", async () => {
    const fx = await deployFixture();
    await fx.factory.write.bindReferrer([fx.deployer.account.address], {
      account: fx.staker.account,
    });
    await assert.rejects(
      () =>
        fx.factory.write.bindReferrer([fx.launcher.account.address], {
          account: fx.staker.account,
        }),
      /AlreadyBound/,
    );
  });
});
