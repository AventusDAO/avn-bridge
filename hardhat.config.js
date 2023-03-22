require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-chai-matchers');
require("@nomiclabs/hardhat-etherscan");
require('@nomiclabs/hardhat-ethers');
require("@openzeppelin/hardhat-upgrades");
require('hardhat-gas-reporter');
require('solidity-coverage');
require('hardhat-erc1820');

const { INFURA_API_KEY, ETHERSCAN_API_KEY, GOERLI_PRIVATE_KEY, VOLTA_PRIVATE_KEY, MAINNET_PRIVATE_KEY } = require('./config');
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

task('publishRoot', 'test publish root')
  .addParam('contract', 'avn-bridge contract address')
  .setAction(async (args) => {
    const avnBridge = await ethers.getContractAt('contracts/AVNBridge.sol:AVNBridge', args.contract);

    const rootHash = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
    const txId = hre.ethers.BigNumber.from(hre.ethers.utils.randomBytes(32));
    const t2PubKey = '0x4a9a2c1b8aa9d2a0cc948ae1c911e0640642f02dd638d32aa0d359899d69f63c'

    const encodedParams = hre.ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256', 'bytes32'], [rootHash, txId.toString(), t2PubKey]);
    const confirmationHash = hre.ethers.utils.solidityKeccak256(['bytes'], [encodedParams]);

    const wallet_1 = new hre.ethers.Wallet('0x86feedf619afe622df79b37a515b5966b99af05799eac662f1fff26a1217bc47');
    const wallet_2 = new hre.ethers.Wallet('0xc1f68d01466651168f90861e23e01e3a189ceb28b84b41598237e1cbe3edd694');
    const wallet_3 = new hre.ethers.Wallet('0x3678d0030042131b2680aecc37a2eed7b7f734c9d09b5756120b82ab7eb2ab7b');
    const wallet_4 = new hre.ethers.Wallet('0x38a13bda245f22751b157846c0709e1b534ac37f03da318b90d15a024d9a7379');

    const account_1 = wallet_1.connect(hre.ethers.provider);
    const account_2 = wallet_2.connect(hre.ethers.provider);
    const account_3 = wallet_3.connect(hre.ethers.provider);
    const account_4 = wallet_4.connect(hre.ethers.provider);

    let confirmations = '0x';

    confirmations += (await account_1.signMessage(hre.ethers.utils.arrayify(confirmationHash))).substring(2);
    confirmations += (await account_2.signMessage(hre.ethers.utils.arrayify(confirmationHash))).substring(2);
    confirmations += (await account_3.signMessage(hre.ethers.utils.arrayify(confirmationHash))).substring(2);
    confirmations += (await account_4.signMessage(hre.ethers.utils.arrayify(confirmationHash))).substring(2);

    const [deployer] = await hre.ethers.getSigners();
    // fund validator with enough for tx fee
    await deployer.sendTransaction({ to: account_1.address, value: '1000000000000000' });

    console.log(`\nBEFORE: Root hash ${rootHash} is published = ${await avnBridge.isPublishedRootHash(rootHash)}`);
    await avnBridge.connect(account_1).publishRoot(rootHash, txId, confirmations);
    await new Promise((r) => setTimeout(r, 10000));
    console.log(`\nAFTER: Root hash ${rootHash} is published = ${await avnBridge.isPublishedRootHash(rootHash)}`);
  });

task('deploy', 'deploy a new avn-bridge contract and (optionally) initialise with validators')
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
      const avnBridge = await hre.upgrades.deployProxy(AVNBridge, { kind: 'uups' });
      await avnBridge.deployed();
      const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(avnBridge.address);

      if (args.validators) { // run optional loadValidators task
        await hre.run('loadValidators', { contract: avnBridge.address, validators: args.validators });
      }

      await new Promise((r) => setTimeout(r, 20000));
      await hre.run('verify', { address: implementationAddress });
      await hre.run('verify', { address: avnBridge.address });

      console.log(`\nTotal cost: ${hre.ethers.utils.formatEther(balanceBefore.sub(await deployer.getBalance()))} VT`);
      console.log(`\nContract: ${avnBridge.address}`);

      // output new contract address to file
      const outFile = './addresses.json';
      const addresses = fs.existsSync(outFile) ? require(outFile) : {};
      addresses[hre.network.name] = avnBridge.address;
      fs.writeFileSync(outFile, JSON.stringify(addresses, null, 2));

    }
  });

task('publishToken', 'deploy a new erc20 test token and publish it')
  .setAction(async (args, hre) => {
    await hre.run('compile');

    if (hre.network.name === 'mainnet') {
      console.log('Requires manual setup for mainnet deployment');
      process.exit(1);
    } else {
      const [deployer] = await hre.ethers.getSigners();
      console.log(`\nDeploying an ERC20 to ${hre.network.name} network using account ${deployer.address}...`);
      const supply = 100000;
      const Token20 = await hre.ethers.getContractFactory('Token20');
      const token20 = await Token20.deploy(supply);
      await token20.deployed();
      await new Promise((r) => setTimeout(r, 20000));
      await hre.run('verify:verify', { address: token20.address, constructorArguments: [supply] });
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
      accounts: [VOLTA_PRIVATE_KEY]
    },
    hardhat: {},
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [MAINNET_PRIVATE_KEY]
    }
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
    customChains: [
    {
      network: "volta",
      chainId:73799,
      urls: {
        apiURL: "https://volta-explorer.energyweb.org/api",
        browserURL: "https://volta-explorer.energyweb.org"
      }
    }
  ]
  },
  gasReporter: {
   enabled: true,
 }
};
