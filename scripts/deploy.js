const hh = require('hardhat');
const network = hh.network;
const ethers = hh.ethers;
const upgrades = hh.upgrades;
const runtime = hh.run;
const fs = require('fs');

const GOERLI_CORE_TOKEN = '0xe0A9E4f2591be648f18001e21dB16dDAB114fEF9';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function main() {
  const [deployer] = await ethers.getSigners();

  if (network.name === 'mainnet') {
    console.log('Requires manual setup for mainnet deployment');
    process.exit(1); // safety
  } else {
    if (fs.existsSync('./.openzeppelin/goerli.json')) fs.unlinkSync('./.openzeppelin/goerli.json');
    if (fs.existsSync('./.openzeppelin/unknown-73799.json')) fs.unlinkSync('./.openzeppelin/unknown-73799.json');

    console.log(`\nDeploying to ${network.name} using account ${deployer.address}...`);
    const balanceBefore = await deployer.getBalance();
    const AVNBridge = await ethers.getContractFactory('AVNBridge');
    const avnBridge = await upgrades.deployProxy(AVNBridge, [GOERLI_CORE_TOKEN, ZERO_ADDRESS], { kind: 'uups' });
    await avnBridge.deployed();
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(avnBridge.address);

    if (network.name === 'goerli') { // publish contracts
      await wait();
      await runtime('verify', { address: implementationAddress });
      await runtime('verify', { address: avnBridge.address });
    }

    console.log(`\nTotal cost: ${ethers.utils.formatEther(balanceBefore.sub(await deployer.getBalance()))} ETH`);
    console.log(`\nImplementation: ${implementationAddress}`);
    console.log(`\nContract: ${avnBridge.address}`);
  }
};

const wait = () => new Promise((r) => setTimeout(r, 20000));

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });