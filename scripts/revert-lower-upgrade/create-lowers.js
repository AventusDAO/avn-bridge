const { init, sleep } = require('./common/utils');

const [CHAIN, T1_RECIPIENT, BATCH_SIZE_ARG, MAX_LOWERS_ARG] = process.argv.slice(2);

if (!CHAIN || !T1_RECIPIENT) throw new Error('Usage: node create-lowers.js <CHAIN> <T1_RECIPIENT> [MAX_LOWERS] [BATCH_SIZE]');
if (CHAIN === 'mainnet') throw new Error('Not for mainnet use.');

const BATCH_SIZE = BATCH_SIZE_ARG ? Number(BATCH_SIZE_ARG) : 1;
const MAX_LOWERS = MAX_LOWERS_ARG ? Number(MAX_LOWERS_ARG) : Infinity;
const TOKEN_START_AMOUNT = 1000;
const DELAY_SECS = 15;

async function sendBatch(api, t2Signer, tokenAddress, start, count) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    calls.push(api.tx.tokenManager.scheduleDirectLower(t2Signer.address, tokenAddress, start + i, T1_RECIPIENT));
  }

  return new Promise(async (resolve, reject) => {
    const batchTx = api.tx.utility.batch(calls);
    const lowerIds = new Set();

    const unsub = await batchTx.signAndSend(t2Signer, ({ status, dispatchError, events }) => {
      if (dispatchError) {
        const msg = dispatchError.toString();
        console.error(`❌ Batch dispatch error: ${msg}`);
        unsub();
        return reject(msg);
      }

      events?.forEach(({ event }) => {
        if (event.section === 'tokenManager' && event.method === 'LowerRequested') {
          const id = event.data[5].toNumber();
          lowerIds.add(id);
        }
      });

      if (status.isFinalized) {
        unsub();
        resolve([...lowerIds]);
      }
    });
  });
}

async function main() {
  const { api, t2Signer } = await init(CHAIN);

  try {
    const tokenAddress = (await api.query.tokenManager.avtTokenContract()).toString();
    console.log(`Token address: ${tokenAddress}`);
    console.log(`Max lowers   : ${MAX_LOWERS === Infinity ? '∞ (no limit)' : MAX_LOWERS}`);
    console.log(`Batch size   : ${BATCH_SIZE}`);

    let created = 0;
    let amount = TOKEN_START_AMOUNT;

    while (created < MAX_LOWERS) {
      const batch = Math.min(BATCH_SIZE, MAX_LOWERS - created);

      console.log(`\nCreating ${batch} lowers (created so far = ${created})`);

      const lowerIds = await sendBatch(api, t2Signer, tokenAddress, amount, batch);

      created += lowerIds.length;
      amount += batch;

      console.log(`✅ Created lowers: ${lowerIds.join(', ')}`);

      if (created < MAX_LOWERS) {
        console.log(`Waiting ${DELAY_SECS}s before next batch...`);
        await sleep(DELAY_SECS * 1000);
      }
    }

    console.log(`\n✅ Finished. Total lowers created: ${created}`);
  } finally {
    await api.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
