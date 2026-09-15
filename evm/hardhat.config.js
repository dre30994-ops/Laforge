require("@nomicfoundation/hardhat-toolbox");
// Load evm/.env (DEPLOYER_KEY, *_RPC_URL). The file is git-ignored; never
// commit a private key. See .env.example for the template.
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
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
    // ─────────────────────────────────────────────────────────────────────

    // Robinhood Chain — Arbitrum Orbit EVM L2. Native gas token: ETH.
    robinhoodTestnet: {
      url:
        process.env.ROBINHOOD_TESTNET_RPC_URL ||
        "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    robinhood: {
      url:
        process.env.ROBINHOOD_RPC_URL ||
        "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },

    // Ethereum. Native gas token: ETH.
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    ethereum: {
      url: process.env.ETHEREUM_RPC_URL || "https://eth.llamarpc.com",
      chainId: 1,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },

    // Base — Coinbase's OP-Stack L2. Native gas token: ETH.
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },

    // Arbitrum One — Arbitrum rollup. Native gas token: ETH.
    arbitrumSepolia: {
      url:
        process.env.ARBITRUM_SEPOLIA_RPC_URL ||
        "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },

    // Optimism (OP Mainnet) — OP-Stack rollup. Native gas token: ETH.
    optimismSepolia: {
      url:
        process.env.OPTIMISM_SEPOLIA_RPC_URL ||
        "https://sepolia.optimism.io",
      chainId: 11155420,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      chainId: 10,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },

    // BNB Smart Chain. Native gas token: BNB.
    bscTestnet: {
      url:
        process.env.BSC_TESTNET_RPC_URL ||
        "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },

    // Polygon PoS. Native gas token: POL.
    polygonAmoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
