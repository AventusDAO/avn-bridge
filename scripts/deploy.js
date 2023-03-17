const hh = require('hardhat');
const ethers = hh.ethers;
const upgrades = hh.upgrades;
const runtime = hh.run;
const fs = require('fs');

const GOERLI_CORE_TOKEN = '0xe0A9E4f2591be648f18001e21dB16dDAB114fEF9';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function main() {
  const [deployer] = await ethers.getSigners();

  if (network === 'mainnet') {
    console.log('Requires manual setup for mainnet deployment');
    process.exit(1); // safety
  } else {
    if (fs.existsSync('./.openzeppelin/goerli.json')) fs.unlinkSync('./.openzeppelin/goerli.json');
    console.log(`\nDeploying to Goerli using account ${deployer.address}...`);
    const { maxFeePerGas, maxPriorityFeePerGas } = await ethers.provider.getFeeData();
    const balanceBefore = await deployer.getBalance();
    const AVNBridge = await ethers.getContractFactory('AVNBridge');
    const avnBridge = await upgrades.deployProxy(AVNBridge, [GOERLI_CORE_TOKEN, ZERO_ADDRESS], { kind: 'uups' });
    await avnBridge.deployed();
    await wait();
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(avnBridge.address);
    await runtime('verify', { address: implementationAddress });
    await runtime('verify', { address: avnBridge.address });
    console.log(`\nTotal cost: ${ethers.utils.formatEther(balanceBefore.sub(await deployer.getBalance()))} ETH`);
    console.log(`\nContract: ${avnBridge.address}`);
  }
};

const wait = () => new Promise((r) => setTimeout(r, 10000));

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });