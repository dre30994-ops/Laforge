The Hardhat 3 ESM project (import/export, tests, Ignition) lives in `evm/`.

Drop these Solidity files into that tree — they are already copied there:

```
evm/contracts/StakingMath.sol
evm/contracts/StakingPool.sol
evm/contracts/StakingFactory.sol
evm/contracts/MarketingDesk.sol
```

`MarketingDesk` is a sidecar for already-deployed factories. Anyone may pay the chain's Marketing fee for a factory pool at any time (community boost). Branding and the verified badge stay with the operator. Pool `tier` is immutable.

See [evm/README.md](../evm/README.md) for `npm install`, `npx hardhat build`, `npx hardhat test`, factory deploy, and Marketing desk deploy.
