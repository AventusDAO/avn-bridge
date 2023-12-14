require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-chai-matchers');
require('@nomiclabs/hardhat-etherscan');
require('@nomiclabs/hardhat-ethers');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-contract-sizer');
require('hardhat-gas-reporter');
require('solidity-coverage');
require('hardhat-erc1820');

const { INFURA_API_KEY, ETHERSCAN_API_KEY, GOERLI_PRIVATE_KEY, MAINNET_PRIVATE_KEY } = require('./config');
const axios = require('axios');
const fs = require('fs');

task('deploy', 'deploy a new avn-bridge contract')
  .addOptionalParam('token', 'optional core token address', '0x97d9b397189e8b771FfAc3Cb04cf26C780a93431')
  .addOptionalParam('authors', 'optional filepath to initial author set', './authors.json')
  .setAction(async (args, hre) => {
    mainnetCheck(hre);
    await hre.run('compile');

    const authors = require(args.authors);
    const initArgs = [args.token, [], [], [], []];
    authors.forEach(author => {
      initArgs[1].push(author.ethAddress);
      initArgs[2].push('0x' + author.ethUncompressedPublicKey.slice(4, 68));
      initArgs[3].push('0x' + author.ethUncompressedPublicKey.slice(68, 132));
      initArgs[4].push(author.t2PublicKey);
    });

    const [deployer] = await hre.ethers.getSigners();
    console.log(`\nDeploying to ${hre.network.name} network using account ${deployer.address}...`);
    // delete any existing OZ manifests as we want to deploy anew, not upgrade
    if (fs.existsSync('./.openzeppelin/goerli.json')) fs.unlinkSync('./.openzeppelin/goerli.json');

    const balanceBefore = await deployer.getBalance();
    const AVNBridge = await hre.ethers.getContractFactory('AVNBridge');
    const avnBridge = await hre.upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' });
    await avnBridge.deployed();
    const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(avnBridge.address);

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
  mainnetCheck(hre);
  await hre.run('compile');

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
});

task('upgrade', 'upgrade existing avn-bridge contract')
  .addParam('bridge', 'existing AVN Bridge proxy address')
  .setAction(async (args, hre) => {
    mainnetCheck(hre);
    await hre.run('compile');

    const [upgrader] = await hre.ethers.getSigners();
    const balanceBefore = await upgrader.getBalance();
    console.log(`\nUpgrading ${args.bridge} on ${hre.network.name} network using account ${upgrader.address}...`);
    const AVNBridge = await ethers.getContractFactory('AVNBridge');
    try {
      await upgrades.upgradeProxy(args.bridge, AVNBridge);
    } catch (e) {
      if (e.toString().includes('use the forceImport function')) {
        console.log(
          `\nInvalid manifest. First prepare the manifest by running:\n\nnpx hardhat --network goerli prepare-manifests --bridge ${args.bridge}`
        );
        process.exit(0);
      } else {
        console.log(e);
        process.exit(1);
      }
    }
    console.log(`\nCost: ${hre.ethers.utils.formatEther(balanceBefore.sub(await upgrader.getBalance()))} ETH`);
    await new Promise(r => setTimeout(r, 30000));
    try {
      const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(args.bridge);
      await hre.run('verify', { address: implementationAddress });
    } catch (e) {}
  });

task('prepare-manifest', 'prepares the openzeppelin mainfest')
  .addParam('bridge', 'existing AVN Bridge proxy address')
  .setAction(async (args, hre) => {
    mainnetCheck(hre);
    const implementation = await upgrades.erc1967.getImplementationAddress(args.bridge);
    const url = `https://api-goerli.etherscan.io/api?module=contract&action=getsourcecode&address=${implementation}&apikey=${ETHERSCAN_API_KEY}`;
    const response = await axios.get(url);
    const sources = JSON.parse(response.data.result[0].SourceCode.slice(1, -1)).sources;
    const interfacePath = 'contracts/interfaces/IAVNBridge.sol';
    const contractPath = 'contracts/AVNBridge.sol';
    const interfaceCode = fs.readFileSync('./' + interfacePath, 'utf8');
    const contractCode = fs.readFileSync('./' + contractPath, 'utf8');
    fs.writeFileSync('./' + interfacePath, sources[interfacePath].content);
    fs.writeFileSync('./' + contractPath, sources[contractPath].content);
    await hre.run('compile');
    const AVNBridge = await ethers.getContractFactory('AVNBridge');
    await upgrades.forceImport(args.bridge, AVNBridge);
    fs.writeFileSync('./' + interfacePath, interfaceCode);
    fs.writeFileSync('./' + contractPath, contractCode);
    console.log('Done');
  });

function getWeb3Url(networkName) {
  if (!process.env.WEB3_URL_OVERRIDE) {
    return `https://${networkName}.infura.io/v3/${process.env.INFURA_API_KEY || INFURA_API_KEY}`;
  } else {
    return process.env.WEB3_URL_OVERRIDE;
  }
}

function mainnetCheck() {
  if (hre.network.name === 'mainnet') {
    console.log('MAINNET REQUIRES MANUAL OVERRIDE');
    process.exit(0);
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
