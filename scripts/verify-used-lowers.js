const { ApiPromise, WsProvider } = require('@polkadot/api');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const [CHAIN] = process.argv.slice(2);

if (!['dev', 'testnet', 'mainnet'].includes(CHAIN)) {
  console.error(`Invalid chain: "${CHAIN}"`);
  process.exit(1);
}

async function main() {
  let ETH_RPC;
  let WS_ENDPOINT;
  let NETWORK;

  if (CHAIN === 'mainnet') {
    ETH_RPC = process.env.MAINNET_RPC_URL;
    WS_ENDPOINT = 'wss://avn-parachain-internal.mainnet.aventus.io';
    NETWORK = 'mainnet';
  } else {
    ETH_RPC = process.env.SEPOLIA_RPC_URL;
    WS_ENDPOINT = `wss://avn-parachain-internal.${CHAIN}.aventus.io`;
    NETWORK = 'sepolia';
  }

  if (!ETH_RPC) {
    console.error(`Missing ETH RPC URL env var for CHAIN=${CHAIN}`);
    process.exit(1);
  }

  const ABI = ['function lowerUsed(uint32 lowerId) view returns (bool)'];
  const provider = new ethers.JsonRpcProvider(ETH_RPC);

  const wsProvider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider: wsProvider });
  const bridgeAddress = (await api.query.avn.avnBridgeContractAddress()).toString();
  const contract = new ethers.Contract(bridgeAddress, ABI, provider);
  const filePath = path.join(__dirname, 'data', `${CHAIN}.json`);

  if (!fs.existsSync(filePath)) {
    console.error(`State file not found: ${filePath}`);
    await api.disconnect();
    process.exit(1);
  }

  console.log(`T1 Network: ${NETWORK}`);
  console.log(`Bridge: ${bridgeAddress}`);
  console.log(`T2 Chain: "${CHAIN}"`);
  console.log(`T2 endpoint: ${WS_ENDPOINT}`);
  console.log(`Using state file: ${path.basename(filePath)}`);

  let lowers;
  try {
    lowers = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse JSON from ${filePath}:`, e);
    await api.disconnect();
    process.exit(1);
  }

  const claimedLowerIDs = (lowers.claimed || []).map(n => Number(n)).filter(n => !Number.isNaN(n));

  console.log(`\nLoaded ${claimedLowerIDs.length} claimed lowerId(s) from ${filePath}`);

  const bad = [];
  const CONCURRENCY = 25;

  async function worker(ids) {
    for (const id of ids) {
      try {
        const used = await contract.lowerUsed(id);
        if (!used) bad.push(id);
      } catch (e) {
        console.error(`Error checking lowerId ${id}: ${e.message}`);
        bad.push(id);
      }
    }
  }

  const chunkSize = Math.ceil(claimedLowerIDs.length / CONCURRENCY) || 1;
  const chunks = [];
  for (let i = 0; i < claimedLowerIDs.length; i += chunkSize) {
    chunks.push(claimedLowerIDs.slice(i, i + chunkSize));
  }

  await Promise.all(chunks.map(worker));

  if (bad.length === 0) {
    console.log('\n✅ Verification passed: all IDs return lowerUsed == true.');
  } else {
    console.log(`\n❌ ${bad.length} ID(s) were NOT marked used:`);
    console.log(
      JSON.stringify(
        bad.sort((a, b) => a - b),
        null,
        2
      )
    );
    process.exitCode = 1;
  }

  await api.disconnect();
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
