require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-ledger');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-contract-sizer');
require('hardhat-gas-reporter');
require('solidity-coverage');
require('hardhat-erc1820');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { ETHERSCAN_API_KEY, MAINNET_LEDGER_ADDRESS, MAINNET_RPC_URL, SEPOLIA_T1_PRIVATE_KEY, SEPOLIA_RPC_URL } = process.env;

const ADDRESSES_PATH = './addresses.json';
const AUTHORS_PATH = './authors.json';
const CONTRACT_PATH = 'contracts/AVNBridge.sol';
const INTERFACE_PATH = 'contracts/interfaces/IAVNBridge.sol';
const CONTRACT_NAME = 'AVNBridge';
const GWEI = 1e9;
const VERIFICATION_DELAY_SECONDS = 40;

const AVT_ADDRESS = {
  dev: '0x93ba86eCfDDD9CaAAc29bE83aCE5A3188aC47730',
  mainnet: '0x0d88eD6E74bbFD96B831231638b66C05571e824F',
  paseo: '0x608156959e3a2192a870b4bac660200afb4c649f',
  testnet: '0x608156959e3a2192a870b4bac660200afb4c649f'
};

task('deploy', 'deploy a new avn-bridge proxy')
  .addPositionalParam('env', 'AvN environment name')
  .setAction(async (args, hre) => {
    const { ethers, network, run, upgrades } = hre;
    const [signer] = await ethers.getSigners();
    await run('compile');

    const avtAddress = getAVTAddress(args.env);
    const authors = require(AUTHORS_PATH)[args.env];
    const initArgs = [[], [], [], []];

    authors.forEach(author => {
      initArgs[0].push(author.ethAddress);
      initArgs[1].push('0x' + author.ethUncompressedPublicKey.slice(4, 68));
      initArgs[2].push('0x' + author.ethUncompressedPublicKey.slice(68, 132));
      initArgs[3].push(author.t2PublicKey);
    });

    console.log(`\nDeploying to ${network.name} network using account ${signer.address}...`);
    const initialBalance = await ethers.provider.getBalance(signer.address);
    const contract = await ethers.getContractFactory(CONTRACT_NAME);
    const proxy = await upgrades.deployProxy(contract, initArgs, { constructorArgs: [avtAddress], kind: 'uups' });
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    const impAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    const addresses = fs.existsSync(ADDRESSES_PATH) ? require(ADDRESSES_PATH) : {};
    const key = network.name + '_' + args.env;
    addresses[key].avn = proxyAddress;
    fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));

    console.log('Waiting to verify...');
    await delay(VERIFICATION_DELAY_SECONDS);
    await verify(run, impAddress);
    await verify(run, proxyAddress);

    const finalBalance = await ethers.provider.getBalance(signer.address);
    const cost = ethers.formatEther(initialBalance - finalBalance);
    console.log(`\nDeployed ${CONTRACT_NAME} proxy at ${proxyAddress} (impl: ${impAddress}) for ${cost} ETH`);
    console.log('\nDone');
  });

task('prepare', 'prepares the openzeppelin manifest')
  .addPositionalParam('bridge', 'proxy address')
  .setAction(async (args, hre) => {
    const { ethers, network, run, upgrades } = hre;
    testContracts(false);
    const originalInterface = fs.readFileSync('./' + INTERFACE_PATH, 'utf8');
    const originalContract = fs.readFileSync('./' + CONTRACT_PATH, 'utf8');

    const chainId = network.name === 'sepolia' ? 11155111n : 1n;
    const implementation = await upgrades.erc1967.getImplementationAddress(args.bridge);
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${implementation}&apikey=${ETHERSCAN_API_KEY}`;
    const response = await axios.get(url);
    const sources = JSON.parse(response.data.result[0].SourceCode.slice(1, -1)).sources;

    try {
      fs.writeFileSync('./' + INTERFACE_PATH, sources[INTERFACE_PATH].content);
      fs.writeFileSync('./' + CONTRACT_PATH, sources[CONTRACT_PATH].content);
      await run('compile');
      const contract = await ethers.getContractFactory(CONTRACT_NAME);
      await upgrades.forceImport(args.bridge, contract);
    } catch (e) {
      console.log(e);
    } finally {
      testContracts(true);
      fs.writeFileSync('./' + INTERFACE_PATH, originalInterface);
      fs.writeFileSync('./' + CONTRACT_PATH, originalContract);
    }

    console.log('\nDone');
  });

task('validate')
  .addPositionalParam('bridge', 'proxy address')
  .setAction(async (args, hre) => {
    const { ethers, run, upgrades } = hre;
    await run('compile');

    console.log(`\nValidating new implementation...`);
    const contract = await ethers.getContractFactory(CONTRACT_NAME);
    await upgrades.validateImplementation(contract);

    console.log(`\nValidating upgrade safety for proxy at ${args.bridge}...`);
    await upgrades.validateUpgrade(args.bridge, contract);
    console.log('\nResult: Safe for upgrade');
  });

task('implementation', 'deploy new implementation contract')
  .addPositionalParam('env', 'AvN environment name')
  .setAction(async (args, hre) => {
    const { ethers, network, run } = hre;
    const [signer] = await ethers.getSigners();
    await run('compile');

    const avtAddress = getAVTAddress(args.env);
    const initialBalance = await ethers.provider.getBalance(signer.address);
    console.log(`\nDeploying AVNBridge implementation on ${network.name} for AVT token ${avtAddress} using account ${signer.address}...`);
    const contract = await ethers.getContractFactory(CONTRACT_NAME);
    const implementation = await contract.deploy(avtAddress);
    await implementation.waitForDeployment();
    const impAddress = await implementation.getAddress();

    console.log('Waiting to verify...');
    await delay(VERIFICATION_DELAY_SECONDS);
    await verify(run, impAddress);
    const finalBalance = await ethers.provider.getBalance(signer.address);
    const cost = ethers.formatEther(initialBalance - finalBalance);
    console.log(`\nDeployed AVNBridge implementation at ${impAddress} for ${cost} ETH`);
  });

task('authority', 'deploy the AVT Authority contract').setAction(async (_, hre) => {
  const { ethers, network, run } = hre;
  const [signer] = await ethers.getSigners();
  await run('compile');

  const avtAddress = getAVTAddress(args.env);
  const initialBalance = await ethers.provider.getBalance(signer.address);
  console.log(`\nDeploying AVTAuthority on ${network.name} using account ${signer.address}...`);
  const contract = await ethers.getContractFactory('AVTAuthority');
  const authority = await contract.deploy(avtAddress);
  await authority.waitForDeployment();
  const authAddress = await authority.getAddress();

  console.log('Waiting to verify...');
  await delay(VERIFICATION_DELAY_SECONDS);
  await verify(run, authAddress, [args.avt]);

  const finalBalance = await ethers.provider.getBalance(signer.address);
  const cost = ethers.formatEther(initialBalance - finalBalance);
  console.log(`\nDeployed AVTAuthority at ${authAddress} for ${cost} ETH`);
});

task('lift', 'lift a token to the chain')
  .addParam('recipient', 'Recipient public key (32 bytes) in tier2')
  .addParam('bridge', 'avn-bridge address')
  .addParam('amount', 'amount to lift')
  .addParam('token', 'The token address. Pass "chain" to lift ETH.')
  .setAction(async (args, hre) => {
    const { ethers } = hre;
    const { bridge, amount, recipient, token } = args;
    try {
      const avnBridge = await ethers.getContractAt('contracts/AVNBridge.sol:AVNBridge', bridge);

      if (token === 'chain') {
        const tx = await avnBridge.liftETH(recipient, { value: amount });
        await tx.wait();
        console.log(`Successfully lifted ${amount} of Ether for avn-bridge ${bridge} - lift tx: ${tx.hash}`);
        return;
      }

      console.log(`\nLifting token ${token} into avn-bridge @ ${bridge}`);
      const tokenContract = await ethers.getContractAt(`ERC20`, token);
      const approvalTx = await tokenContract.approve(bridge, amount);
      await approvalTx.wait();
      console.log(`Successfully approved ${amount} tokens for avn-bridge ${bridge} - approval tx: ${approvalTx.hash}`);

      console.log(`\nPeforming lift to avn-bridge @ ${bridge}`);
      const tx = await avnBridge.lift(token, recipient, amount);
      await tx.wait();
      console.log(`Successfully lifted ${amount} tokens for avn-bridge ${bridge} - lift tx: ${tx.hash}`);
    } catch (error) {
      console.error(`Error occurred during lift:`, error);
    }
  });

task('publishToken', 'deploy a new erc20 test token and publish it').setAction(async (_, hre) => {
  const { ethers, network, run } = hre;
  await run('compile');

  const [signer] = await ethers.getSigners();
  console.log(`\nDeploying to ${network.name} using ${signer.address}...`);
  const supply = 1_000_000;
  const Token20 = await ethers.getContractFactory('Token20');
  const token20 = await Token20.deploy(supply);
  await token20.waitForDeployment();
  const tokenAddress = await token20.getAddress();

  console.log('Waiting to verify...');
  await delay(VERIFICATION_DELAY_SECONDS);
  await verify(run, tokenAddress, [supply]);
  const addresses = fs.existsSync(ADDRESSES_PATH) ? require(ADDRESSES_PATH) : {};
  addresses[network.name]['erc20token'] = tokenAddress;

  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));
  console.log('\nDone');
});

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function getAVTAddress(env) {
  if (!AVT_ADDRESS[env]) throw new Error(`Invalid env: "${env}"`);
  return AVT_ADDRESS[env];
}

async function verify(run, address, constructorArguments = []) {
  try {
    await run('verify:verify', { address, constructorArguments });
  } catch (error) {
    console.log(`Etherscan verification failed for ${address}: ${error.message}`);
  }
}

function testContracts(enabled) {
  const dir = './contracts/test';
  const extension = enabled ? 'sol' : 'xxx';
  for (const f of fs.readdirSync(dir)) fs.renameSync(path.join(dir, f), path.join(dir, f.slice(0, -3) + extension));
}

module.exports = {
  mocha: {
    timeout: 300000
  },
  solidity: {
    compilers: [
      {
        version: '0.8.31',
        settings: {
          optimizer: {
            enabled: true,
            runs: 100000,
            details: { yul: true }
          },
          viaIR: true
        }
      },
      {
        version: '0.4.26',
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000
          }
        }
      }
    ],
    overrides: {
      'contracts/test/AVT.sol': {
        version: '0.4.26',
        settings: {
          optimizer: { enabled: true, runs: 200 }
        }
      }
    }
  },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [SEPOLIA_T1_PRIVATE_KEY],
      maxFeePerGas: 1 * GWEI,
      maxPriorityFeePerGas: 1 * GWEI
    },
    hardhat: {
      accounts: {
        accountsBalance: '5000000000000000000000000'
      }
    },
    mainnet: {
      url: MAINNET_RPC_URL,
      ledgerAccounts: [MAINNET_LEDGER_ADDRESS],
      type: 2,
      maxFeePerGas: 20 * GWEI,
      maxPriorityFeePerGas: 2 * GWEI,
      timeout: 1200000,
      pollingInterval: 4000
    }
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY
  },
  gasReporter: {
    enabled: true,
    showMethodSig: true
  }
};
