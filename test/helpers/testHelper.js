const { MerkleTree } = require('merkletreejs');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { ethers, upgrades } = require('hardhat');
const keccak256 = require('keccak256');
const { expect } = require('chai');

const AVT_SYMBOL_BYTES_32 = '0x4156540000000000000000000000000000000000000000000000000000000000';
const EMPTY_BYTES_32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const EXPIRY_WINDOW = 60;
const LOWER_ID = '0x5702';
const MIN_AUTHORS = 4;
const ONE_AVT_IN_ATTO = 1_000_000_000_000_000_000n;
const MAXIMUM_MINT_AMOUNT = 14_625n * ONE_AVT_IN_ATTO;
const ZERO_ADDRESS = { address: ethers.getAddress('0x0000000000000000000000000000000000000000') };

const PROOF_TYPES = {
  addAuthor: {
    AddAuthor: [
      { name: 't1PubKey', type: 'bytes' },
      { name: 't2PubKey', type: 'bytes32' },
      { name: 'expiry', type: 'uint256' },
      { name: 't2TxId', type: 'uint32' }
    ]
  },
  burnFees: {
    BurnFees: [
      { name: 'amount', type: 'uint128' },
      { name: 'expiry', type: 'uint256' },
      { name: 't2TxId', type: 'uint32' }
    ]
  },
  claimLower: {
    LowerData: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'lowerId', type: 'uint32' },
      { name: 't2Sender', type: 'bytes32' },
      { name: 't2Timestamp', type: 'uint64' }
    ]
  },
  mintRewards: {
    MintRewards: [
      { name: 'amount', type: 'uint128' },
      { name: 'expiry', type: 'uint256' },
      { name: 't2TxId', type: 'uint32' }
    ]
  },
  permit: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  },
  publishRoot: {
    PublishRoot: [
      { name: 'rootHash', type: 'bytes32' },
      { name: 'expiry', type: 'uint256' },
      { name: 't2TxId', type: 'uint32' }
    ]
  },
  removeAuthor: {
    RemoveAuthor: [
      { name: 't2PubKey', type: 'bytes32' },
      { name: 't1PubKey', type: 'bytes' },
      { name: 'expiry', type: 'uint256' },
      { name: 't2TxId', type: 'uint32' }
    ]
  }
};

let additionalTx = [];
let accounts = [];
let authors = [];
let owner;
let lowerId = 0;

function createMerkleTree(dataLeaves) {
  const leavesIn = Array.isArray(dataLeaves) ? dataLeaves.slice() : [dataLeaves];
  const leafData = leavesIn[0];
  const hashedLeaves = leavesIn.map((leaf, idx) => (idx === 0 ? keccak256(leaf) : Buffer.from(strip_0x(leaf), 'hex')));

  const tree = new MerkleTree(hashedLeaves, keccak256, { hashLeaves: false, sortPairs: true });

  return {
    leafData,
    leafHash: `0x${tree.leaves[0].toString('hex')}`,
    merklePath: tree.getHexProof(tree.leaves[0]),
    rootHash: tree.getHexRoot(),
    leaves: tree.getLeaves(),
    getMerklePath: (leaf, id) => tree.getHexProof(leaf, id)
  };
}

async function createLowerProof(bridge, token, amount, recipient, t2Sender, t2Timestamp = Math.floor(Date.now() / 1000)) {
  const confirmationsRequired = await getNumRequiredConfirmations(bridge);
  const domain = await getDomain(bridge);

  const args = [token.address, amount, recipient.address, ++lowerId, t2Sender, t2Timestamp];
  const message = toEIP712Message.claimLower(args);

  const confirmations = [];
  for (let i = 1; i <= confirmationsRequired; i++) {
    const confirmation = await authors[i].account.signTypedData(domain, PROOF_TYPES.claimLower, message);
    confirmations.push(ethers.getBytes(confirmation));
  }

  const confirmationsBytes = ethers.concat(confirmations);
  const lowerDataBytes = ethers.concat([
    ethers.getBytes(token.address),
    ethers.toBeHex(amount, 32),
    ethers.getBytes(recipient.address),
    ethers.toBeHex(lowerId, 4),
    ethers.getBytes(t2Sender),
    ethers.toBeHex(t2Timestamp, 8)
  ]);

  const lowerProof = ethers.concat([lowerDataBytes, confirmationsBytes]);
  return [lowerProof, lowerId];
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
  const confirmations = await getConfirmations(bridge, 'publishRoot', [merkleTree.rootHash, expiry, t2TxId]);

  await bridge.connect(authors[0].account).publishRoot(merkleTree.rootHash, expiry, t2TxId, confirmations);
  return merkleTree;
}

async function deployAuthority(avt) {
  const Authority = await ethers.getContractFactory('AVTAuthority');
  const authority = await Authority.deploy(avt.address);
  authority.address = await authority.getAddress();
  return authority;
}

async function deployAVT(supply) {
  const Token = await ethers.getContractFactory('MockAVT');
  const token = await Token.deploy(AVT_SYMBOL_BYTES_32);
  await token.mint(supply * 10n ** 18n);
  token.address = await token.getAddress();
  return token;
}

async function deployBridge(avt, numAuthors) {
  const initArgs = generateInitArgs(numAuthors);
  const AVNBridge = await ethers.getContractFactory('AVNBridge');
  return upgrades.deployProxy(AVNBridge, initArgs, { constructorArgs: [avt.address], kind: 'uups' });
}

async function deployERC20(supply) {
  const Token = await ethers.getContractFactory('Token20');
  const token = await Token.deploy(supply);
  token.address = await token.getAddress();
  return token;
}

async function deployERC777(supply) {
  const Token = await ethers.getContractFactory('Token777');
  const token = await Token.deploy(supply);
  token.address = await token.getAddress();
  return token;
}

function generateInitArgs(numAuthors) {
  const initArgs = [[], [], [], []];
  for (let i = 0; i < numAuthors; i++) {
    initArgs[0].push(authors[i].t1Address);
    initArgs[1].push(authors[i].t1PubKeyLHS);
    initArgs[2].push(authors[i].t1PubKeyRHS);
    initArgs[3].push(authors[i].t2PubKey);
  }
  return initArgs;
}

async function getConfirmations(bridge, method, args, adjustment = 0, startPos = 2) {
  const numConfirmations = Number(await getNumRequiredConfirmations(bridge)) + adjustment;
  const message = toEIP712Message[method](args);
  const domain = await getDomain(bridge);

  let concatenatedConfirmations = '0x';
  for (let i = startPos; i <= numConfirmations; i++) {
    const confirmation = await authors[i].account.signTypedData(domain, PROOF_TYPES[method], message);
    concatenatedConfirmations += strip_0x(confirmation);
  }
  return concatenatedConfirmations;
}

async function getCurrentBlockTimestamp() {
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  return block.timestamp;
}

async function getDomain(contract) {
  return {
    name: await contract.name(),
    version: '1',
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: contract.address
  };
}

async function getNumRequiredConfirmations(bridge) {
  const numAuthors = Number(await bridge.numActiveAuthors());
  return numAuthors - Math.floor((numAuthors * 2) / 3);
}

async function getSingleConfirmation(bridge, author, method, args) {
  const domain = await getDomain(bridge);
  const message = toEIP712Message[method](args);
  return author.account.signTypedData(domain, PROOF_TYPES[method], message);
}

function getTxLeafMetadata() {
  return (
    '0x1505840050368dd692d19f39657a574ff9b9cc0c584219826ab1141d101f43a19a7f3122010edfa77444027c551df2f3' +
    strip_0x(randomBytes32()) +
    'a6e6eaeff13956b192c9899a9993c16faea458458e35023800'
  );
}

async function getValidExpiry() {
  return (await getCurrentBlockTimestamp()) + EXPIRY_WINDOW;
}

async function increaseBlockTimestamp(seconds) {
  const currentBlockTimestamp = await getCurrentBlockTimestamp();
  await time.increaseTo(currentBlockTimestamp + seconds);
}

async function init(largeTree) {
  // printErrorCodes();
  const [funder] = await ethers.getSigners();
  [owner] = await ethers.getSigners();

  accounts = [owner];

  for (let i = 0; i < 20; i++) {
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    await funder.sendTransaction({ to: account.address, value: ethers.parseEther('1') });
    accounts.push(account);
  }

  for (let i = 0; i < 30; i++) {
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    await funder.sendTransaction({ to: account.address, value: ethers.parseEther('1') });
    authors.push(toAuthorAccount(account));
  }

  const randomTxHash = randomBytes32();
  if (largeTree === true) {
    const largeNumberOfTransactions = 4_194_305;
    additionalTx = new Array(largeNumberOfTransactions).fill(randomTxHash);
  } else {
    additionalTx = [randomTxHash];
  }
}

function printErrorCodes() {
  [
    'AddressIsZero()',
    'AddressMismatch()',
    'AlreadyAdded()',
    'AmountIsZero()',
    'AuthorsDisabled()',
    'BadConfirmations()',
    'CannotChangeT2Key(bytes32)',
    'InsufficientAvt()',
    'InvalidERC777()',
    'InvalidProof()',
    'InvalidRecipient()',
    'InvalidT1Key()',
    'InvalidT2Key()',
    'LegacyLower()',
    'LiftFailed()',
    'LiftDisabled()',
    'LiftLimitHit()',
    'Locked()',
    'LowerDisabled()',
    'LowerIsUsed()',
    'MissingKeys()',
    'NotAnAuthor()',
    'NotEnoughAuthors()',
    'PendingOwnerOnly()',
    'PermissionDenied()',
    'RootHashIsUsed()',
    'T1AddressInUse(address)',
    'T2KeyInUse(bytes32)',
    'TxIdIsUsed()',
    'WindowExpired()'
  ].forEach(error => console.log(`error ${error}; // ${ethers.keccak256(ethers.toUtf8Bytes(error)).slice(0, 10)}`));
}

function randomBytes32() {
  return randomHex(32);
}

function randomHex(length) {
  return ethers.hexlify(ethers.randomBytes(length));
}

function randomT2TxId() {
  return ethers.toBigInt(randomHex(4));
}

const strip_0x = bytes => (bytes.startsWith('0x') ? bytes.slice(2) : bytes);

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

const toEIP712Message = {
  addAuthor: args => ({ t1PubKey: args[0], t2PubKey: args[1], expiry: args[2], t2TxId: args[3] }),
  burnFees: args => ({ amount: args[0], expiry: args[1], t2TxId: args[2] }),
  claimLower: args => ({ token: args[0], amount: args[1], recipient: args[2], lowerId: args[3], t2Sender: args[4], t2Timestamp: args[5] }),
  mintRewards: args => ({ amount: args[0], expiry: args[1], t2TxId: args[2] }),
  publishRoot: args => ({ rootHash: args[0], expiry: args[1], t2TxId: args[2] }),
  removeAuthor: args => ({ t2PubKey: args[0], t1PubKey: args[1], expiry: args[2], t2TxId: args[3] })
};

function toLittleEndianBytesStr(amount) {
  let hexStr = ethers.toBeHex(amount).slice(2);
  hexStr = hexStr.length % 2 === 0 ? hexStr : `0${hexStr}`;
  const littleEndian = hexStr
    .match(/.{1,2}/g)
    .reverse()
    .join('');
  return littleEndian.padEnd(64, '0');
}

/* Keep exports alphabetical. */
module.exports = {
  AVT_SYMBOL_BYTES_32,
  createLowerProof,
  createTreeAndPublishRoot,
  deployAuthority,
  deployAVT,
  deployBridge,
  deployERC20,
  deployERC777,
  EMPTY_BYTES_32,
  expect,
  EXPIRY_WINDOW,
  generateInitArgs,
  getAccounts: () => accounts,
  getAuthors: () => authors,
  getConfirmations,
  getCurrentBlockTimestamp,
  getNumRequiredConfirmations,
  getSingleConfirmation,
  getValidExpiry,
  increaseBlockTimestamp,
  init,
  keccak256,
  MAXIMUM_MINT_AMOUNT,
  MIN_AUTHORS,
  ONE_AVT_IN_ATTO,
  randomBytes32,
  randomHex,
  randomT2TxId,
  strip_0x,
  ZERO_ADDRESS
};
