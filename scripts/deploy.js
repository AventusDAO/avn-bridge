const hh = require('hardhat');
const ethers = hh.ethers;
const upgrades = hh.upgrades;
const runtime = hh.run;
const fs = require('fs');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function main() {
  const [deployer] = await ethers.getSigners();

  if (network === 'mainnet') {
    console.log('Requires manual setup for mainnet deployment');
    process.exit(1); // safety
  } else {
    fs.unlinkSync('./.openzeppelin/goerli.json');
    console.log('\nDeploying to Goerli using account:', deployer.address);
    const { maxFeePerGas, maxPriorityFeePerGas } = await ethers.provider.getFeeData();
    const balanceBefore = await deployer.getBalance();
    const AVNBridge = await ethers.getContractFactory('AVNBridge');
    const coreToken = '0xe0A9E4f2591be648f18001e21dB16dDAB114fEF9';
    const avnBridgeProxy = await upgrades.deployProxy(AVNBridge, [coreToken, ZERO_ADDRESS], { kind: 'uups' , maxFeePerGas, maxPriorityFeePerGas, type: 2 });
    await avnBridgeProxy.deployed();
    const avnBridgeAddress = await upgrades.erc1967.getImplementationAddress(avnBridgeProxy.address);
    await runtime('verify:verify', { address: avnBridgeAddress, constuctorArguments: [coreToken, ZERO_ADDRESS] });
    console.log('Total ETH cost:', ethers.utils.formatEther(balanceBefore.sub(await deployer.getBalance())));
    return avnBridgeAddress;
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });