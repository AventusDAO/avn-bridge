const { MerkleTree } = require('merkletreejs');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const keccak256 = require('keccak256');
const { ethers } = require('hardhat');
const { AbiCoder } = require('ethers');
const abi = new AbiCoder();

const ONE_AVT_IN_ATTO = 1000000000000000000n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PSEUDO_ETH_ADDRESS = ethers.getAddress('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
const LOWER_ID = '0x5702';
const EXPIRY_WINDOW = 60;
const MIN_AUTHORS = 4;

let additionalTx = [];
let accounts = [];
let authors = [];
let owner;
let lowerId = 0;
const someT2PubKey = randomBytes32();

function toAuthorAccount(account) {
  const { publicKey } = account.signingKey;
  const formatPubKey = key => `0x${key}`;
  return {
    account,
    t1Address: account.address,
    t1PubKey: formatPubKey(publicKey.slice(4, 132)),
    t1PubKeyLHS: formatPubKey(publicKey.slice(4, 68)),
    t1PubKeyRHS: formatPubKey(publicKey.slice(68, 132)),
    t2PubKey: randomHex(32)
  };
}

async function init(largeTree) {
  const [funder] = await ethers.getSigners();
  [owner] = await ethers.getSigners();

  accounts = [owner];

  for (let i = 0; i < 20; i++) {
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    await funder.sendTransaction({ to: account.address, value: ethers.parseEther('1') });
    accounts.push(account);
  }

  for (i = 0; i < 30; i++) {
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    await funder.sendTransaction({ to: account.address, value: ethers.parseEther('1') });
    authors.push(toAuthorAccount(account));
  }

  const randomTxHash = randomBytes32();
  if (largeTree === true) {
    const largeNumberOfTransactions = 4194305;
    additionalTx = new Array(largeNumberOfTransactions).fill(randomTxHash);
  } else {
    additionalTx = [randomTxHash];
  }
}

function generateInitArgs(coreToken, numAuthors) {
  const initArgs = [coreToken, [], [], [], []];
  for (i = 0; i < numAuthors; i++) {
    initArgs[1].push(authors[i].t1Address);
    initArgs[2].push(authors[i].t1PubKeyLHS);
    initArgs[3].push(authors[i].t1PubKeyRHS);
    initArgs[4].push(authors[i].t2PubKey);
    authors[i].registered = true;
    authors[i].active = true;
  }

  return initArgs;
}

async function deployAVNBridge(coreToken, numAuthors) {
  const initArgs = generateInitArgs(coreToken, numAuthors);
  const AVNBridge = await ethers.getContractFactory('AVNBridge');
  return await upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' });
}

function getTxLeafMetadata() {
  return (
    '0x1505840050368dd692d19f39657a574ff9b9cc0c584219826ab1141d101f43a19a7f3122010edfa77444027c551df2f3' +
    strip_0x(randomBytes32()) +
    'a6e6eaeff13956b192c9899a9993c16faea458458e35023800'
  );
}

function createMerkleTree(dataLeaves) {
  const dataLeaf = dataLeaves[0];
  dataLeaves[0] = keccak256(dataLeaves[0]);
  dataLeaves = Array.isArray(dataLeaves) ? dataLeaves : [dataLeaves];
  const tree = new MerkleTree(dataLeaves, keccak256, { hashLeaves: false, sortPairs: true });
  return {
    leafData: dataLeaf,
    leafHash: '0x' + tree.leaves[0].toString('hex'),
    merklePath: tree.getHexProof(tree.leaves[0]),
    rootHash: tree.getHexRoot(),
    leaves: tree.getLeaves(),
    getMerklePath: (leaf, id) => tree.getHexProof(leaf, id)
  };
}

async function getConfirmations(contract, method, data, expiry, t2TxId, adjustment, startPos) {
  startPos = startPos || 2;
  adjustment = adjustment || 0;
  const numConfirmations = (await getNumRequiredConfirmations(contract)) + adjustment;
  let concatenatedConfirmations = '0x';
  const confirmationHash = toConfirmationHash[method](data, expiry, t2TxId);
  for (i = startPos; i <= numConfirmations; i++) {
    const confirmation = await authors[i].account.signMessage(ethers.getBytes(confirmationHash));
    concatenatedConfirmations += strip_0x(confirmation);
  }
  return concatenatedConfirmations;
}

async function getSingleConfirmation(contract, method, data, expiry, t2TxId, author) {
  const confirmationHash = toConfirmationHash[method](data, expiry, t2TxId);
  return await author.account.signMessage(ethers.getBytes(confirmationHash));
}

async function createTreeAndPublishRoot(bridge, tokenAddress, amount) {
  const t2FromPubKey = strip_0x(randomBytes32());
  const token = strip_0x(tokenAddress);
  const amountBytes = toLittleEndianBytesStr(amount);
  const t1Address = strip_0x(owner.address);
  const encodedLeaf = getTxLeafMetadata() + strip_0x(LOWER_ID) + t2FromPubKey + token + amountBytes + t1Address;
  const leaves = [encodedLeaf].concat(additionalTx);
  const merkleTree = createMerkleTree(leaves);
  const expiry = await getValidExpiry();
  const t2TxId = randomT2TxId();
  const confirmations = await getConfirmations(bridge, 'publishRoot', merkleTree.rootHash, expiry, t2TxId);
  await bridge.connect(authors[0].account).publishRoot(merkleTree.rootHash, expiry, t2TxId, confirmations);
  return merkleTree;
}

async function getNumRequiredConfirmations(contract) {
  const numAuthors = Number(await contract.numActiveAuthors());
  return numAuthors - Math.floor((numAuthors * 2) / 3);
}

const toConfirmationHash = {
  publishRoot: function (data, expiry, t2TxId) {
    const encodedParams = abi.encode(['bytes32', 'uint256', 'uint32'], [data, expiry, t2TxId]);
    return ethers.solidityPackedKeccak256(['bytes'], [encodedParams]);
  },
  addAuthor: function (data, expiry, t2TxId) {
    const encodedParams = abi.encode(['bytes', 'bytes32', 'uint256', 'uint32'], [data[0], data[1], expiry, t2TxId]);
    return ethers.solidityPackedKeccak256(['bytes'], [encodedParams]);
  },
  removeAuthor: function (data, expiry, t2TxId) {
    const encodedParams = abi.encode(['bytes32', 'bytes', 'uint256', 'uint32'], [data[0], data[1], expiry, t2TxId]);
    return ethers.solidityPackedKeccak256(['bytes'], [encodedParams]);
  },
  triggerGrowth: function (data, expiry, t2TxId) {
    const encodedParams = abi.encode(['uint128', 'uint128', 'uint32', 'uint256', 'uint32'], [data[0], data[1], data[2], expiry, t2TxId]);
    return ethers.solidityPackedKeccak256(['bytes'], [encodedParams]);
  }
};

function randomHex(length) {
  const bytes = ethers.randomBytes(length);
  return ethers.hexlify(bytes);
}

function randomBytes32() {
  return randomHex(32);
}

function randomT2TxId() {
  return ethers.toBigInt(randomHex(4));
}

const strip_0x = bytes => (bytes.startsWith('0x') ? bytes.slice(2) : bytes);

function toLittleEndianBytesStr(amount) {
  let hexStr = ethers.toBeHex(amount).slice(2);
  hexStr = hexStr.length % 2 === 0 ? hexStr : '0' + hexStr;
  const littleEndian = hexStr
    .match(/.{1,2}/g)
    .reverse()
    .join('');
  return littleEndian.padEnd(64, '0');
}

async function increaseBlockTimestamp(seconds) {
  const currentBlockTimestamp = await getCurrentBlockTimestamp();
  await time.increaseTo(currentBlockTimestamp + seconds);
}

async function getCurrentBlockTimestamp() {
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  return block.timestamp;
}

async function getValidExpiry() {
  return (await getCurrentBlockTimestamp()) + EXPIRY_WINDOW;
}

async function createLowerProof(bridge, tokenAddress, amount, recipientAddress) {
  lowerId++;

  const tokenBytes = ethers.getBytes(tokenAddress);
  const amountBytes = ethers.toBeHex(amount, 32);
  const recipientBytes = ethers.getBytes(recipientAddress);
  const lowerIdBytes = ethers.toBeHex(lowerId, 4);
  const lowerDataBytes = ethers.concat([tokenBytes, amountBytes, recipientBytes, lowerIdBytes]);
  const lowerHash = ethers.keccak256(lowerDataBytes);
  const numActiveAuthors = await bridge.numActiveAuthors();
  const supermajorityConfirmations = Number(numActiveAuthors) - (await getNumRequiredConfirmations(bridge));

  const confirmations = [];
  for (let i = 1; i <= supermajorityConfirmations; i++) {
    const confirmation = await authors[i].account.signMessage(ethers.getBytes(lowerHash));
    confirmations.push(ethers.getBytes(confirmation));
  }

  const confirmationsBytes = ethers.concat(confirmations);
  const lowerProof = ethers.concat([lowerDataBytes, confirmationsBytes]);
  return [lowerProof, lowerId];
}

// Keep exports alphabetical.
module.exports = {
  accounts: () => accounts,
  authors: () => authors,
  createLowerProof,
  createTreeAndPublishRoot,
  deployAVNBridge,
  EXPIRY_WINDOW,
  generateInitArgs,
  getConfirmations,
  getCurrentBlockTimestamp,
  getNumRequiredConfirmations,
  getSingleConfirmation,
  getValidExpiry,
  increaseBlockTimestamp,
  init,
  keccak256,
  MIN_AUTHORS,
  ONE_AVT_IN_ATTO,
  owner: () => owner,
  PSEUDO_ETH_ADDRESS,
  randomBytes32,
  randomHex,
  randomT2TxId,
  someT2PubKey: () => someT2PubKey,
  strip_0x,
  toConfirmationHash,
  ZERO_ADDRESS
};
