require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-chai-matchers');
require("@nomiclabs/hardhat-etherscan");
require('@nomiclabs/hardhat-ethers');
require("@openzeppelin/hardhat-upgrades");
require('hardhat-gas-reporter');
require('solidity-coverage');
require('hardhat-erc1820');

const { INFURA_API_KEY, ETHERSCAN_API_KEY, GOERLI_PRIVATE_KEY, MAINNET_PRIVATE_KEY } = require('./config');
const fs = require('fs');

task('loadValidators', 'initialise a new avn-bridge contract with a set of validators')
  .addParam('contract', 'avn-bridge contract address')
  .addParam('validators', 'path to validators file')
  .setAction(async (args) => {
    console.log(`\nLoading validators from ${args.validators} into avn-bridge @ ${args.contract}`);
    const validators = require(args.validators);
    const t1Address = [], t1PublicKeyLHS = [], t1PublicKeyRHS = [], t2PublicKey = [];

    validators.forEach(validator => {
      t1Address.push(validator.ethAddress);
      t1PublicKeyLHS.push('0x' + validator.ethUncompressedPublicKey.slice(4, 68));
      t1PublicKeyRHS.push('0x' + validator.ethUncompressedPublicKey.slice(68, 132));
      t2PublicKey.push(validator.validator.tier2PublicKeyHex);
    });

    const avnBridge = await ethers.getContractAt('contracts/AVNBridge.sol:AVNBridge', args.contract);
    await avnBridge.loadValidators(t1Address, t1PublicKeyLHS, t1PublicKeyRHS, t2PublicKey);
  });

task('deploy', 'deploy a new avn-bridge contract and (optionally) initialise with validators')
  .addOptionalParam('token', 'optional core token address (eg: AVT contract)', '0xe0A9E4f2591be648f18001e21dB16dDAB114fEF9')
  .addOptionalParam('validators', 'optional path to file containing any validators to be loaded')
  .setAction(async (args, hre) => {
    await hre.run('compile');

    if (hre.network.name === 'mainnet') {
      console.log('Requires manual setup for mainnet deployment');
      process.exit(1);
    } else {
      const [deployer] = await hre.ethers.getSigners();
      console.log(`\nDeploying to ${hre.network.name} network using account ${deployer.address}...`);

      // delete any existing OZ manifests as we want to deploy anew, not upgrade
      if (fs.existsSync('./.openzeppelin/goerli.json')) fs.unlinkSync('./.openzeppelin/goerli.json');
      if (fs.existsSync('./.openzeppelin/unknown-73799.json')) fs.unlinkSync('./.openzeppelin/unknown-73799.json');

      const balanceBefore = await deployer.getBalance();
      const AVNBridge = await hre.ethers.getContractFactory('AVNBridge');
      const avnBridge = await hre.upgrades.deployProxy(AVNBridge, [args.token, '0x0000000000000000000000000000000000000000'], { kind: 'uups' });
      await avnBridge.deployed();
      const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(avnBridge.address);

      if (network.name === 'goerli') { // publish contracts to Etherscan
        await new Promise((r) => setTimeout(r, 20000));
        await hre.run('verify', { address: implementationAddress });
        await hre.run('verify', { address: avnBridge.address });
      }

      console.log(`\nTotal cost: ${hre.ethers.utils.formatEther(balanceBefore.sub(await deployer.getBalance()))} ETH`);
      console.log(`\nContract: ${avnBridge.address}`);

      if (args.validators) { // run optional loadValidators task
        await hre.run('loadValidators', { contract: avnBridge.address, validators: args.validators });
      }

      // output new contract address to file
      const outFile = './addresses.json';
      const addresses = fs.existsSync(outFile) ? require(outFile) : {};
      addresses[hre.network.name] = avnBridge.address;
      fs.writeFileSync(outFile, JSON.stringify(addresses, null, 2));

    }
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
    volta: {
      url: "https://volta-rpc.energyweb.org",
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
