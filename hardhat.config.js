require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-chai-matchers');
require("@nomiclabs/hardhat-etherscan");
require('@nomiclabs/hardhat-ethers');
require("@openzeppelin/hardhat-upgrades");
require('hardhat-gas-reporter');
require('solidity-coverage');
require('@nomiclabs/hardhat-etherscan');
require('hardhat-erc1820');

const { INFURA_API_KEY, ETHERSCAN_API_KEY, GOERLI_PRIVATE_KEY, MAINNET_PRIVATE_KEY } = require('./config')

module.exports = {
  mocha: {
    timeout: 100000000000
  },
  solidity: {
    compilers: [
      {
        version: '0.8.17',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: { yul: false }
          }
        }
      }
    ],
  },
  networks: {
    goerli: {
      url: `https://goerli.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [GOERLI_PRIVATE_KEY]
    },
    hardhat: {},
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [MAINNET_PRIVATE_KEY]
    }
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY
  },
  gasReporter: {
   enabled: true,
 }
};
