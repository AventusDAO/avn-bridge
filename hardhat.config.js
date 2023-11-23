require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-chai-matchers');
require('@nomiclabs/hardhat-etherscan');
require('@nomiclabs/hardhat-ethers');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-gas-reporter');
require('solidity-coverage');
require('hardhat-erc1820');

const { INFURA_API_KEY, ETHERSCAN_API_KEY, GOERLI_PRIVATE_KEY, MAINNET_PRIVATE_KEY } = require('./config');
const fs = require('fs');

task('loadAuthors', 'initialise a new avn-bridge contract with a set of authors')
  .addParam('contract', 'avn-bridge contract address')
  .addParam('authors', 'path to authors file')
  .setAction(async args => {
    console.log(`\nLoading authors from ${args.authors} into avn-bridge @ ${args.contract}`);
    const authors = require(args.authors);
    const t1Address = [],
      t1PublicKeyLHS = [],
      t1PublicKeyRHS = [],
      t2PublicKey = [];

    authors.forEach(author => {
      t1Address.push(author.ethAddress);
      t1PublicKeyLHS.push('0x' + author.ethUncompressedPublicKey.slice(4, 68));
      t1PublicKeyRHS.push('0x' + author.ethUncompressedPublicKey.slice(68, 132));
      t2PublicKey.push(author.validator.tier2PublicKeyHex);
    });

    const avnBridge = await ethers.getContractAt('contracts/AVNBridge.sol:AVNBridge', args.contract);
    await avnBridge.loadAuthors(t1Address, t1PublicKeyLHS, t1PublicKeyRHS, t2PublicKey);
  });

task('deploy', 'deploy a new avn-bridge contract and (optionally) initialise with authors')
  .addOptionalParam('token', 'optional core token address (eg: AVT contract)', '0xe0A9E4f2591be648f18001e21dB16dDAB114fEF9')
  .addOptionalParam('authors', 'optional path to file containing any authors to be loaded')
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

      const balanceBefore = await deployer.getBalance();
      const AVNBridge = await hre.ethers.getContractFactory('AVNBridge');
      const avnBridge = await hre.upgrades.deployProxy(AVNBridge, [args.token], { kind: 'uups' });
      await avnBridge.deployed();
      const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(avnBridge.address);

      if (args.authors) {
        // run optional loadAuthors task
        await hre.run('loadAuthors', { contract: avnBridge.address, authors: args.authors });
      }

      // output new contract address to file
      const outFile = './addresses.json';
      const addresses = fs.existsSync(outFile) ? require(outFile) : {};
      addresses[hre.network.name]['avn'] = avnBridge.address;
      fs.writeFileSync(outFile, JSON.stringify(addresses, null, 2));

      await new Promise(r => setTimeout(r, 20000));
      try {
        await hre.run('verify', { address: implementationAddress });
        await hre.run('verify', { address: avnBridge.address });
      } catch (e) {}
      console.log(`\nTotal cost: ${hre.ethers.utils.formatEther(balanceBefore.sub(await deployer.getBalance()))} ETH`);
      console.log(`\nContract: ${avnBridge.address}`);
    }
  });

task('lift', 'lift a token to the chain')
  .addParam('recipient', 'Recipient public key (32 bytes) in tier2')
  .addParam('bridge', 'avn-bridge contract address')
  .addParam('amount', 'amount to be lifted')
  .addOptionalParam(
    'token',
    'The contract address of the token to be lifted. If "chain" is passed, it will use the ethereum chain native token. If "core" is passed it will pass the bridge core token'
  )
  .setAction(async (args, hre) => {
    const bridge = args.bridge;
    const amount = args.amount;
    const recipient = args.recipient;
    try {
      const avnBridge = await ethers.getContractAt('contracts/AVNBridge.sol:AVNBridge', bridge);

      // Handle the case of the chain native token
      if (args.token === 'chain') {
        const liftTx = await avnBridge.liftETH(recipient, { value: amount });
        await liftTx.wait();
        console.log(`Successfully lifted ${amount} of Ether for avn-bridge ${bridge} - lift tx: ${liftTx.hash}`);
        return;
      }

      const token = args.token === undefined || args.token === 'core' ? await avnBridge.coreToken() : args.token;

      console.log(`\nLifting token ${token} into avn-bridge @ ${bridge}`);
      const tokenContract = await hre.ethers.getContractAt(`ERC20`, token);
      const approvalTx = await tokenContract.approve(bridge, amount);
      await approvalTx.wait();
      console.log(`Successfully approved ${amount} tokens for avn-bridge ${bridge} - approval tx: ${approvalTx.hash}`);

      console.log(`\nPeforming lift to avn-bridge @ ${bridge}`);
      const liftTx = await avnBridge.lift(token, recipient, amount);
      await liftTx.wait();
      console.log(`Successfully lifted ${amount} tokens for avn-bridge ${bridge} - lift tx: ${liftTx.hash}`);
    } catch (error) {
      console.error(`Error occurred during lift:`, error);
    }
  });

task('publishToken', 'deploy a new erc20 test token and publish it').setAction(async (args, hre) => {
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
    await new Promise(r => setTimeout(r, 10000));
    await hre.run('verify:verify', { address: token20.address, constructorArguments: [supply] });

    const outFile = './addresses.json';
    const addresses = fs.existsSync(outFile) ? require(outFile) : {};
    addresses[hre.network.name]['erc20token'] = token20.address;
    fs.writeFileSync(outFile, JSON.stringify(addresses, null, 2));
  }
});

task('upgrade', 'upgrade existing avn-bridge contract')
  .addParam('proxy', 'existing AVN Bridge proxy address')
  .setAction(async (args, hre) => {
    await hre.run('compile');
    const [upgrader] = await hre.ethers.getSigners();
    const balanceBefore = await upgrader.getBalance();
    console.log(`\nUpgrading ${args.proxy} on ${hre.network.name} network using account ${upgrader.address}...`);
    const AVNBridge = await ethers.getContractFactory('AVNBridge');
    await upgrades.upgradeProxy(args.proxy, AVNBridge);
    console.log(`\nCost: ${hre.ethers.utils.formatEther(balanceBefore.sub(await upgrader.getBalance()))} ETH`);
    await new Promise(r => setTimeout(r, 30000));
    try {
      const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(args.proxy);
      await hre.run('verify', { address: implementationAddress });
    } catch (e) {}
  });

task('prepare-upgrade', 'prepare the openzeppelin mainfest (if required)')
  .addParam('proxy', 'existing AVN Bridge proxy address')
  .setAction(async (args, hre) => {
    if (hre.network.name !== 'goerli') return;
    await hre.run('compile');
    const AVNBridge = await ethers.getContractFactory('AVNBridge');
    await upgrades.forceImport(args.proxy, AVNBridge);
    console.log('Done');
  });

function getWeb3Url(networkName) {
  if (!process.env.WEB3_URL_OVERRIDE) {
    return `https://${networkName}.infura.io/v3/${process.env.INFURA_API_KEY || INFURA_API_KEY}`;
  } else {
    return process.env.WEB3_URL_OVERRIDE;
  }
}
module.exports = {
  mocha: {
    timeout: 100000000000
  },
  solidity: {
    compilers: [
      {
        version: '0.8.23',
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
            details: { yul: true }
          }
        }
      }
    ]
  },
  networks: {
    goerli: {
      url: getWeb3Url(`goerli`),
      accounts: [process.env.GOERLI_PRIVATE_KEY || GOERLI_PRIVATE_KEY]
    },
    hardhat: {
      accounts: {
        accountsBalance: '5000000000000000000000000' // 5,000,000 ETH TO COVER ACCOUNTS FOR COVERAGE
      }
      // forking: {
      //   url: getWeb3Url(`mainnet`),
      // },
      // allowUnlimitedContractSize: true
    },
    mainnet: {
      url: getWeb3Url(`mainnet`),
      accounts: [
        process.env.MAINNET_PRIVATE_KEY ||
          MAINNET_PRIVATE_KEY ||
          '0000000000000000000000000000000000000000000000000000000000000000'
      ]
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ETHERSCAN_API_KEY
  },
  gasReporter: {
    enabled: true
  }
};
