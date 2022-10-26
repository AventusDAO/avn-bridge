const config = require('./config.json');

function error(errorMsg) {
  console.log('\nERROR:', errorMsg);
  process.exit(1);
}

function setupWallet() {
  const HdWalletProvider = require('@truffle/hdwallet-provider');

  const walletProviderURI = config.walletProviderURI;
  if (walletProviderURI == null || walletProviderURI == '') {
    error('set wallet provider URI in config, eg: "https://goerli.infura.io/v3/8df8c9b89d1b4566b45e77c6cccd9254"');
  }

  let security = config.security;
  if (security == 'random') {
    const bip39 = require('bip39');
    security = bip39.generateMnemonic();
  } else if (security == null || security == '') {
    error('set security in config to one of:' +
        '\n - your bip39 mnemonic phrase' +
        '\n - your private key without the 0x, eg: "3f841bf589fdf83a521e55d51afddc34fa65351161eead24f064855fc29c9580"' +
        '\n - "random": to use a random bip39 mnemonic for readonly access');
  }

  console.log('Creating wallet provider using address:', walletProviderURI);
  return new HdWalletProvider(security, walletProviderURI);
}

let walletProvider;

function getWallet() {
  if (walletProvider) {
    return walletProvider;
  }
  walletProvider = setupWallet();
  return walletProvider;
}

module.exports = {
  networks: {
    development: {
      host: "localhost",
      port: 8545,
      network_id: "*",
      gas: 8000000
    },
    goerli: {
      provider: () => getWallet(),
      network_id: 5,
      deploymentPollingInterval: 120000,
      disableConfirmationListener: true,
      maxFeePerGas: 100e9,
      maxPriorityFeePerGas: 5e9,
      gas: 8000000,
      timeoutBlocks: 125
    },
    mainnet: {
      provider: () => getWallet(),
      network_id: 1,
      deploymentPollingInterval: 120000,
      disableConfirmationListener: true,
      maxFeePerGas: 30e9,
      maxPriorityFeePerGas: 3e9,
      gas: 8000000,
      timeoutBlocks: 125
    }
  },
  compilers: {
    solc: {
      version: "0.8.11",
      settings: {
        optimizer: {
          enabled: true,
          runs: 2000
        }
      }
    }
  },
  plugins: [
    'solidity-coverage',
    'truffle-plugin-verify'
  ],
  api_keys: {
    etherscan: config.apikey
  }
};
