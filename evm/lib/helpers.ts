import { network } from "hardhat";
import type { Address } from "viem";

export const BRONZE_FEE = 10_000_000_000_000_000n;
export const ECOSYSTEM_FEE = 30_000_000_000_000_000n;
export const MARKETING_FEE = 60_000_000_000_000_000n;

export const TIER_BRONZE = 0;
export const TIER_ECOSYSTEM = 1;
export const TIER_MARKETING = 2;

export async function connect() {
  return network.create();
}

export async function deployFixture() {
  const connection = await network.create();
  const { viem } = connection;
  const [deployer, launcher, staker, treasury] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const factory = await viem.deployContract("StakingFactory", [
    BRONZE_FEE,
    ECOSYSTEM_FEE,
    MARKETING_FEE,
    deployer.account.address,
  ]);

  const token = await viem.deployContract("contracts/mocks/MockERC20.sol:MockERC20", ["Mock", "MOCK", 18]);
  const funding = 10n ** 24n;
  const minStake = 10n ** 18n;

  await token.write.mint([launcher.account.address, funding * 10n]);
  await token.write.mint([staker.account.address, funding]);
  await token.write.approve([factory.address, funding * 10n], {
    account: launcher.account,
  });

  return {
    connection,
    viem,
    publicClient,
    deployer,
    launcher,
    staker,
    treasury,
    factory,
    token,
    funding,
    minStake,
  };
}

export async function createPool(
  fx: Awaited<ReturnType<typeof deployFixture>>,
  opts: {
    durationDays?: bigint;
    stakeTaxBps?: bigint;
    unstakeTaxBps?: bigint;
    treasury?: Address;
    tier?: number;
    value?: bigint;
    fundingAmount?: bigint;
    minStake?: bigint;
  } = {},
) {
  const durationDays = opts.durationDays ?? 14n;
  const stakeTaxBps = opts.stakeTaxBps ?? 0n;
  const unstakeTaxBps = opts.unstakeTaxBps ?? 0n;
  const treasury = opts.treasury ?? ("0x0000000000000000000000000000000000000000" as Address);
  const tier = opts.tier ?? TIER_ECOSYSTEM;
  const value = opts.value ?? ECOSYSTEM_FEE;
  const fundingAmount = opts.fundingAmount ?? fx.funding;
  const minStake = opts.minStake ?? fx.minStake;

  await fx.factory.write.createPool(
    [
      fx.token.address,
      treasury,
      durationDays,
      stakeTaxBps,
      unstakeTaxBps,
      fundingAmount,
      minStake,
      tier,
    ],
    { account: fx.launcher.account, value },
  );

  const poolAddress = (await fx.factory.read.poolOf([fx.token.address])) as Address;
  const pool = await fx.viem.getContractAt("StakingPool", poolAddress);
  return pool;
}
