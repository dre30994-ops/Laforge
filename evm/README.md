# Pons EVM — Hardhat 3 (ESM)

Hardhat **3.x**, `"type": "module"`, `import` / `export` only. No `require`, no `module.exports`, no `hardhat.config.js`.

```
evm/
  hardhat.config.ts          # defineConfig + plugins: [hardhatToolboxViem]
  contracts/                 # StakingMath, StakingPool, StakingFactory
  contracts/mocks/MockERC20.sol
  ignition/modules/StakingFactory.ts
  scripts/deploy.ts
  test/*.ts                  # node:test + viem
```

## Setup

```bash
cd evm
npm install
npx hardhat build
npx hardhat test
```

`npx hardhat compile` still works as an alias; Hardhat 3’s canonical task is `build`.

## Deploy a new factory

Store secrets in the Hardhat keystore (not a `.env` committed to git):

```bash
npx hardhat keystore set ROBINHOOD_RPC_URL
npx hardhat keystore set ROBINHOOD_PRIVATE_KEY
```

Then:

```bash
npx hardhat ignition deploy ignition/modules/StakingFactory.ts --network robinhood \
  --parameters ignition/parameters/robinhood.json
```

`feeRecipient` is **required** and **cannot be the deployer**. The live Robinhood
factory (`0x0E69…1691`) was deployed with `FEE_RECIPIENT` = the deployer
(`0x8e63…40C9`). That slot is immutable, so every bronze / ecosystem / marketing
launch fee on that factory still lands on the deployer.

To collect launch ETH in the protocol treasury, deploy a **new** factory (and a
new Marketing desk bound to it) with:

```
FEE_RECIPIENT=0x7f8cEDEa01bee1a975967137DfBFaeC7052D1513
```

Constructor defaults match the live Robinhood fees (0.01 / 0.03 / 0.06 ETH).
The viem script refuses to deploy if `FEE_RECIPIENT` is missing or equals the
deployer:

```bash
npx hardhat run scripts/deploy.ts --network robinhood
```

Point the app at the new address (`STAKING_FACTORY_ROBINHOOD` / `STAKING_FACTORY`).
Existing pools on the old factory are unchanged. Stake/unstake **token tax**
already goes to each pool's create-form treasury, not `FEE_RECIPIENT`.

## Deploy the Marketing desk (sidecar)

The live factories do **not** accept a marketing fee after `createPool`. Deploy one `MarketingDesk` per chain, pointed at that chain's factory. Anyone may pay the Marketing fee for a factory pool at any time (community boost). Branding and the verified badge stay with the operator. The pool's on-chain `tier` is not mutated.

Do **not** pass factory `0x` addresses in `--parameters '{...}'` — Ignition JSON5 reads them as hex numbers (HHE10111). Use the script below.

```powershell
# Wallet that RECEIVES boosts (not the deployer). Set this first.
$env:FEE_RECIPIENT="0xYourTreasury"

npx hardhat run scripts/deployMarketingDesk.ts --network robinhood
npx hardhat run scripts/deployMarketingDesk.ts --network ethereum
```

The script picks factory + fee from the chain (Robinhood `0x0E69…` / others `0x84ee…`). It prints deployer vs recipient, then the new desk address.

Then point the app at each desk address:

```
VITE_MARKETING_DESK_ROBINHOOD=0x5a0eA0fA6813D21c257bE07915a1306BdeA3037A
VITE_MARKETING_DESK_ETHEREUM=0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691
VITE_MARKETING_DESK_BASE=0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691
VITE_MARKETING_DESK_BSC=0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691
VITE_MARKETING_DESK_HYPEREVM=0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691
```

(`NEXT_PUBLIC_MARKETING_DESK_*` is accepted as well.)

## Tests

TypeScript tests use `node:test` and viem (`import { describe, it } from "node:test"`, `import { network } from "hardhat"`).

`test/GhostCohort.ts` covers the C-1 unstake/restake freeze that the previous factory could hit on 3–30 day pools.
