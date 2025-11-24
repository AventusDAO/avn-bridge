const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const [ENVIRONMENT] = process.argv.slice(2);
const WS_ENDPOINT = `wss://avn-parachain-internal.${ENVIRONMENT}.aventus.io`;
const T2_PRIVATE_KEY = ENVIRONMENT === 'dev' ? process.env.T2_PRIVATE_KEY_DEV : process.env.T2_PRIVATE_KEY_TESTNET;

const DELAY_SECS = 30;
const BATCH_SIZE = 10;
const QUEUE_LIMIT = 100;

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
  if (!ENVIRONMENT) {
    console.error('Usage: node regenerateLowers.js <dev|testnet>');
    process.exit(1);
  }
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

  const FROM = signer.address;
  console.log(`Using account: ${FROM}`);

  const bridgeAddressRaw = await api.query.avn.avnBridgeContractAddress();
  const bridgeAddress = bridgeAddressRaw.toString();
  console.log(`Bridge address: ${bridgeAddress}`);

  const filePath = path.join(__dirname, `${bridgeAddress}_unclaimed.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`State file not found: ${filePath}`);
    await api.disconnect();
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse JSON from ${filePath}:`, e);
    await api.disconnect();
    process.exit(1);
  }

  if (!Array.isArray(state.unclaimed)) {
    console.error(`State file missing "unclaimed" array`);
    await api.disconnect();
    process.exit(1);
  }
  if (!Array.isArray(state.regenerated)) {
    console.warn(`State file missing "regenerated" array, initialising empty []`);
    state.regenerated = [];
  }

  const allUnclaimed = state.unclaimed.map(n => Number(n)).filter(n => !Number.isNaN(n));
  const regeneratedSet = new Set(state.regenerated.map(n => Number(n)).filter(n => !Number.isNaN(n)));

  const pending = allUnclaimed.filter(id => !regeneratedSet.has(id));

  console.log(`Total unclaimed IDs: ${allUnclaimed.length}`);
  console.log(`Already regenerated: ${regeneratedSet.size}`);
  console.log(`Pending to regenerate: ${pending.length}`);

  if (pending.length === 0) {
    console.log('Nothing to do. All unclaimed IDs are already regenerated.');
    await api.disconnect();
    return;
  }

  function saveState() {
    state.regenerated = Array.from(regeneratedSet).sort((a, b) => a - b);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    console.log(`  → State saved. regenerated=${state.regenerated.length}, ` + `still pending=${allUnclaimed.length - state.regenerated.length}`);
  }

  let index = 0;

  while (index < pending.length) {
    const remaining = pending.length - index;
    const batchSize = Math.min(BATCH_SIZE, remaining);

    while (true) {
      const queue = await api.query.ethBridge.requestQueue();
      const queueLen = queue.length;

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
