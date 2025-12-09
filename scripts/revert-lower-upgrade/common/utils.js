const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const VALID_CHAINS = ['dev', 'testnet', 'mainnet'];

const T2_PRIVATE_KEYS = { mainnet: 'MAINNET_T2_PRIVATE_KEY', dev: 'DEV_T2_PRIVATE_KEY', testnet: 'TESTNET_T2_PRIVATE_KEY' };

async function init(chain) {
  if (!VALID_CHAINS.includes(chain)) throw new Error(`Invalid chain "${chain}" (expected one of: ${VALID_CHAINS.join(', ')})`);

  const network = chain === 'mainnet' ? 'mainnet' : 'sepolia';
  const rpcEnv = chain === 'mainnet' ? 'MAINNET_RPC_URL' : 'SEPOLIA_RPC_URL';
  const t1PkEnv = chain === 'mainnet' ? 'MAINNET_T1_PRIVATE_KEY' : 'SEPOLIA_T1_PRIVATE_KEY';
  const t1RPC = requireEnv(rpcEnv);
  const t1PK = requireEnv(t1PkEnv);
  const provider = new ethers.JsonRpcProvider(t1RPC);
  const wallet = new ethers.Wallet(t1PK).connect(provider);
  const t2PkEnv = T2_PRIVATE_KEYS[chain];
  const t2PK = requireEnv(t2PkEnv);
  const t2Websocket = `wss://avn-parachain-internal.${chain}.aventus.io`;
  const api = await ApiPromise.create({ provider: new WsProvider(t2Websocket) });
  const t2Signer = getT2Signer(t2PK);
  const bridgeAddress = (await api.query.avn.avnBridgeContractAddress()).toString();
  const bridgeABI = ['function claimLower(bytes proof)', 'function lowerUsed(uint32 lowerId) view returns (bool)'];
  const bridge = new ethers.Contract(bridgeAddress, bridgeABI, wallet);
  bridge.address = bridgeAddress;
  bridge.lowerClaimedSig = ethers.id('LogLowerClaimed(uint32)');

  console.log(`\n======== Context ========`);
  console.log(`Chain      : ${chain}`);
  console.log(`T1 Network : ${network}`);
  console.log(`T1 RPC     : ${t1RPC}`);
  console.log(`T1 Signer  : ${wallet.address}`);
  console.log(`T1 Bridge  : ${bridgeAddress}`);
  console.log(`T2 WS      : ${t2Websocket}`);
  console.log(`T2 Signer  : ${t2Signer.address}`);
  console.log(`============================\n`);

  return {
    api,
    bridge,
    provider,
    t2Signer
  };
}

function getT2Signer(t2PK) {
  const kr = new Keyring({ type: 'sr25519' });
  if (t2PK.split(/\s+/).length >= 12) return kr.addFromMnemonic(t2PK);
  if (isHex(t2PK) && t2PK.length === 66) return kr.addFromSeed(hexToU8a(t2PK));
  return kr.addFromUri(t2PK);
}

function loadState(chain) {
  const filePath = path.join(__dirname, '..', 'data', `${chain}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`State file not found: ${filePath}`);
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { filePath, state };
}

function saveState(chain, state) {
  const filePath = path.join(__dirname, '..', 'data', `${chain}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  console.log(`\n✅ State saved to ${filePath}`);
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var ${name}`);
  return v.trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  init,
  loadState,
  saveState,
  sleep
};
