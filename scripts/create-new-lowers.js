const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
require('dotenv').config();

const [ENVIRONMENT, MAX_LOWERS_ARG, BATCH_SIZE_ARG] = process.argv.slice(2);
const WS_ENDPOINT = `wss://avn-parachain-internal.${ENVIRONMENT}.aventus.io`;
const T2_PRIVATE_KEY = ENVIRONMENT === 'dev' ? process.env.T2_PRIVATE_KEY_DEV : process.env.T2_PRIVATE_KEY_TESTNET;
const T1_RECIPIENT = '0xde7e1091cde63c05aa4d82c62e4c54edbc701b22';

const TOKEN_START_AMOUNT = 1000;
const DELAY_SECS = 4;

const MAX_LOWERS = MAX_LOWERS_ARG ? Number(MAX_LOWERS_ARG) : Infinity;
if (Number.isNaN(MAX_LOWERS) || MAX_LOWERS <= 0) {
  console.error('❌ Invalid MAX_LOWERS argument.');
  process.exit(1);
}

const BATCH_SIZE = BATCH_SIZE_ARG ? Number(BATCH_SIZE_ARG) : 1;
if (Number.isNaN(BATCH_SIZE) || BATCH_SIZE <= 0) {
  console.error('❌ Invalid BATCH_SIZE argument.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendBatchDirectLower(api, signer, avtAddress, startAmount, count, from) {
  return new Promise(async (resolve, reject) => {
    try {
      const calls = [];
      for (let i = 0; i < count; i++) {
        const amount = startAmount + i;
        const call = api.tx.tokenManager.scheduleDirectLower(from, avtAddress, amount, T1_RECIPIENT);
        calls.push(call);
      }

      const batchTx = api.tx.utility.batch(calls);

      let successCount = 0;
      const lowerIdsSet = new Set();
      let processedEvents = false;

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

        if (!processedEvents && events && events.length) {
          processedEvents = true;

          events.forEach(({ event }) => {
            const { section, method, data } = event;

            if (section === 'utility' && method === 'BatchInterrupted') {
              const index = data[0].toNumber ? data[0].toNumber() : Number(data[0]);
              const err = data[1];
              let msg = err.toString();
              if (err.isModule) {
                const decoded = api.registry.findMetaError(err.asModule);
                const { section: sec, name, docs } = decoded;
                msg = `${sec}.${name} - ${docs.join(' ')}`;
              }
              console.warn(`⚠️ Batch interrupted at call index ${index}: ${msg}`);
            }

            if (section === 'tokenManager' && method === 'LowerRequested') {
              const id = data[5];
              const lowerId = id.toNumber ? id.toNumber() : Number(id);
              if (!lowerIdsSet.has(lowerId)) {
                lowerIdsSet.add(lowerId);
                successCount += 1;
                console.log(`LowerRequested: lowerId=${lowerId}`);
              }
            }
          });
        }

        if (status.isInBlock) {
          console.log(`Batch included in block ${status.asInBlock.toHex()}`);
        } else if (status.isFinalized) {
          const lowerIds = Array.from(lowerIdsSet);
          console.log(`✅ Batch finalized: ${successCount} lowers created in this batch (lowerIds=[${lowerIds.join(', ')}])`);
          unsub();
          resolve({ successCount, lowerIds });
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function main() {
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
  console.log(`Max lowers to create: ${MAX_LOWERS === Infinity ? '∞ (no limit)' : MAX_LOWERS}`);
  console.log(`Batch size (per utility.batch): ${BATCH_SIZE}`);

  let amount = TOKEN_START_AMOUNT;

  const avtAddressRaw = await api.query.tokenManager.avtTokenContract();
  const avtAddress = avtAddressRaw.toString();
  console.log(`AVT address: ${avtAddress}`);

  let created = 0;

  while (created < MAX_LOWERS) {
    const remaining = MAX_LOWERS - created;
    const toSendInBatch = Math.min(BATCH_SIZE, remaining);

    console.log(`\n--- Starting batch of ${toSendInBatch} lowers (total created so far: ${created}) ---`);

    try {
      const { successCount, lowerIds } = await sendBatchDirectLower(api, signer, avtAddress, amount, toSendInBatch, FROM);

      created += successCount;
      amount += toSendInBatch;

      console.log(`Batch result: successCount=${successCount}, totalCreated=${created}, batchLowerIds=[${lowerIds.join(', ')}]`);
    } catch (err) {
      console.error(`❌ Batch failed: ${err.toString()}`);
      break;
    }

    if (created >= MAX_LOWERS) break;

    console.log(`--- Batch complete. Total created so far: ${created}. Sleeping ${DELAY_SECS}s before next batch ---`);
    await sleep(DELAY_SECS * 1000);
  }

  console.log(`\n✅ Finished. Total successful lowers created: ${created}`);
  await api.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
