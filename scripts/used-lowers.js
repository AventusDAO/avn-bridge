const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { MAINNET_RPC_URL, SEPOLIA_RPC_URL } = process.env;
const RPCS = { mainnet: MAINNET_RPC_URL, sepolia: SEPOLIA_RPC_URL };
const LOWER_CLAIMED_SIG = ethers.id('LogLowerClaimed(uint32)');
const CHUNK = 50_000;
const [NETWORK, CONTRACT, FROM_BLOCK_ARG, V2_THRESH_ARG] = process.argv.slice(2);
const FROM_BLOCK = Number(FROM_BLOCK_ARG);
const V2_THRESH = Number(V2_THRESH_ARG);

const provider = new ethers.JsonRpcProvider(RPCS[NETWORK]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const parseLowerIdFromTopic = topicHex => Number.parseInt(topicHex.slice(-8), 16);

function accumulateBitmap(lowerIds) {
  const map = new Map();
  for (const id of lowerIds) {
    const bucket = id >>> 8;
    const bitIdx = id & 0xff;
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
  const TO_BLOCK = await provider.getBlockNumber();
  console.log(`\nNetwork: ${NETWORK}`);
  console.log(`Bridge: ${CONTRACT}`);
  console.log(`v2Thresh: ${V2_THRESH}`);
  console.log(`\nScanning blocks ${FROM_BLOCK} -> ${TO_BLOCK} (chunk=${CHUNK})`);

  const filterBase = { address: CONTRACT, topics: [LOWER_CLAIMED_SIG] };
  const ids = [];

  for await (const [from, to] of ranges(FROM_BLOCK, TO_BLOCK)) {
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
      if (log.topics.length >= 2) ids.push(parseLowerIdFromTopic(log.topics[1]));
    }
    await sleep(30);
  }

  const lowerIds = Array.from(new Set(ids)).sort((a, b) => a - b);
  console.log(`\nFound ${lowerIds.length} claimed lower IDs.`);

  if (lowerIds.length > 0) {
    console.log('\n--- Claimed Lower IDs ---');
    console.log(JSON.stringify(lowerIds, null, 2));
  } else {
    console.log('No claimed lower IDs found.');
  }

  const { buckets, words } = accumulateBitmap(lowerIds);

  console.log('\n--- Buckets (uint256[]) ---');
  console.log(JSON.stringify(buckets, null, 2));
  console.log('\n--- Words (uint256[]) ---');
  console.log(
    JSON.stringify(
      words.map(w => w.toString(10)),
      null,
      2
    )
  );

  const claimedSet = new Set(lowerIds);
  const unclaimed = [];
  for (let i = 0; i < V2_THRESH; i++) {
    if (!claimedSet.has(i)) unclaimed.push(i);
  }

  console.log(`\nFound ${unclaimed.length} unclaimed lower IDs in [0, ${V2_THRESH}).`);
  console.log('\n--- Unclaimed Lower IDs ---');
  console.log(JSON.stringify(unclaimed, null, 2));

  const filename = path.join(__dirname, `${CONTRACT.toLowerCase()}.txt`);
  fs.writeFileSync(filename, lowerIds.join('\n') + (lowerIds.length ? '\n' : ''));
  console.log(`\n${lowerIds.length} claimed lower IDs written to ./${path.basename(filename)}`);

  console.log('\nDone.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
