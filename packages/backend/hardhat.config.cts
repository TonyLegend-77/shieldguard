/**
 * @type import('hardhat/config').HardhatUserConfig
 */
require("dotenv/config");

module.exports = {
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
