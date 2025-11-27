const { ApiPromise, WsProvider } = require('@polkadot/api');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LOWER_CLAIMED_SIG = ethers.id('LogLowerClaimed(uint32)');
const CHUNK = 50_000;

const [CHAIN] = process.argv.slice(2);

if (!CHAIN) {
  console.error('Missing chain arg (e.g.: "dev", "testnet", "mainnet")');
  process.exit(1);
}

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

const provider = new ethers.JsonRpcProvider(ETH_RPC);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const parseLowerIdFromTopic = topicHex => Number.parseInt(topicHex.slice(-8), 16);

async function findDeploymentBlock(provider, address) {
  const latest = await provider.getBlockNumber();
  let low = 0;
  let high = latest;
  let deployment = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const code = await provider.getCode(address, mid);

    if (code && code !== '0x') {
      deployment = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return deployment;
}

function accumulateBitmap(lowerIDs) {
  const map = new Map();
  for (const id of lowerIDs) {
    const bucket = id >>> 8; // id / 256
    const bitIdx = id & 0xff; // id % 256
    const cur = map.get(bucket) ?? 0n;
    map.set(bucket, cur | (1n << BigInt(bitIdx)));
  }
  const buckets = Array.from(map.keys()).sort((a, b) => a - b);
  const words = buckets.map(b => map.get(b));
  return { buckets, words };
}

async function* ranges(from, to) {
  let latest = typeof to === 'number' ? to : await provider.getBlockNumber();
  let start = from;
  while (start <= latest) {
    const end = Math.min(start + CHUNK - 1, latest);
    yield [start, end];
    start = end + 1;
    if (to === 'latest') latest = await provider.getBlockNumber();
  }
}

(async () => {
  const wsProvider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider: wsProvider });

  const bridgeAddress = (await api.query.avn.avnBridgeContractAddress()).toString();
  const v2Threshold = (await api.query.tokenManager.lowerNonce()).toNumber();

  const deployBlock = await findDeploymentBlock(provider, bridgeAddress);
  if (deployBlock == null) {
    console.error('Could not determine deployment block for bridge contract');
    await api.disconnect();
    process.exit(1);
  }

  console.log(`\nT1 Network: ${NETWORK}`);
  console.log(`Bridge: ${bridgeAddress}`);
  console.log(`T2 Chain: "${CHAIN}"`);
  console.log(`T2 endpoint: ${WS_ENDPOINT}`);
  console.log(`V2 Threshold Lower ID: ${v2Threshold}`);

  console.log('\nFetching tokenManager.lowersReadyToClaim from T2...');
  const entries = await api.query.tokenManager.lowersReadyToClaim.entries();

  const readyIds = [];
  for (const [key] of entries) {
    readyIds.push(key.args[0].toNumber());
  }

  readyIds.sort((a, b) => a - b);
  const readyIdsSet = new Set(readyIds);
  const toBlock = await provider.getBlockNumber();
  console.log(`Scanning T1 blocks ${deployBlock} -> ${toBlock}...`);

  const filterBase = { address: bridgeAddress, topics: [LOWER_CLAIMED_SIG] };
  const ids = [];
  const txHashByLowerId = new Map();

  for await (const [from, to] of ranges(deployBlock, toBlock)) {
    let logs = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        logs = await provider.getLogs({ ...filterBase, fromBlock: from, toBlock: to });
        break;
      } catch (e) {
        const delay = 400 * attempt;
        console.warn(`getLogs retry ${attempt} in ${delay}ms for ${from}-${to}: ${e.message}`);
        await sleep(delay);
      }
    }

    for (const log of logs) {
      if (log.topics.length >= 2) {
        const lowerId = parseLowerIdFromTopic(log.topics[1]);
        ids.push(lowerId);
        if (!txHashByLowerId.has(lowerId)) {
          txHashByLowerId.set(lowerId, log.transactionHash);
        }
      }
    }

    await sleep(30);
  }

  const claimedLowerIDs = Array.from(new Set(ids)).sort((a, b) => a - b);
  const claimedSet = new Set(claimedLowerIDs);
  const toRemoveFromT2 = [];
  const toRegenerateOnT2 = [];

  for (const id of readyIdsSet) {
    if (id >= v2Threshold) continue;

    if (claimedSet.has(id)) {
      const txHash = txHashByLowerId.get(id) || null;
      toRemoveFromT2.push({ lowerId: id, txHash });
    } else {
      toRegenerateOnT2.push(id);
    }
  }

  toRemoveFromT2.sort((a, b) => a.lowerId - b.lowerId);
  toRegenerateOnT2.sort((a, b) => a - b);

  console.log(`\nFound ${readyIds.length} lowers in lowersReadyToClaim on T2.`);
  console.log(`Found ${claimedLowerIDs.length} claimed lower IDs on T1.`);
  console.log(`Found ${toRemoveFromT2.length} lower proofs to remove from T2.`);
  console.log(`${toRegenerateOnT2.length} proofs require regenerating on T2.`);

  let { buckets, words } = accumulateBitmap(claimedLowerIDs);
  const decWords = words.map(w => w.toString(10));

  console.log('\n--- Buckets (uint256[]) ---');
  console.log(JSON.stringify(buckets));
  console.log('\n--- Words (uint256[]) ---');
  console.log(JSON.stringify(decWords, null, 2));

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  const filePath = path.join(dataDir, `${CHAIN}.json`);
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        claimed: [...claimedSet],
        toRemoveFromT2,
        toRegenerateOnT2,
        setUsedLowersArgs: { buckets, words: decWords }
      },
      null,
      2
    )
  );

  console.log(`\nOutput written to ${filePath}`);
  console.log('Done.');

  await api.disconnect();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
