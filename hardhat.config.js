require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-chai-matchers');
require("@nomiclabs/hardhat-etherscan");
require('@nomiclabs/hardhat-ethers');
require("@openzeppelin/hardhat-upgrades");
require('hardhat-gas-reporter');
require('solidity-coverage');
require('hardhat-erc1820');

const { INFURA_API_KEY, ETHERSCAN_API_KEY, GOERLI_PRIVATE_KEY, MAINNET_PRIVATE_KEY } = require('./config')

task('loadValidators', 'populate an avn-bridge contract with a set of validators')
  .addParam('address', 'address of target avn-bridge contract')
  .addParam('file', 'path to the validators file')
  .setAction(async (args) => {
    const validators = require(args.file);
    const t1Address = [], t1PublicKeyLHS = [], t1PublicKeyRHS = [], t2PublicKey = [];

    validators.forEach(validator => {
      t1Address.push(validator.ethAddress);
      t1PublicKeyLHS.push('0x' + validator.ethUncompressedPublicKey.slice(4, 68));
      t1PublicKeyRHS.push('0x' + validator.ethUncompressedPublicKey.slice(68, 132));
      t2PublicKey.push(validator.validator.tier2PublicKeyHex);
    });

    const avnBridge = await ethers.getContractAt('contracts/AVNBridge.sol:AVNBridge', args.address);
    await avnBridge.loadValidators(t1Address, t1PublicKeyLHS, t1PublicKeyRHS, t2PublicKey);
  });

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
