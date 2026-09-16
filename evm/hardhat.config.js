// Hardhat 3 (ESM) configuration.
//
// Load evm/.env (DEPLOYER_KEY, *_RPC_URL). The file is git-ignored; never
// commit a private key. See .env.example for the template.
import "dotenv/config";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";
import { configVariable, defineConfig } from "hardhat/config";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
// Helper: only pass a private key when one is set, so networks still load
// (read-only) without a DEPLOYER_KEY in the environment.
const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

export default defineConfig({
  // Hardhat 3 requires plugins to be listed explicitly.
  plugins: [hardhatIgnitionViem, hardhatVerify, hardhatKeystore],

  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // Robinhood Chain is an Arbitrum Orbit L2 (EVM-equivalent). The default
      // EVM target is fine; Arbitrum supports the standard opcodes we use.
      evmVersion: "paris",
    },
  },

  networks: {
    // ─────────────────────────────────────────────────────────────────────
    // Supported deployment targets. Provide DEPLOYER_KEY (hex private key) via
    // the environment. Public RPCs are rate-limited; override each network's
    // RPC via the *_RPC_URL env var (e.g. an Alchemy/Infura endpoint).
    //
    // Deploy the factory to any of these with, e.g.:
    //   npx hardhat run scripts/deploy.js --network base
    // The deploy script (scripts/deploy.js) picks the correct per-chain tier
    // fees + fee recipient automatically from the selected network.
    //
    // In Hardhat 3 every JSON-RPC network must declare `type: "http"`.
    // ─────────────────────────────────────────────────────────────────────
  ethereum: {
    type: "http",
    url: configVariable("ETHEREUM_RPC_URL"),
    accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
  },
  base: {
    type: "http",
    url: configVariable("BASE_RPC_URL"),
    accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
  },
  bsc: {
    type: "http",
    url: configVariable("BSC_RPC_URL"),
    accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
  },
  hyperevm: {
    type: "http",
    url: configVariable("HYPEREVM_RPC_URL"),
    accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
  },
},
verify: {
  etherscan: {
    apiKey: configVariable("ETHERSCAN_API_KEY"),
  },
},
chainDescriptors: {
  999: {
    name: "HyperEVM",
    blockExplorers: {
      etherscan: {
        name: "HyperEVMScan",
        url: "https://hyperevmscan.io",
        apiUrl: "https://api.etherscan.io/v2/api",
      },
    },
  },
},

  // Verification providers. Robinhood Chain runs Blockscout (no API key
  // required) and Sourcify. Etherscan is disabled since we don't use it here.
  verify: {
    blockscout: {
      enabled: true,
    },
    sourcify: {
      enabled: true,
    },
    etherscan: {
      enabled: false,
    },
  },
});
