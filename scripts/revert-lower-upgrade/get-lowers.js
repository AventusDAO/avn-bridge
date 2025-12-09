const { init, sleep, saveState } = require('./common/utils');

const [CHAIN] = process.argv.slice(2);
const CHUNK = 50_000;

function accumulateBitmap(lowerIds) {
  const map = new Map();

  for (const id of lowerIds) {
    const bucket = id >>> 8;
    const bit = id & 0xff;
    map.set(bucket, (map.get(bucket) ?? 0n) | (1n << BigInt(bit)));
  }

  const buckets = [...map.keys()].sort((a, b) => a - b);
  const words = buckets.map(b => map.get(b));
  return { buckets, words };
}

async function* blockRanges(provider, from, to) {
  let latest = to ?? (await provider.getBlockNumber());
  let start = from;

  while (start <= latest) {
    const end = Math.min(start + CHUNK - 1, latest);
    yield [start, end];
    start = end + 1;
  }
}

async function findDeploymentBlock(provider, address) {
  let lo = 0;
  let hi = await provider.getBlockNumber();
  let found = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const code = await provider.getCode(address, mid);
    if (code && code !== '0x') {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

function parseLowerIdFromTopic(topicHex) {
  return Number.parseInt(topicHex.slice(-8), 16);
}

async function main() {
  const { api, provider, bridge } = await init(CHAIN);

  try {
    const deployBlock = await findDeploymentBlock(provider, bridge.address);
    if (!deployBlock) throw new Error('Bridge deployment block not found');

    const t2LowerNonce = (await api.query.tokenManager.lowerNonce()).toNumber();
    console.log(`T1 bridge deployment block      : ${deployBlock}`);
    console.log(`T2 Lower ID threshold           : ${t2LowerNonce}`);
    const entries = await api.query.tokenManager.lowersReadyToClaim.entries();
    const ready = new Set(entries.map(([k]) => k.args[0].toNumber()));
    console.log(`Proofs in T2 lowersReadyToClaim : ${ready.size}`);

    const claimed = [];
    const txHashById = new Map();

    for await (const [from, to] of blockRanges(provider, deployBlock)) {
      const logs = await provider.getLogs({
        address: bridge.address,
        topics: [bridge.lowerClaimedSig],
        fromBlock: from,
        toBlock: to
      });

      for (const log of logs) {
        const id = parseLowerIdFromTopic(log.topics[1]);
        claimed.push(id);
        if (!txHashById.has(id)) {
          txHashById.set(id, log.transactionHash);
        }
      }

      await sleep(30);
    }

    const claimedSet = new Set(claimed);
    console.log(`Lowers already claimed on T1    : ${claimedSet.size}`);

    const toRemove = [];
    const toRegen = [];

    for (const id of ready) {
      if (id >= t2LowerNonce) continue;
      if (claimedSet.has(id)) {
        toRemove.push({ lowerId: id, txHash: txHashById.get(id) ?? null });
      } else {
        toRegen.push(id);
      }
    }

    console.log(`Lowers to remove from T2        : ${toRemove.length}`);
    console.log(`Lowers to regenerate on T2      : ${toRegen.length}`);

    const { buckets, words } = accumulateBitmap([...claimedSet]);

    const state = {
      migrateArgs: {
        buckets,
        words: `[${words.map(w => w.toString(10)).join(',')}]`
      },
      claimed: [...claimedSet].sort((a, b) => a - b),
      toRemoveFromT2: toRemove.sort((a, b) => a.lowerId - b.lowerId),
      toRegenerateOnT2: toRegen.sort((a, b) => a - b)
    };

    saveState(CHAIN, state);
  } finally {
    await api.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
