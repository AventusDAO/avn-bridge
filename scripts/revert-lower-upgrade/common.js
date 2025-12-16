const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { DEV_T1_PRIVATE_KEY, DEV_T2_PRIVATE_KEY, MAINNET_RPC_URL, MAINNET_T2_PRIVATE_KEY, SEPOLIA_RPC_URL } = process.env;

const CHAIN_CONFIG = {
  dev: {
    t1Network: 'sepolia',
    t1Rpc: SEPOLIA_RPC_URL,
    t1PrivateKey: DEV_T1_PRIVATE_KEY,
    t2Websocket: 'wss://avn-parachain-internal.dev.aventus.io',
    t2PrivateKey: DEV_T2_PRIVATE_KEY
  },
  mainnet: {
    t1Network: 'mainnet',
    t1Rpc: MAINNET_RPC_URL,
    t1PrivateKey: null,
    t2Websocket: 'wss://avn-parachain-internal.mainnet.aventus.io',
    t2PrivateKey: MAINNET_T2_PRIVATE_KEY
  }
};

async function init(chain) {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) throw new Error(`Invalid chain "${chain}". Expected one of: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
  const { t1Network, t1Rpc, t1PrivateKey, t2Websocket, t2PrivateKey } = cfg;

  const t1Provider = new ethers.JsonRpcProvider(t1Rpc);
  const t1Wallet = t1PrivateKey ? new ethers.Wallet(t1PrivateKey).connect(t1Provider) : null;

  const t2Api = await ApiPromise.create({ provider: new WsProvider(t2Websocket) });
  const t2Signer = getT2Signer(t2PrivateKey);

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
  console.log(`T2 Signer  : ${t2Signer.address}`);
  console.log(`============================\n`);

  return {
    t2Api,
    bridge,
    t1Provider,
    t2Signer
  };
}

function getT2Signer(t2PrivateKey) {
  const kr = new Keyring({ type: 'sr25519' });
  if (t2PrivateKey.split(/\s+/).length >= 12) return kr.addFromMnemonic(t2PrivateKey);
  if (isHex(t2PrivateKey) && t2PrivateKey.length === 66) return kr.addFromSeed(hexToU8a(t2PrivateKey));
  return kr.addFromUri(t2PrivateKey);
}

function loadState(chain) {
  const filePath = path.join(__dirname, 'data', `${chain}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`State file not found: ${filePath}`);
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { filePath, state };
}

function saveState(chain, state) {
  const filePath = path.join(__dirname, 'data', `${chain}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  console.log(`\n✅ State saved to ${filePath}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  init,
  loadState,
  saveState,
  sleep
};
