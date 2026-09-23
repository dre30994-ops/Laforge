import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { ECOSYSTEM_FEE, TIER_ECOSYSTEM } from "../lib/helpers.js";

const BPS = 10_000n;
const MIN_FUNDING = 10_000_000_000_000n;
const MIN_STAKE = 35_000_000_000n;
const STAKE = MIN_STAKE * 2n;

function netOf(amount: bigint, feeBps: bigint) {
  return amount - (amount * feeBps) / BPS;
}

describe("transfer-fee tokens", async () => {
  async function launch(feeBps: bigint, stakeTaxBps = 0n) {
    const connection = await network.create();
    const { viem } = connection;
    const [launcher, staker, treasury] = await viem.getWalletClients();
    const factory = await viem.deployContract("StakingFactory", [
      10_000_000_000_000_000n,
      ECOSYSTEM_FEE,
      60_000_000_000_000_000n,
      treasury.account.address,
      "0x0000000000000000000000000000000000000000",
    ]);
    const token = await viem.deployContract("FeeOnTransferERC20", [6, feeBps]);
    await token.write.mint([launcher.account.address, MIN_FUNDING * 20n]);
    await token.write.approve([factory.address, MIN_FUNDING], { account: launcher.account });
    const treasuryAddr =
      stakeTaxBps === 0n
        ? "0x0000000000000000000000000000000000000000"
        : treasury.account.address;
    await factory.write.createPool(
      [
        token.address,
        treasuryAddr,
        14n,
        stakeTaxBps,
        0n,
        MIN_FUNDING,
        MIN_STAKE,
        TIER_ECOSYSTEM,
      ],
      { account: launcher.account, value: ECOSYSTEM_FEE },
    );
    const poolAddress = await factory.read.poolOf([token.address]);
    const pool = await viem.getContractAt("StakingPool", poolAddress);
    return { token, pool, factory, launcher, staker, treasury };
  }

  it("credits the tokens that arrived, up to a 10% fee", async () => {
    const { token, pool, staker } = await launch(100n);
    assert.equal(await pool.read.fundedAmount(), netOf(MIN_FUNDING, 100n));

    await token.write.mint([staker.account.address, STAKE]);
    await token.write.approve([pool.address, STAKE], { account: staker.account });
    await pool.write.stake([STAKE], { account: staker.account });

    const received = netOf(STAKE, 100n);
    const pos = await pool.read.positions([staker.account.address]);
    assert.equal(pos[0], received);
    assert.equal(await pool.read.stakeVaultBalance(), received);
    assert.equal(
      await token.read.balanceOf([pool.address]),
      (await pool.read.rewardVaultBalance()) + received,
    );
  });

  it("rejects a transfer fee above 10%", async () => {
    await assert.rejects(() => launch(1001n), /TransferFeeTooHigh/);
  });

  it("takes the protocol stake tax out of tokens received", async () => {
    const { token, pool, staker } = await launch(1000n, 1000n);
    await token.write.mint([staker.account.address, STAKE]);
    await token.write.approve([pool.address, STAKE], { account: staker.account });
    await pool.write.stake([STAKE], { account: staker.account });

    const received = netOf(STAKE, 1000n);
    const tax = (received * 1000n) / BPS;
    const pos = await pool.read.positions([staker.account.address]);
    assert.equal(pos[0], received - tax);
    assert.equal(await pool.read.owedToTreasury(), tax);
  });

  it("unstake does not eat the reward vault", async () => {
    const { token, pool, staker } = await launch(500n);
    await token.write.mint([staker.account.address, STAKE]);
    await token.write.approve([pool.address, STAKE], { account: staker.account });
    await pool.write.stake([STAKE], { account: staker.account });
    const staked = (await pool.read.positions([staker.account.address]))[0];
    const rewards = await pool.read.rewardVaultBalance();
    await pool.write.unstake([staked], { account: staker.account });
    assert.equal(await pool.read.stakeVaultBalance(), 0n);
    assert.equal(await token.read.balanceOf([pool.address]), rewards);
  });

  it("rejects an outbound fee that is raised above 10% after launch", async () => {
    const { token, pool, staker } = await launch(0n);
    await token.write.mint([staker.account.address, STAKE]);
    await token.write.approve([pool.address, STAKE], { account: staker.account });
    await pool.write.stake([STAKE], { account: staker.account });
    const staked = (await pool.read.positions([staker.account.address]))[0];
    await token.write.setFeeBps([1500n]);
    await assert.rejects(
      () => pool.write.unstake([staked], { account: staker.account }),
      /TransferFeeTooHigh/,
    );
    await token.write.setFeeBps([1000n]);
    await pool.write.unstake([staked], { account: staker.account });
    assert.equal(await pool.read.stakeVaultBalance(), 0n);
  });
});
