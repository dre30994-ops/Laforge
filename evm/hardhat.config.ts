import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

/**
 * Hardhat 3 ESM config.
 * Plugins are declared explicitly (no side-effect `import "plugin"`).
 * Secrets go through `configVariable` / `npx hardhat keystore set <NAME>`.
 */
export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "paris",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    robinhood: {
      type: "http",
      chainType: "l1",
      url: configVariable("ROBINHOOD_RPC_URL"),
      accounts: [configVariable("ROBINHOOD_PRIVATE_KEY")],
    },
    robinhoodTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("ROBINHOOD_TESTNET_RPC_URL"),
      accounts: [configVariable("ROBINHOOD_PRIVATE_KEY")],
    },
  },
});
