const Migrations = artifacts.require('Migrations');

module.exports = async function(_deployer, _network, _accounts) {
  if (_network.startsWith('mainnet')) {
    console.log('Requires manual setup for mainnet deployment');
    console.log('In truffle-config.js set maxFeePerGas to Base + 50% and maxPriorityFeePerGas to Priority + 2 from: https://etherscan.io/gastracker');
    console.log('Set infura URI and funded mainnet account private key in config.json');
    process.exit(1); // safety
  }

  await _deployer.deploy(Migrations);
  const migrations = await Migrations.deployed();
};