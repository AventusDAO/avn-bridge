const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DELAY_SECS = 30;
const BATCH_SIZE = 10;
const QUEUE_LIMIT = 100;

const [CHAIN] = process.argv.slice(2);

if (!CHAIN) {
  console.error('Missing chain arg (e.g.: "dev", "testnet", "mainnet")');
  process.exit(1);
}

const WS_ENDPOINT = CHAIN === 'mainnet' ? 'wss://avn-parachain-internal.mainnet.aventus.io' : `wss://avn-parachain-internal.${CHAIN}.aventus.io`;
const T2_PRIVATE_KEY = process.env[`T2_PRIVATE_KEY_${CHAIN.toUpperCase()}`];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendRegenerateLower(api, signer, lowerId) {
  return new Promise(async (resolve, reject) => {
    try {
      const tx = api.tx.tokenManager.regenerateLowerProof(lowerId);

      console.log(`  → Submitting regenerateLowerProof for lowerId=${lowerId}`);
      const unsub = await tx.signAndSend(signer, ({ status, dispatchError, events }) => {
        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            const { section, name, docs } = decoded;
            console.error(`❌ Failed lowerId=${lowerId}: ${section}.${name} - ${docs.join(' ')}`);
          } else {
            console.error(`❌ Failed lowerId=${lowerId}: ${dispatchError.toString()}`);
          }
          unsub();
          reject(dispatchError);
          return;
        }

        if (events && events.length) {
          events.forEach(({ event }) => {
            const { section, method, data } = event;
            if (section === 'tokenManager') {
              console.log(`    Event: tokenManager.${method} ${data.toString()} (lowerId=${lowerId})`);
            }
          });
        }

        if (status.isInBlock) {
          console.log(`  Included in block ${status.asInBlock.toHex()} lowerId=${lowerId}`);
        } else if (status.isFinalized) {
          console.log(`✅ Finalized lowerId=${lowerId}`);
          unsub();
          resolve(true);
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

  const pending = allToRegenerate.filter(id => !regeneratedSet.has(id));

  console.log(`Total toRegenerateOnT2 IDs: ${allToRegenerate.length}`);
  console.log(`Already regenerated: ${regeneratedSet.size}`);
  console.log(`Pending to regenerate: ${pending.length}`);

  if (pending.length === 0) {
    console.log('Nothing to do. All toRegenerateOnT2 IDs are already regenerated.');
    await api.disconnect();
    return;
  }

  function saveState() {
    lowers.regenerated = Array.from(regeneratedSet).sort((a, b) => a - b);
    fs.writeFileSync(filePath, JSON.stringify(lowers, null, 2));
    console.log(`  → State saved. regenerated=${lowers.regenerated.length}, ` + `still pending=${allToRegenerate.length - lowers.regenerated.length}`);
  }

  let index = 0;

  while (index < pending.length) {
    const remaining = pending.length - index;
    const batchSize = Math.min(BATCH_SIZE, remaining);

    while (true) {
      const queue = await api.query.ethBridge.requestQueue();
      const queueLen = queue.toJSON().length;

      console.log(`\nCurrent ethBridge.requestQueue length=${queueLen}, ` + `next batchSize=${batchSize}, QUEUE_LIMIT=${QUEUE_LIMIT}`);

      if (queueLen + batchSize < QUEUE_LIMIT) {
        console.log('Queue has capacity for next batch, proceeding...');
        break;
      }

      console.log(`Queue too full (would be ${queueLen + batchSize} ≥ ${QUEUE_LIMIT}), ` + `waiting ${DELAY_SECS}s before re-check...`);
      await sleep(DELAY_SECS * 1000);
    }

    const batchIds = pending.slice(index, index + batchSize);
    console.log(`\n=== Sending batch [${index + 1}..${index + batchSize}] of ${pending.length}`);
    console.log(`Batch lowerIds: ${batchIds.join(', ')}`);

    for (const lowerId of batchIds) {
      console.log(`\nProcessing lowerId=${lowerId}`);
      try {
        const ok = await sendRegenerateLower(api, signer, lowerId);
        if (ok) {
          regeneratedSet.add(lowerId);
          console.log(`Completed lowerId=${lowerId}`);
        }
      } catch (err) {
        console.error(`❌ Error lowerId=${lowerId}: ${err.toString()}`);
      }
    }

    saveState();

    index += batchSize;

    if (index < pending.length) {
      console.log(`\nBatch complete. ${pending.length - index} still pending. ` + `Waiting ${DELAY_SECS} seconds before next batch...`);
      await sleep(DELAY_SECS * 1000);
    }
  }

  await api.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
