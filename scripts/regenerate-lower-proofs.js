const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const T2_PRIVATE_KEY = process.env.T2_PRIVATE_KEY;
const WS_ENDPOINT = 'wss://avn-parachain-internal.dev.aventus.io';
const filePath = path.join(__dirname, `${process.argv[2]}_unclaimed.txt`);

const BATCH_SIZE = 10;
const DELAY_SECS = 30;

if (!T2_PRIVATE_KEY || !T2_PRIVATE_KEY.trim()) {
  console.error('T2_PRIVATE_KEY env var required');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendBatchRegenerate(api, signer, lowerIds) {
  return new Promise(async (resolve, reject) => {
    try {
      const calls = lowerIds.map(id => api.tx.tokenManager.regenerateLowerProof(id));
      const batch = api.tx.utility.batch(calls);

      const unsub = await batch.signAndSend(signer, ({ status, dispatchError, events }) => {
        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            const { section, name, docs } = decoded;
            console.error(`❌ Batch extrinsic failed: ${section}.${name} - ${docs.join(' ')}`);
          } else {
            console.error(`❌ Batch extrinsic failed: ${dispatchError.toString()}`);
          }
          unsub();
          reject(dispatchError);
          return;
        }

        if (status.isInBlock) {
          console.log(`Batch included in block ${status.asInBlock.toHex()} for lowerIds=[${lowerIds.join(', ')}]`);
        } else if (status.isFinalized) {
          console.log(`✅ Batch finalized in block ${status.asFinalized.toHex()} for lowerIds=[${lowerIds.join(', ')}]`);

          if (events && events.length) {
            events.forEach(({ event }) => {
              const { section, method, data } = event;
              if (section === 'utility' && method === 'BatchInterrupted') {
                const idx = data[0].toNumber();
                const err = data[1];
                let msg = err.toString();
                if (err.isModule) {
                  const decoded = api.registry.findMetaError(err.asModule);
                  const { section, name, docs } = decoded;
                  msg = `${section}.${name} - ${docs.join(' ')}`;
                }
                console.error(`❌ BatchInterrupted at index ${idx} (lowerId=${lowerIds[idx]}): ${msg}`);
              } else if (section === 'utility' && method === 'BatchCompleted') {
                console.log('utility.BatchCompleted');
              }
            });
          }

          unsub();
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function main() {
  console.log(`Connecting to ${WS_ENDPOINT} ...`);
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

  const raw = fs.readFileSync(filePath, 'utf8');
  const lowerIds = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const n = Number(line);
      if (Number.isNaN(n)) {
        throw new Error(`Invalid lowerId in file: "${line}"`);
      }
      return n;
    });

  console.log(`Loaded ${lowerIds.length} lower IDs from ${path.basename(filePath)}`);
  console.log(`Processing in batches of ${BATCH_SIZE}, with ${DELAY_SECS} seconds delay between batches`);

  let processed = 0;

  while (processed < lowerIds.length) {
    const batchIds = lowerIds.slice(processed, processed + BATCH_SIZE);
    console.log(`\nStarting batch: ${processed} → ${processed + batchIds.length - 1} [${batchIds.join(', ')}]`);

    try {
      await sendBatchRegenerate(api, signer, batchIds);
    } catch (err) {
      console.error(`❌ Error sending batch starting at index ${processed}:`, err.toString());
    }

    processed += batchIds.length;

    if (processed < lowerIds.length) {
      console.log(`Batch complete (${processed}/${lowerIds.length}). Waiting ${DELAY_SECS} seconds before next batch...`);
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
