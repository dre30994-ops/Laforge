# Pons Staking (EVM) — Robinhood Chain

A Solidity port of the Solana/Anchor 14-day liquidity-bootstrap staking farm,
targeting **Robinhood Chain** (an Arbitrum Orbit EVM L2). Any ERC-20 launched on
**Pons** can get its own isolated staking pool.

The economic model is preserved **exactly** from the original Rust program:

- Global emissions ramp **1.0x → 2.0x** over 12 six-hour steps (3 days), then
  plateau flat to day 14.
- Per-user tenure weight ramps **1.0x → 2.0x** over 72 hourly steps (3 days).
- Stake-weighted average deposit timestamp (anti-gaming dilution).
- O(1) reward accrual via checkpoint history (`A`, `G`) and cohort maturity
  buckets.
- **Configurable per-pool stake and unstake taxes** (each capped at 10%), taken
  from principal and routed to a launcher-selected treasury. If no treasury is
  set, both taxes must be zero. Compounding is untaxed.
- Operator-gated funding; permissionless `sync`, `crank`, and `sweep`.
- Reward surplus sweep to the operator after the pool has been empty ≥ 3 hours,
  never touching staker principal or unclaimed rewards.
- Pause, min-stake adjustment, two-party authority transfer, and
  withdraw-unallocated after end + fixed 7-day grace.

## Launchpad model (per-pool trust)

Any Pons ERC-20 launcher creates a pool by calling the factory and paying a fixed
**0.02 ETH** launch fee (forwarded to a hardcoded collector). At creation the
launcher sets, **immutably**:

- `operator` = the launcher (`msg.sender`): funds rewards, receives sweeps.
- `treasury` = launcher-selected tax recipient (optional; zero ⇒ no tax).
- `stakeTaxBps`, `unstakeTaxBps` = per-side taxes, each ≤ 1000 bps (10%).
- `authority` = the launcher: pool admin.

Each pool is fully isolated: only its own operator can fund it, and its taxes
flow only to its own treasury.

### Token safety (Option A)

Pools accept only well-behaved ERC-20s. Every transfer **into** the pool
(`fundRewards`, `stake`) requires the received balance delta to equal the
requested amount exactly, so **fee-on-transfer and rebasing tokens are rejected**
(`InexactTransfer`). All token-moving functions use a reentrancy guard.

## Contracts

- `StakingMath.sol` — pure emission/weight/accrual math. A 1:1 translation of
  `crates/staking-math` (constants, emission, weight, accrual). Solidity 0.8
  checked arithmetic mirrors Rust `checked_*`.
- `StakingPool.sol` — one pool for one token. Mirrors every Anchor instruction:
  `startPool`, `fundRewards`, `syncRewards`, `crank`, `stake`, `unstake`,
  `claim`, `compound`, `sweepToOperator`, and the admin ops. Per-pool
  operator/treasury/taxes are immutable.
- `StakingFactory.sol` — payable `createPool` deploys one `StakingPool` per token
  (mirrors the Solana "one PDA pool per mint" model), charges the 0.02 ETH
  launch fee, and sets the per-pool operator/treasury/taxes; the caller becomes
  that pool's operator and admin.

## How Solana concepts map to EVM

| Solana / Anchor | EVM / Solidity |
| --- | --- |
| PDA pool per mint (`["pool", mint]`) | one `StakingPool` per token via factory |
| Stake vault + reward vault PDAs | contract custody + `stakeVaultBalance` / `rewardVaultBalance` accounting |
| SPL `transfer_checked` CPI | `SafeERC20.safeTransfer(From)` |
| Client-allocated `Schedule` zero-copy account | `mapping` checkpoints + maturing |
| Hardcoded global `OPERATOR` / `TREASURY` | per-pool operator/treasury chosen by the launcher at `createPool` |
| `Clock::unix_timestamp` | `block.timestamp` |
| Token-2022 mint-extension validation | strict balance-delta equality: fee-on-transfer / rebasing tokens rejected (`InexactTransfer`) |
| Two-signer `transfer_authority` | two-step `transferAuthority` → `acceptAuthority` |

## Usage

```bash
npm install
npm run build       # hardhat compile
npm test            # 56 tests: math parity + lifecycle + differential + factory/tax/safety
```

## Test suites

- **`StakingMath.test.js`** — 17 tests asserting the library reproduces the Rust
  `staking-math` golden values exactly.
- **`StakingPool.test.js`** — 13 lifecycle tests (funding gate, min stake, 5%
  unstake tax, pause rules, compound, sweep, authority transfer, sync).
- **`Differential.test.js`** — 15 tests: an independent JS oracle (`test/oracle.js`)
  re-implementing the **on-chain crank/accrual semantics**, self-checked against
  the Rust golden values, then run in lockstep with the deployed contract on
  multi-user timelines asserting equal aggregates and per-user payouts.
- **`FactoryTax.test.js`** — 11 tests: launch-fee accounting, per-pool
  operator/treasury isolation, tax caps, treasury-zero-⇒-zero-tax, stake tax
  from principal, and rejection of fee-on-transfer + reentrant tokens.

## Notes on fidelity

Two things surfaced while building the differential tests, both documented here
for transparency:

1. **Per-hour emission flooring.** The on-chain `crank` floors each hour's
   emission (`base*3*mult/12`), whereas the reference `cumulative_emitted` floors
   once. Over the 336-hour program this leaves a small residual (measured ~0.15%
   for a single minimum position) as recoverable surplus in the pool. This is the
   real on-chain behaviour; it always floors toward the pool, so the pool can
   never be overdrawn. This port matches the on-chain crank.

2. **Double-claim safety.** The re-settlement snapshot stores the boundary-sum
   baseline `G_{n0+min(k,72)}` consistent with the position's tenure step, so a
   repeat claim with no elapsed time pays zero. (An earlier revision that stored
   the *global* boundary sum over-paid a matured position on repeat settlement;
   the differential double-claim test catches this, and the fix is verified by
   `Differential.test.js`.)

Deploy the factory (set the operator and treasury for all pools):

```bash
OPERATOR=0x... TREASURY=0x... npx hardhat run scripts/deploy.js --network robinhood
```

Configure the `robinhood` network in `hardhat.config.js` with the chain's RPC
URL and a deployer key once those details are published.

Then, for each Pons token:

```solidity
// minFunding / minStake are in the token's base units.
factory.createPool(ponsToken, minFunding, minStake);
```

Lifecycle: `operator` funds rewards (`fundRewards`) until `fundedAmount >=
minFunding`, the authority calls `startPool`, then users `stake` / `claim` /
`compound` / `unstake` while anyone keeps the pool current via `crank`.

## Operational note: cranking

On Solana the pool is advanced with a resumable `crank`. The same applies here:
the pool must be cranked within one tenure step (1 hour) for `stake`, `unstake`,
`claim`, and `compound` to succeed (the staleness gate). `crank` is
permissionless and honors a `maxSteps` bound, so a keeper (or any user) can chain
calls to catch up after gaps. Budget a keeper to crank roughly hourly.
