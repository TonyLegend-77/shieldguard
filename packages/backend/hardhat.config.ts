import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: "0.8.19",
  networks: {
    botchainTestnet: {
      url: process.env.RPC_URL || "https://rpc.bohr.life",
      chainId: 968,
      accounts: process.env.SIGNER_PRIVATE_KEY ? [process.env.SIGNER_PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
