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

type Fx = Awaited<ReturnType<typeof deployFixture>>;

async function launchAs(fx: Fx, account: Fx["launcher"], referrer?: Address) {
  const token = await fx.viem.deployContract("contracts/mocks/MockERC20.sol:MockERC20", [
    "Mock",
    "MOCK",
    18,
  ]);
  await token.write.mint([account.account.address, fx.funding]);
  await token.write.approve([fx.factory.address, fx.funding], { account: account.account });
  const args = [
    token.address,
    ZERO,
    14n,
    0n,
    0n,
    fx.funding,
    fx.minStake,
    TIER_ECOSYSTEM,
  ] as const;
  if (referrer) {
    await fx.factory.write.createPoolReferred([...args, referrer], {
      account: account.account,
      value: ECOSYSTEM_FEE,
    });
  } else {
    await fx.factory.write.createPool([...args], {
      account: account.account,
      value: ECOSYSTEM_FEE,
    });
  }
}

async function owed(fx: Fx, who: Address) {
  return (await fx.factory.read.owedToReferrer([who])) as bigint;
}

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
    await launchAs(fx, fx.staker, parent);
    assert.equal(
      ((await fx.factory.read.referredBy([direct])) as string).toLowerCase(),
      parent.toLowerCase(),
    );

    const beforeParent = await owed(fx, parent);
    const beforeTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    await createPool(fx, { referrer: direct });

    const directCut = (ECOSYSTEM_FEE * 1_000n) / BPS;
    const indirectCut = (directCut * 500n) / BPS;
    assert.equal(await owed(fx, direct), directCut);
    assert.equal((await owed(fx, parent)) - beforeParent, indirectCut);
    assert.equal(
      (await fx.factory.read.hop2Earned([parent, fx.launcher.account.address])) as bigint,
      indirectCut,
    );
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

    await launchAs(fx, fx.extra, hop4);
    await launchAs(fx, fx.deployer, hop3);
    await launchAs(fx, fx.staker, hop2);

    const beforeHop2 = await owed(fx, hop2);
    const beforeHop3 = await owed(fx, hop3);
    const beforeHop4 = await owed(fx, hop4);
    const beforeTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    await createPool(fx, { referrer: direct });

    const directCut = (ECOSYSTEM_FEE * 1_000n) / BPS;
    const hop2Cut = (directCut * 500n) / BPS;
    const hop3Cut = (hop2Cut * 200n) / BPS;
    assert.equal(await owed(fx, direct), directCut);
    assert.equal((await owed(fx, hop2)) - beforeHop2, hop2Cut);
    assert.equal((await owed(fx, hop3)) - beforeHop3, hop3Cut);
    assert.equal((await owed(fx, hop4)) - beforeHop4, 0n);
    const afterTreasury = await fx.publicClient.getBalance({
      address: fx.treasury.account.address,
    });
    assert.equal(afterTreasury - beforeTreasury, ECOSYSTEM_FEE - directCut - hop2Cut - hop3Cut);
  });

  it("does not pay an indirect override when the parent is the launcher", async () => {
    const fx = await deployFixture();
    const direct = fx.staker.account.address;
    await launchAs(fx, fx.staker, fx.launcher.account.address);
    const beforeLauncher = await owed(fx, fx.launcher.account.address);
    await createPool(fx, { referrer: direct });
    const directCut = (ECOSYSTEM_FEE * 1_000n) / BPS;
    assert.equal(await owed(fx, direct), directCut);
    assert.equal(await owed(fx, fx.launcher.account.address), beforeLauncher);
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

  it("keeps paying the saved parent after a later link or no link", async () => {
    const fx = await deployFixture();
    const parent = fx.staker.account.address;
    const later = fx.extra.account.address;
    await createPool(fx, { referrer: parent });

    const quote = (await fx.factory.read.quoteLaunch([
      fx.launcher.account.address,
      TIER_ECOSYSTEM,
      later,
    ])) as readonly [bigint, bigint, bigint, string];
    assert.equal(quote[3].toLowerCase(), parent.toLowerCase());

    async function launch(referrer?: Address) {
      const token = await fx.viem.deployContract("contracts/mocks/MockERC20.sol:MockERC20", [
        "Mock",
        "MOCK",
        18,
      ]);
      await token.write.mint([fx.launcher.account.address, fx.funding]);
      await token.write.approve([fx.factory.address, fx.funding], { account: fx.launcher.account });
      const args = [
        token.address,
        ZERO,
        14n,
        0n,
        0n,
        fx.funding,
        fx.minStake,
        TIER_ECOSYSTEM,
      ] as const;
      if (referrer) {
        await fx.factory.write.createPoolReferred([...args, referrer], {
          account: fx.launcher.account,
          value: ECOSYSTEM_FEE,
        });
      } else {
        await fx.factory.write.createPool([...args], {
          account: fx.launcher.account,
          value: ECOSYSTEM_FEE,
        });
      }
    }

    await launch();
    await launch(later);

    const first = (ECOSYSTEM_FEE * 1_000n) / BPS;
    const second = (ECOSYSTEM_FEE * 1_100n) / BPS;
    const third = (ECOSYSTEM_FEE * 1_200n) / BPS;
    assert.equal(
      (await fx.factory.read.owedToReferrer([parent])) as bigint,
      first + second + third,
    );
    assert.equal((await fx.factory.read.owedToReferrer([later])) as bigint, 0n);
    assert.equal((await fx.factory.read.referralCount([parent])) as bigint, 3n);
    assert.equal(
      ((await fx.factory.read.referredBy([fx.launcher.account.address])) as string).toLowerCase(),
      parent.toLowerCase(),
    );
  });

  it("does not bind until a referred pool is created", async () => {
    const fx = await deployFixture();
    const parent = fx.staker.account.address;
    await launchAs(fx, fx.launcher);
    assert.equal(
      ((await fx.factory.read.referredBy([fx.launcher.account.address])) as string).toLowerCase(),
      ZERO,
    );
    await assert.rejects(() => createPool(fx, { referrer: parent, value: 1n }), /BadLaunchFee/);
    assert.equal(
      ((await fx.factory.read.referredBy([fx.launcher.account.address])) as string).toLowerCase(),
      ZERO,
    );
    await launchAs(fx, fx.launcher, parent);
    assert.equal(
      ((await fx.factory.read.referredBy([fx.launcher.account.address])) as string).toLowerCase(),
      parent.toLowerCase(),
    );
  });

  it("bindReferrer is gone", async () => {
    const fx = await deployFixture();
    assert.equal(fx.factory.abi.some((item) => item.type === "function" && item.name === "bindReferrer"), false);
  });
});
