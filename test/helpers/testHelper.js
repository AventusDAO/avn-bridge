const { MerkleTree } = require('merkletreejs');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const keccak256 = require('keccak256');

const ONE_AVT_IN_ATTO = ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18));
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PSEUDO_ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const PROXY_LOWER_PROOF_LENGTH = 131;
const PROXY_LOWER_ID = '0x5900';
const LOWER_ID = '0x5702';
const DIRECT_LOWER_NUM_BYTES = 2;
const PROXY_LOWER_NUM_BYTES = 133;
const GROWTH_DELAY = 100;
const EXPIRY_WINDOW = 60;

let additionalTx = [];
let accounts = [];
let authors = [];
let owner;
let lowerId = 0;
const someT2PubKey = randomBytes32();

async function init(largeTree) {
  const [funder] = await ethers.getSigners();
  [owner] = await ethers.provider.listAccounts();

  for (i = 0; i < 30; i++) {
    // Generate a new random account (instantiating as a Wallet is the only way to retrieve the public and private keys we need)
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    // Fund it with ETH from deployer account
    await funder.sendTransaction({ to: account.address, value: ethers.utils.parseEther('10000') });

    accounts.push(account);

    authors.push({
      account: account,
      t1Address: account.address,
      t1PubKey: '0x' + account.publicKey.slice(4, 132),
      t1PubKeyLHS: '0x' + account.publicKey.slice(4, 68),
      t1PubKeyRHS: '0x' + account.publicKey.slice(68, 132),
      t2PubKey: randomBytes32(),
      registered: false,
      active: false
    });
  }

  const randomTxHash = randomBytes32();
  if (largeTree === true) {
    // For testing lower gas, this will cause a tree depth of 23, ie: up to 8.38m published TX per day or 3bn per year
    const largeNumberOfTransactions = 4194305;
    additionalTx = new Array(largeNumberOfTransactions).fill(randomTxHash);
  } else {
    additionalTx = [randomTxHash];
  }
}

async function deployAVNBridge(coreToken) {
  const AVNBridge = await ethers.getContractFactory('AVNBridge');
  return await upgrades.deployProxy(AVNBridge, [coreToken], { kind: 'uups' });
}

function getTxLeafMetadata() {
  // change part of what would be the ignored signature chunk to keep the leaves unique
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
  startPos = startPos || 2; // Start from Author 2 as Author 1 always sends the tx
  adjustment = adjustment || 0;
  const numConfirmations = (await getNumRequiredConfirmations(contract)) + adjustment;
  let concatenatedConfirmations = '0x';
  const confirmationHash = toConfirmationHash[method](data, expiry, t2TxId);
  for (i = startPos; i <= numConfirmations; i++) {
    const confirmation = await authors[i].account.signMessage(ethers.utils.arrayify(confirmationHash));
    concatenatedConfirmations += strip_0x(confirmation);
  }
  return concatenatedConfirmations;
}

async function getSingleConfirmation(contract, method, data, expiry, t2TxId, author) {
  const confirmationHash = toConfirmationHash[method](data, expiry, t2TxId);
  return await author.account.signMessage(ethers.utils.arrayify(confirmationHash));
}

async function loadAuthors(avnBridge, authors, numAuthors) {
  let t1AddressArray = [];
  let t1PubKeyLHSArray = [];
  let t1PubKeyRHSArray = [];
  let t2PubKeyArray = [];

  for (i = 0; i < numAuthors; i++) {
    t1AddressArray.push(authors[i].t1Address);
    t1PubKeyLHSArray.push(authors[i].t1PubKeyLHS);
    t1PubKeyRHSArray.push(authors[i].t1PubKeyRHS);
    t2PubKeyArray.push(authors[i].t2PubKey);
    authors[i].registered = true;
    authors[i].active = true;
  }

  await avnBridge.loadAuthors(t1AddressArray, t1PubKeyLHSArray, t1PubKeyRHSArray, t2PubKeyArray);
}

async function createTreeAndPublishRoot(contract, tokenAddress, amount, isProxyLower, id) {
  id = id ? id : isProxyLower ? PROXY_LOWER_ID : LOWER_ID;
  const proxyProof = isProxyLower ? strip_0x(randomHex(PROXY_LOWER_PROOF_LENGTH)) : '';
  const t2FromPubKey = strip_0x(someT2PubKey);
  const token = strip_0x(tokenAddress);
  const amountBytes = toLittleEndianBytesStr(amount);
  const t1Address = strip_0x(owner);
  const encodedLeaf = getTxLeafMetadata() + strip_0x(id) + proxyProof + t2FromPubKey + token + amountBytes + t1Address;
  const leaves = [encodedLeaf].concat(additionalTx);
  const merkleTree = createMerkleTree(leaves);
  const expiry = await getValidExpiry();
  const t2TxId = randomT2TxId();
  const confirmations = await getConfirmations(contract, 'publishRoot', merkleTree.rootHash, expiry, t2TxId);
  await contract.connect(authors[0].account).publishRoot(merkleTree.rootHash, expiry, t2TxId, confirmations);
  return merkleTree;
}

async function createTreeAndPublishRootWithLoweree(contract, loweree, tokenAddress, amount, isProxyLower, id) {
  id = id ? id : isProxyLower ? PROXY_LOWER_ID : LOWER_ID;
  const proxyProof = isProxyLower ? strip_0x(randomHex(PROXY_LOWER_PROOF_LENGTH)) : '';
  const t2FromPubKey = strip_0x(someT2PubKey);
  const token = strip_0x(tokenAddress);
  const amountBytes = toLittleEndianBytesStr(amount);
  const t1Address = strip_0x(loweree);
  const encodedLeaf = getTxLeafMetadata() + strip_0x(id) + proxyProof + t2FromPubKey + token + amountBytes + t1Address;
  const leaves = [encodedLeaf].concat(additionalTx);
  const merkleTree = createMerkleTree(leaves);
  const expiry = await getValidExpiry();
  const t2TxId = randomT2TxId();
  const confirmations = await getConfirmations(contract, 'publishRoot', merkleTree.rootHash, expiry, t2TxId);
  await contract.connect(authors[0].account).publishRoot(merkleTree.rootHash, expiry, t2TxId, confirmations);
  return merkleTree;
}

async function createTreeAndPublishRootFromTestLeaf(contract, testLeaf) {
  const leaves = [testLeaf, randomBytes32()];
  const merkleTree = await createMerkleTree(leaves);
  const expiry = await getValidExpiry();
  const t2TxId = randomT2TxId();
  const confirmations = await getConfirmations(contract, 'publishRoot', merkleTree.rootHash, expiry, t2TxId);
  await contract.connect(authors[0].account).publishRoot(merkleTree.rootHash, expiry, t2TxId, confirmations);
  return merkleTree;
}

async function getNumRequiredConfirmations(contract) {
  const numAuthors = (await contract.numActiveAuthors()).toNumber();
  return numAuthors - Math.floor((numAuthors * 2) / 3);
}

const toConfirmationHash = {
  publishRoot: function (data, expiry, t2TxId) {
    const encodedParams = ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256', 'uint32'], [data, expiry, t2TxId]);
    return ethers.utils.solidityKeccak256(['bytes'], [encodedParams]);
  },
  addAuthor: function (data, expiry, t2TxId) {
    const encodedParams = ethers.utils.defaultAbiCoder.encode(
      ['bytes', 'bytes32', 'uint256', 'uint32'],
      [data[0], data[1], expiry, t2TxId]
    );
    return ethers.utils.solidityKeccak256(['bytes'], [encodedParams]);
  },
  removeAuthor: function (data, expiry, t2TxId) {
    const encodedParams = ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes', 'uint256', 'uint32'],
      [data[0], data[1], expiry, t2TxId]
    );
    return ethers.utils.solidityKeccak256(['bytes'], [encodedParams]);
  },
  triggerGrowth: function (data, expiry, t2TxId) {
    const encodedParams = ethers.utils.defaultAbiCoder.encode(
      ['uint128', 'uint128', 'uint32', 'uint256', 'uint32'],
      [data[0], data[1], data[2], expiry, t2TxId]
    );
    return ethers.utils.solidityKeccak256(['bytes'], [encodedParams]);
  }
};

function randomHex(length) {
  const bytes = ethers.utils.randomBytes(length);
  return ethers.utils.hexlify(bytes);
}

function randomBytes32() {
  return randomHex(32);
}

function randomT2TxId() {
  return ethers.BigNumber.from(randomHex(4));
}

function strip_0x(bytes) {
  return bytes.substring(0, 2) == '0x' ? bytes.substring(2) : bytes;
}

function toLittleEndianBytesStr(amount) {
  let result = strip_0x(ethers.utils.hexlify(amount));
  result = result.length % 2 == 0 ? result : '0' + result;
  return result
    .match(/.{1,2}/g)
    .reverse()
    .join('')
    .padEnd(32, '0');
}

async function increaseBlockTimestamp(seconds) {
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
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

async function createLowerProof(contract, token, amount, recipient) {
  lowerId++;
  const lowerData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'address', 'uint256'],
    [token, amount, recipient, lowerId]
  );
  const lowerHash = ethers.utils.solidityKeccak256(['bytes'], [lowerData]);
  let confirmations = '0x';
  // Twice the required amount allows for reasonable changes to validator set to occur between proof being generated and used:
  const doubleRequiredConfirmations = await getNumRequiredConfirmations(contract) * 2;
  for (i = 1; i <= doubleRequiredConfirmations; i++) {
    const confirmation = await authors[i].account.signMessage(ethers.utils.arrayify(lowerHash));
    confirmations += strip_0x(confirmation);
  }
  const lowerProof = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'address', 'uint256', 'bytes'],
    [token, amount, recipient, lowerId, confirmations]
  );
  return [lowerProof, lowerHash];
}

// Keep exports alphabetical.
module.exports = {
  accounts: () => accounts,
  createMerkleTree,
  createLowerProof,
  createTreeAndPublishRoot,
  createTreeAndPublishRootFromTestLeaf,
  createTreeAndPublishRootWithLoweree,
  deployAVNBridge,
  DIRECT_LOWER_NUM_BYTES,
  EXPIRY_WINDOW,
  getConfirmations,
  getCurrentBlockTimestamp,
  getNumRequiredConfirmations,
  getSingleConfirmation,
  getValidExpiry,
  GROWTH_DELAY,
  increaseBlockTimestamp,
  init,
  keccak256,
  loadAuthors,
  LOWER_ID,
  PROXY_LOWER_ID,
  PROXY_LOWER_NUM_BYTES,
  PSEUDO_ETH_ADDRESS,
  ONE_AVT_IN_ATTO,
  owner: () => owner,
  randomBytes32,
  randomHex,
  randomT2TxId,
  someT2PubKey: () => someT2PubKey,
  strip_0x,
  toConfirmationHash,
  authors: () => authors,
  ZERO_ADDRESS
};
