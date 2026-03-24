const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { DEV_T1_PRIVATE_KEY, DEV_T2_PRIVATE_KEY, MAINNET_RPC_URL, MAINNET_T2_PRIVATE_KEY, SEPOLIA_RPC_URL } = process.env;

const CHUNK = 50_000;

const CHAIN_CONFIG = {
  dev: {
    t1Network: 'sepolia',
    t1Rpc: SEPOLIA_RPC_URL,
    t1PrivateKey: DEV_T1_PRIVATE_KEY,
    t2Websocket: 'wss://avn-parachain.dev.aventus.io',
    t2PrivateKey: DEV_T2_PRIVATE_KEY
  },
  testnet: {
    t1Network: 'sepolia',
    t1Rpc: SEPOLIA_RPC_URL,
    t1PrivateKey: DEV_T1_PRIVATE_KEY,
    t2Websocket: 'wss://avn-parachain.testnet.aventus.io',
    t2PrivateKey: null
  },
  mainnet: {
    t1Network: 'mainnet',
    t1Rpc: MAINNET_RPC_URL,
    t1PrivateKey: null,
    t2Websocket: 'wss://avn-parachain.mainnet.aventus.io',
    t2PrivateKey: null
  }
};

async function init(chain) {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) throw new Error(`Invalid chain "${chain}". Expected one of: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
  const { t1Network, t1Rpc, t1PrivateKey, t2Websocket, t2PrivateKey } = cfg;

  const t1Provider = new ethers.JsonRpcProvider(t1Rpc);
  const t1Wallet = t1PrivateKey ? new ethers.Wallet(t1PrivateKey).connect(t1Provider) : null;

  const t2Api = await ApiPromise.create({ provider: new WsProvider(t2Websocket) });
  const t2Signer = t2PrivateKey ? getT2Signer(t2PrivateKey) : null;

  const bridgeAddress = (await t2Api.query.ethBridge.instance()).toHuman().bridgeContract;
  const bridgeABI = ['function claimLower(bytes proof)', 'function isLowerUsed(uint32 lowerId) view returns (bool)'];

  const bridge = new ethers.Contract(bridgeAddress, bridgeABI, t1Wallet ?? t1Provider);
  bridge.address = bridgeAddress;
  bridge.lowerClaimedSig = ethers.id('LogLowerClaimed(uint32)');

  console.log(`\n======== Context ========`);
  console.log(`Chain      : ${chain}`);
  console.log(`T1 Network : ${t1Network}`);
  console.log(`T1 RPC     : ${t1Rpc}`);
  console.log(`T1 Signer  : ${t1Wallet ? t1Wallet.address : '(read-only provider)'}`);
  console.log(`T1 Bridge  : ${bridgeAddress}`);
  console.log(`T2 WS      : ${t2Websocket}`);
  console.log(`T2 Signer  : ${t2Signer ? t2Signer.address : '(read-only - no signer'}`);
  console.log(`============================\n`);

  return {
    t2Api,
    bridge,
    t1Provider,
    t2Signer
  };
}

function accumulateBitmap(ids) {
  const map = new Map();

  for (const id of ids) {
    const bucket = id >>> 8;
    const bit = id & 0xff;
    map.set(bucket, (map.get(bucket) ?? 0n) | (1n << BigInt(bit)));
  }

  const buckets = [...map.keys()].sort((a, b) => a - b);
  const words = buckets.map(b => map.get(b));
  return { buckets, words };
}

async function* blockRanges(t1Provider, from, to) {
  let latest = to ?? (await t1Provider.getBlockNumber());
  let start = from;

  while (start <= latest) {
    const end = Math.min(start + CHUNK - 1, latest);
    yield [start, end];
    start = end + 1;
  }
}

async function findDeploymentBlock(t1Provider, address) {
  let lo = 0;
  let hi = await t1Provider.getBlockNumber();
  let found = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const code = await t1Provider.getCode(address, mid);
    if (code && code !== '0x') {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

function getT2Signer(t2PrivateKey) {
  const kr = new Keyring({ type: 'sr25519' });
  if (t2PrivateKey.split(/\s+/).length >= 12) return kr.addFromMnemonic(t2PrivateKey);
  if (isHex(t2PrivateKey) && t2PrivateKey.length === 66) return kr.addFromSeed(hexToU8a(t2PrivateKey));
  return kr.addFromUri(t2PrivateKey);
}

function parseIdFromTopic(topicHex) {
  return Number.parseInt(topicHex.slice(-8), 16);
}

function loadState(filename) {
  const filePath = path.join(__dirname, 'data', `${filename}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`State file not found: ${filePath}`);
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { filePath, state };
}

function saveState(filename, state) {
  const filePath = path.join(__dirname, 'data', `${filename}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  console.log(`\n✅ State saved to ${filePath}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  accumulateBitmap,
  blockRanges,
  findDeploymentBlock,
  init,
  loadState,
  parseIdFromTopic,
  saveState,
  sleep
};
