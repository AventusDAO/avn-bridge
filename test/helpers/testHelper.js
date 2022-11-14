const {MerkleTree} = require('merkletreejs');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const AVNBridge = artifacts.require('AVNBridge');
const keccak256 = require('keccak256');
const privateKeyToPublicKey = require('ethereum-private-key-to-public-key');
const keys = require('../../keys.json');
const BN = web3.utils.BN;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PSEUDO_ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const PROXY_LOWER_PROOF_LENGTH = 131;
const PROXY_LOWER_ID = '0x2d00';
const LOWER_ID = '0x2702';

let lastEventBlockNumbers = {};
let additionalTx = [];
let accounts = [];
let validators = [null];
const someT2PublicKey = randomBytes32();

async function init(_largeTree) {
  lastEventBlockNumbers = {};
  accounts = await web3.eth.getAccounts();

  for (i = 1; i < accounts.length; i++) {
    const t1PublicKey = getPublicKey(accounts[i]);
    validators.push({
      t1Address: accounts[i],
      t1PublicKey: t1PublicKey,
      t1PublicKeyLHS: t1PublicKey.slice(0,66),
      t1PublicKeyRHS: '0x' + t1PublicKey.slice(66,130),
      t2PublicKey: randomBytes32(),
      registered: false,
      active: false
    });
  }

  const randomTxHash = randomBytes32();
  if (_largeTree === true) {
    // For testing lower gas, this will cause a tree depth of 23, ie: up to 8.38m published TX per day or 3bn per year
    const largeNumberOfTransactions = 4194305;
    additionalTx = new Array(largeNumberOfTransactions).fill(randomTxHash);
  } else {
    additionalTx = [randomTxHash];
  }
}

async function deployAVNBridge(coreToken, prior) {
  priorInstance = prior || ZERO_ADDRESS;
  return await deployProxy(AVNBridge, [coreToken, priorInstance], {kind: 'uups'});
}

function bnEquals(a, b) {
  assert.equal(a.toString(), b.toString());
}

function getTxLeafMetadata() {
  // change part of what would be the ignored signature chunk to keep the leaves unique
  return '0x1505840050368dd692d19f39657a574ff9b9cc0c584219826ab1141d101f43a19a7f3122010edfa77444027c551df2f3'
    + strip_0x(randomBytes32()) + 'a6e6eaeff13956b192c9899a9993c16faea458458e35023800';
}

function createMerkleTree(_dataLeaves) {
  const dataLeaf = _dataLeaves[0];
  _dataLeaves[0] = web3.utils.soliditySha3(_dataLeaves[0]);
  const dataLeaves = Array.isArray(_dataLeaves) ? _dataLeaves : [_dataLeaves];
  const tree = new MerkleTree(dataLeaves, keccak256, {hashLeaves: false, sortPairs: true});
  return {
    leafData: dataLeaf,
    leafHash: '0x'+tree.leaves[0].toString('hex'),
    merklePath: tree.getHexProof(tree.leaves[0]),
    rootHash: tree.getHexRoot(),
    leaves: tree.getLeaves(),
    getMerklePath: (leaf, id) => tree.getHexProof(leaf, id)
  };
}

// maybe make random, maybe pass in t2 public key
async function getConfirmations(_contract, _data, _t2TransactionId, _adjustment, _startPos) {
  const startPos = _startPos || 1;
  const adjustment = _adjustment || 0;
  const numConfirmations = await getNumRequiredConfirmations(_contract) + adjustment;
  let concatenatedConfirmations = '0x';
  const confirmationHash = toConfirmationHash(_data, _t2TransactionId, validators[1].t2PublicKey);

  for (i = startPos; i <= numConfirmations; i++) {
    const confirmation = await sign(confirmationHash, validators[i].t1Address);
    concatenatedConfirmations += strip_0x(confirmation);
  }
  return concatenatedConfirmations;
}

async function getSingleConfirmation(_contract, _data, _t2TransactionId, _validator) {
  const confirmationHash = toConfirmationHash(_data, _t2TransactionId, validators[1].t2PublicKey);
  return await sign(confirmationHash, _validator);
}

async function loadValidators(avnBridge, validators, numValidators) {
  const initialValidators = validators.slice(1, numValidators + 1);
  let t1AddressArray = [];
  let t1PublicKeyLHSArray = [];
  let t1PublicKeyRHSArray = [];
  let t2PublicKeyArray = [];

  for await (let v of initialValidators) {
    t1AddressArray.push(v.t1Address);
    t1PublicKeyLHSArray.push(v.t1PublicKeyLHS);
    t1PublicKeyRHSArray.push(v.t1PublicKeyRHS);
    t2PublicKeyArray.push(v.t2PublicKey);
    v.registered = true;
    v.active = true;
  }

  await avnBridge.loadValidators(t1AddressArray, t1PublicKeyLHSArray, t1PublicKeyRHSArray, t2PublicKeyArray);
}

async function createTreeAndPublishRoot(_contract, _tokenAddress, _amount, _isProxyLower, _id) {
  const id = _id ? _id : _isProxyLower ? PROXY_LOWER_ID : LOWER_ID;
  const proxyProof = _isProxyLower ? strip_0x(web3.utils.randomHex(PROXY_LOWER_PROOF_LENGTH)) : '';
  const t2FromPublicKey = strip_0x(someT2PublicKey);
  const token = strip_0x(_tokenAddress);
  const amountBytes = toLittleEndianBytesStr(_amount);
  const t1Address = strip_0x(accounts[0]);
  const encodedLeaf = getTxLeafMetadata() + strip_0x(id) + proxyProof + t2FromPublicKey + token + amountBytes + t1Address;
  const leaves = [encodedLeaf].concat(additionalTx);
  const merkleTree = createMerkleTree(leaves);
  const t2TransactionId = randomUint256();
  const confirmations = await getConfirmations(_contract, merkleTree.rootHash, t2TransactionId);
  await _contract.publishRoot(merkleTree.rootHash, t2TransactionId, confirmations, {from: validators[1].t1Address});
  return merkleTree;
}

async function createTreeAndPublishRootWithLoweree(_contract, _loweree, _tokenAddress, _amount, _isProxyLower, _id) {
  const id = _id ? _id : _isProxyLower ? PROXY_LOWER_ID : LOWER_ID;
  const proxyProof = _isProxyLower ? strip_0x(web3.utils.randomHex(PROXY_LOWER_PROOF_LENGTH)) : '';
  const t2FromPublicKey = strip_0x(someT2PublicKey);
  const token = strip_0x(_tokenAddress);
  const amountBytes = toLittleEndianBytesStr(_amount);
  const t1Address = strip_0x(_loweree);
  const encodedLeaf = getTxLeafMetadata() + strip_0x(id) + proxyProof + t2FromPublicKey + token + amountBytes + t1Address;
  const leaves = [encodedLeaf].concat(additionalTx);
  const merkleTree = createMerkleTree(leaves);
  const t2TransactionId = randomUint256();
  const confirmations = await getConfirmations(_contract, merkleTree.rootHash, t2TransactionId);
  await _contract.publishRoot(merkleTree.rootHash, t2TransactionId, confirmations, {from: validators[1].t1Address});
  return merkleTree;
}

async function createTreeAndPublishRootFromTestLeaf(contract, testLeaf) {
  const leaves = [testLeaf, randomBytes32()];
  const merkleTree = await createMerkleTree(leaves);
  const t2TransactionId = randomUint256();
  const confirmations = await getConfirmations(contract, merkleTree.rootHash, t2TransactionId);
  await contract.publishRoot(merkleTree.rootHash, t2TransactionId, confirmations, {from: validators[1].t1Address});
  return merkleTree;
}

async function getNumRequiredConfirmations(_contract) {
  const numValidators = (await _contract.numActiveValidators()).toNumber();
  quorum = [await _contract.quorum(0), await _contract.quorum(1)];
  return Math.floor(numValidators * quorum[0].toNumber() / quorum[1].toNumber()) + 1;
}

async function expectRevert(_myFunc, _expectedError) {
  const ganacheRevert = 'Error: Returned error: VM Exception while processing transaction: revert';
  try {
    await _myFunc();
    assert(false, 'Test did not revert as expected');
  } catch (error) {
    const errorString = error.toString();
    assert(errorString.includes(ganacheRevert), `Did not get a ganache revert:  ${errorString}`);
    if (process.env.SKIP_REVERT_ERR === undefined || process.env.SKIP_REVERT_ERR == 0) {
      let actualError = errorString.split('Reason given: ')[1];
      if (actualError) {
        actualError = actualError.split('.')[0].trim();
      } else {
        actualError = errorString.split(ganacheRevert)[1].trim();
      }
      assert.equal(_expectedError, actualError);
    }
  }
}

function getLogArgs(_contract, _event, _expectLog) {
  const expectLog = (_expectLog === undefined) ? true : _expectLog;
  return new Promise(async (resolve, reject) => {
    const key = _event + _contract.address;
    if (!(key in lastEventBlockNumbers)) lastEventBlockNumbers[key] = -1;
    const log = await _contract.getPastEvents(_event, {fromBlock: lastEventBlockNumbers[key] + 1})
    if (log.length == 0) {
      if (expectLog) {
        reject(new Error('No events found'));
      } else {
        resolve(true);
      }
    } else {
      if (!expectLog) {
        reject(new Error('Events found!'));
      }
      const event = log[log.length - 1];
      lastEventBlockNumbers[key] = event.blockNumber;
      resolve(event.args);
    }
  });
}

function hash() {
  return web3.utils.soliditySha3(...arguments);
}

function checkGas(_tx, _expectedValue) {
  const gasUsed = _tx.receipt.gasUsed;
  assert.isBelow(gasUsed, _expectedValue);
  console.log(gasUsed);
}

function sumTxGas(_tx1, _tx2) {
  return {receipt:{gasUsed:_tx1.receipt.gasUsed + _tx2.receipt.gasUsed}};
}

function toConfirmationHash(_data, _t2TransactionId, _t2PublicKey) {
  return web3.utils.sha3(web3.eth.abi.encodeParameters(['bytes32', 'uint256', 'bytes32'], [_data, _t2TransactionId.toString(),
      _t2PublicKey]));
}

function randomBytes32() {
  return web3.utils.randomHex(32);
}

function randomUint256() {
  return web3.utils.toBN(randomBytes32());
}

function sign(_data, _signer) {
  return web3.eth.sign(_data, _signer);
}

function strip_0x(_bytes) {
  return _bytes.substring(0, 2) == '0x' ? _bytes.substring(2) : _bytes;
}

function getPublicKey(_address) {
  return '0x' + privateKeyToPublicKey(keys.private_keys[_address.toLowerCase()]).toString('hex').substring(2);
}

function toLittleEndianBytesStr(_amount) {
  let result = _amount.toString(16);
  result = (result.length % 2 == 0) ? result : '0' + result;
  return result.match(/.{1,2}/g).reverse().join('').padEnd(32, '0');
}

async function increaseBlockTimestamp(seconds) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [seconds],
      id: new Date().getTime()
    }, (err, result) => {
      if (err) { return reject(err) }
      return resolve(result)
    })
  })
}

async function getCurrentBlockTimestamp(){
  const block = await web3.eth.getBlock('latest');
  return block.timestamp;
}

// Keep exports alphabetical.
module.exports = {
  accounts: () => accounts,
  bnEquals,
  checkGas,
  createMerkleTree,
  createTreeAndPublishRoot,
  createTreeAndPublishRootFromTestLeaf,
  createTreeAndPublishRootWithLoweree,
  deployAVNBridge,
  expectRevert,
  getConfirmations,
  getCurrentBlockTimestamp,
  getLogArgs,
  getNumRequiredConfirmations,
  getPublicKey,
  getSingleConfirmation,
  hash,
  increaseBlockTimestamp,
  init,
  loadValidators,
  LOWER_ID,
  PROXY_LOWER_ID,
  PSEUDO_ETH_ADDRESS,
  randomBytes32,
  randomUint256,
  sign,
  someT2PublicKey: () => someT2PublicKey,
  strip_0x,
  sumTxGas,
  toConfirmationHash,
  validators: () => validators,
};