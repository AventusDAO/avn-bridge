const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DELAY_SECS = 30;
const BATCH_SIZE = 10;
const QUEUE_LIMIT = 100;

const [CHAIN] = process.argv.slice(2);

if (!['dev', 'testnet', 'mainnet'].includes(CHAIN)) {
  console.error(`Invalid chain: "${CHAIN}"`);
  process.exit(1);
}

const WS_ENDPOINT = CHAIN === 'mainnet' ? 'wss://avn-parachain-internal.mainnet.aventus.io' : `wss://avn-parachain-internal.${CHAIN}.aventus.io`;
const T2_PRIVATE_KEY = process.env[`T2_PRIVATE_KEY_${CHAIN.toUpperCase()}`];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendBatchRegenerateLower(api, signer, lowerIds) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!lowerIds.length) {
        resolve([]);
        return;
      }

      const calls = lowerIds.map(id => api.tx.tokenManager.regenerateLowerProof(id));
      const batchTx = api.tx.utility.batch(calls);

      console.log(`  → Submitting utility.batch for lowerIds=[${lowerIds.join(', ')}]`);

      let interruptedIndex = null;

      const unsub = await batchTx.signAndSend(signer, ({ status, dispatchError, events }) => {
        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            const { section, name, docs } = decoded;
            console.error(`❌ Batch dispatch error: ${section}.${name} - ${docs.join(' ')}`);
          } else {
            console.error(`❌ Batch dispatch error: ${dispatchError.toString()}`);
          }
          unsub();
          reject(dispatchError);
          return;
        }

        if (events && events.length) {
          events.forEach(({ event }) => {
            const { section, method, data } = event;

            if (section === 'utility' && method === 'BatchInterrupted') {
              const idx = data[0].toNumber ? data[0].toNumber() : Number(data[0]);
              interruptedIndex = idx;

              const err = data[1];
              let msg = err.toString();
              if (err.isModule) {
                const decoded = api.registry.findMetaError(err.asModule);
                const { section: sec, name, docs } = decoded;
                msg = `${sec}.${name} - ${docs.join(' ')}`;
              }
              console.warn(`⚠️ BatchInterrupted at call index ${idx}: ${msg} (lowerId=${lowerIds[idx]})`);
            }

            if (section === 'utility' && method === 'BatchCompleted') {
              console.log('  utility.BatchCompleted');
            }

            if (section === 'tokenManager') {
              console.log(`    Event: tokenManager.${method} ${data.toString()}`);
            }
          });
        }

        if (status.isInBlock) {
          console.log(`  Included in block ${status.asInBlock.toHex()}`);
        } else if (status.isFinalized) {
          let successIds;
          if (interruptedIndex === null) {
            successIds = [...lowerIds];
          } else if (interruptedIndex > 0) {
            successIds = lowerIds.slice(0, interruptedIndex);
          } else {
            successIds = [];
          }

          console.log(`✅ Batch finalized: ${successIds.length}/${lowerIds.length} lowers succeeded ` + `(successIds=[${successIds.join(', ')}])`);

          unsub();
          resolve(successIds);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function main() {
  if (!T2_PRIVATE_KEY || !T2_PRIVATE_KEY.trim()) {
    console.error('T2_PRIVATE_KEY env var required');
    process.exit(1);
  }

  console.log(`Connecting to ${WS_ENDPOINT}...`);
  const provider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider });
  console.log('API connected.');

  const keyring = new Keyring({ type: 'sr25519' });
  const trimmed = T2_PRIVATE_KEY.trim();
  let signer;

  if (trimmed.split(/\s+/).length >= 12) {
    signer = keyring.addFromMnemonic(trimmed);
  } else if (isHex(trimmed) && trimmed.length === 66) {
    signer = keyring.addFromSeed(hexToU8a(trimmed));
  } else {
    signer = keyring.addFromUri(trimmed);
  }

  console.log(`Using account: ${signer.address}`);

  const bridgeAddress = (await api.query.avn.avnBridgeContractAddress()).toString();
  console.log(`Bridge: ${bridgeAddress}`);

  const filePath = path.join(__dirname, 'data', `${CHAIN}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`State file not found: ${filePath}`);
    await api.disconnect();
    process.exit(1);
  }

  let lowers;
  try {
    lowers = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse JSON from ${filePath}:`, e);
    await api.disconnect();
    process.exit(1);
  }

  const allToRegenerate = (lowers.toRegenerateOnT2 || []).map(n => Number(n)).filter(n => !Number.isNaN(n));

  const regeneratedSet = new Set((lowers.regenerated || []).map(n => Number(n)).filter(n => !Number.isNaN(n)));

  let remaining = allToRegenerate.filter(id => !regeneratedSet.has(id));

  console.log(`Total toRegenerateOnT2 IDs: ${allToRegenerate.length}`);
  console.log(`Already regenerated: ${regeneratedSet.size}`);
  console.log(`Remaning to regenerate: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log('Nothing to do. All toRegenerateOnT2 IDs are already regenerated.');
    await api.disconnect();
    return;
  }

  function saveState() {
    lowers.regenerated = Array.from(regeneratedSet).sort((a, b) => a - b);
    lowers.toRegenerateOnT2 = remaining.slice().sort((a, b) => a - b);

    const filePath = path.join(__dirname, 'data', `${CHAIN}.json`);

    const setUsed = lowers.setUsedLowersArgs || {};
    const buckets = Array.isArray(setUsed.buckets) ? setUsed.buckets : [];
    const wordsStr = typeof setUsed.words === 'string' ? setUsed.words : '[]';

    const claimed = Array.isArray(lowers.claimed) ? lowers.claimed : [];
    const toRemoveFromT2 = Array.isArray(lowers.toRemoveFromT2) ? lowers.toRemoveFromT2 : [];
    const regenerated = Array.isArray(lowers.regenerated) ? lowers.regenerated : [];
    const toRegenerateOnT2 = Array.isArray(lowers.toRegenerateOnT2) ? lowers.toRegenerateOnT2 : [];

    const lines = [];

    lines.push('{');
    lines.push('  "setUsedLowersArgs": {');
    lines.push(`    "buckets": [${buckets.join(', ')}],`);
    lines.push(`    "words": ${JSON.stringify(wordsStr)}`);
    lines.push('  },');
    lines.push(`  "claimed": [${claimed.join(', ')}],`);
    lines.push(`  "toRemoveFromT2": ${JSON.stringify(toRemoveFromT2, null, 2)},`);
    lines.push(`  "toRegenerateOnT2": [${toRegenerateOnT2.join(', ')}],`);
    if (regenerated.length > 0) lines.push(`  "regenerated": [${regenerated.join(', ')}]`);
    lines.push('}');
    const out = lines.join('\n');
    fs.writeFileSync(filePath, out + '\n');
    console.log(`  → State saved. regenerated=${regenerated.length}, still remaining=${remaining.length}`);
  }

  while (remaining.length > 0) {
    const batchSize = Math.min(BATCH_SIZE, remaining.length);

    while (true) {
      const queue = await api.query.ethBridge.requestQueue();
      const queueJson = queue.toJSON() || [];
      const queueLen = Array.isArray(queueJson) ? queueJson.length : 0;

      console.log(`\nCurrent ethBridge.requestQueue length=${queueLen}, ` + `next batchSize=${batchSize}, QUEUE_LIMIT=${QUEUE_LIMIT}`);

      if (queueLen + batchSize < QUEUE_LIMIT) {
        console.log('Queue has capacity for next batch, proceeding...');
        break;
      }

      console.log(`Queue too full (would be ${queueLen + batchSize} ≥ ${QUEUE_LIMIT}), ` + `waiting ${DELAY_SECS}s before re-check...`);
      await sleep(DELAY_SECS * 1000);
    }

    const batchIds = remaining.slice(0, batchSize);
    console.log(`\n=== Sending batch of ${batchIds.length} (remaining total=${remaining.length}) ===`);
    console.log(`Batch lowerIds: ${batchIds.join(', ')}`);

    try {
      const successIds = await sendBatchRegenerateLower(api, signer, batchIds);

      for (const id of successIds) {
        regeneratedSet.add(id);
        console.log(`Completed lowerId=${id}`);
      }

      remaining = allToRegenerate.filter(id => !regeneratedSet.has(id));

      saveState();

      if (remaining.length > 0) {
        console.log(`\nBatch complete. ${remaining.length} still remaining. ` + `Waiting ${DELAY_SECS} seconds before next batch...`);
        await sleep(DELAY_SECS * 1000);
      }
    } catch (err) {
      console.error(`❌ Batch failed: ${err.toString()}`);
      break;
    }
  }

  await api.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
