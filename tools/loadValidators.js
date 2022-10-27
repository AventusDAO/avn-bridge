const Web3 = require('web3');
const HDWalletProvider = require('@truffle/hdwallet-provider');
const config = require('../config.json');
const provider = new HDWalletProvider(config.security, config.walletProviderURI);
const web3 = new Web3(provider);

async function main() {
  const [ chain, to, validators_path ] = process.argv.slice(2);
  const validators = require(validators_path);
  const t1Address = [], t1PublicKeyLHS = [], t1PublicKeyRHS = [], t2PublicKey = [];

  validators.forEach(validator => {
    t1Address.push(validator.ethAddress);
    t1PublicKeyLHS.push('0x' + validator.ethUncompressedPublicKey.slice(4, 68));
    t1PublicKeyRHS.push('0x' + validator.ethUncompressedPublicKey.slice(68, 132));
    t2PublicKey.push(validator.validator.tier2PublicKeyHex);
  });

  const data = await web3.eth.abi.encodeFunctionCall({
    name: 'loadValidators',
    type: 'function',
    inputs: [
      {
        type: 'address[]',
        name: 't1Address'
      },
      {
        type: 'bytes32[]',
        name: 't1PublicKeyLHS'
      },
      {
        type: 'bytes32[]',
        name: 't1PublicKeyRHS'
      },
      {
        type: 'bytes32[]',
        name: 't2PublicKey'
      }
    ]
  }, [ t1Address, t1PublicKeyLHS, t1PublicKeyRHS, t2PublicKey ]);

  await web3.eth.sendTransaction({ from: (await web3.eth.getAccounts())[0], to, data, chain })
    .on('receipt', receipt => console.log('receipt:', receipt))
    .on('error', console.error);

  process.exit(0);
}

if (require.main === module) main();