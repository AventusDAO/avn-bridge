const AVN = artifacts.require('AVN');
const Unlocker = artifacts.require('Unlocker');
const { deployProxy, erc1967, upgradeProxy } = require('@openzeppelin/truffle-upgrades');
const fs = require('fs');

module.exports = async function(deployer, network, accounts) {
  let coreToken = '0xe0A9E4f2591be648f18001e21dB16dDAB114fEF9';
  const priorInstance = '0xecE457B95b3e8C6e3f174995a0BEe59Fff0b13Cd';

  if (network.startsWith('development')) {
    const { singletons } = require('@openzeppelin/test-helpers');
    console.log('*** Deploying ERC1820Registry on development network...');
    await singletons.ERC1820Registry(accounts[0]);
    const Token20 = artifacts.require('Token20');
    const Token777 = artifacts.require('Token777');
    await deployer.deploy(Token20, 10000000);
    const token20 = await Token20.deployed();
    coreToken = token20.address;
    await deployer.deploy(Token777, 10000000);
  }

  if (network.startsWith('mainnet')) {
    console.log('Requires manual setup for mainnet deployment');
    console.log('In truffle-config.js set maxFeePerGas to Base + 50% and maxPriorityFeePerGas to Priority + 2 from: https://etherscan.io/gastracker');
    console.log('Set infura URI and funded mainnet account private key in config.json');
    process.exit(1); // safety

    coreToken = '0x0d88eD6E74bbFD96B831231638b66C05571e824F';
    priorInstance = '0xb01eF958F37E999a5528D14F825Cd429596F3864';
  }

  if (network !== 'development') {
    const avnProxy = await deployProxy(AVN, [coreToken, priorInstance], { deployer, kind: 'uups' });
    await deployer.deploy(Unlocker, avnProxy.address, priorInstance);
    const unlocker = await Unlocker.deployed();
    const implementationAddress = await erc1967.getImplementationAddress(avnProxy.address);
    fs.writeFileSync('./implementationAddress.txt', `AVN@${implementationAddress}`);
  }

  // if (network !== 'development') {
  //   const avnProxyAddress = '' // FILL ME IN WITH: existing avnProxy address from initial deployment
  //   // NOTE: Either extend original AVN or replace with an AVN_2 which inherits it
  //   await upgradeProxy(avnProxyAddress, AVN, { deployer, kind: 'uups' });
  //   const implementationAddress = await erc1967.getImplementationAddress(avnProxyAddress);
  //   fs.writeFileSync('./implementationAddress.txt', `AVN@${implementationAddress}`);
  // }
};