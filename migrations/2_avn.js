const AVN = artifacts.require('AVN');
const fs = require('fs');

module.exports = async function(_deployer, _network, _accounts) {
  let coreToken = '0xdB1Cff52f66195f0a5Bd3db91137db98cfc54AE6';
  const priorInstance = '0x0000000000000000000000000000000000000000';

  if (_network.startsWith('development')) {
    const { singletons } = require('@openzeppelin/test-helpers');
    console.log('*** Deploying ERC1820Registry on development network...');
    await singletons.ERC1820Registry(_accounts[0]);
    const Token20 = artifacts.require('Token20');
    const Token777 = artifacts.require('Token777');
    await _deployer.deploy(Token20, 10000000);
    const token20 = await Token20.deployed();
    coreToken = token20.address;
    await _deployer.deploy(Token777, 10000000);
  }

  if (_network.startsWith('mainnet')) {
    coreToken = '0x0d88eD6E74bbFD96B831231638b66C05571e824F';
  }

  await _deployer.deploy(AVN, coreToken, priorInstance);
  const avn = await AVN.deployed();
};