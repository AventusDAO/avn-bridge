const { init, sleep, loadState, saveState } = require('./common');

const [CHAIN] = process.argv.slice(2);

const BATCH_SIZE = 10;
const DELAY_SECS = 30;
const QUEUE_LIMIT = 100;

async function sendBatch(t2Api, t2Signer, ids) {
  if (!ids.length) return [];

  const calls = ids.map(id => t2Api.tx.tokenManager.regenerateLowerProof(id));

  return new Promise(async (resolve, reject) => {
    const tx = t2Api.tx.utility.batch(calls);

    const unsub = await tx.signAndSend(t2Signer, ({ status, dispatchError }) => {
      if (dispatchError) {
        const msg = dispatchError.toString();
        console.error(`❌ Batch dispatch error: ${msg}`);
        unsub();
        return reject(msg);
      }
      if (status.isFinalized) {
        unsub();
        resolve(ids);
      }
    });
  });
}

async function main() {
  const { t2Api, t2Signer } = await init(CHAIN);

  try {
    const { filePath, state } = loadState(CHAIN);

    const done = new Set(state.regenerated || []);
    let remaining = (state.toRegenerateOnT2 || []).filter(x => !done.has(x));

    console.log(`Using state file    : ${filePath}`);
    console.log(`Total to regenerate : ${state.toRegenerateOnT2?.length || 0}`);
    console.log(`Already regenerated : ${done.size}`);
    console.log(`Remaining           : ${remaining.length}`);

    while (remaining.length) {
      const queueJson = (await t2Api.query.ethBridge.requestQueue()).toJSON() || [];
      const queueLen = Array.isArray(queueJson) ? queueJson.length : 0;

      if (queueLen + BATCH_SIZE >= QUEUE_LIMIT) {
        console.log(`Queue full (current=${queueLen}, limit=${QUEUE_LIMIT}), waiting ${DELAY_SECS}s...`);
        await sleep(DELAY_SECS * 1000);
        continue;
      }

      const batch = remaining.slice(0, BATCH_SIZE);
      console.log(`Regenerating        : ${batch.join(', ')}`);

      await sendBatch(t2Api, t2Signer, batch);
      batch.forEach(id => done.add(id));

      remaining = remaining.filter(x => !done.has(x));
      state.regenerated = [...done].sort((a, b) => a - b);
      state.toRegenerateOnT2 = remaining;

      const savedPath = saveState(CHAIN, state);
      console.log(`State saved (${savedPath}) - regenerated=${state.regenerated.length}, remaining=${remaining.length}`);

      if (remaining.length) {
        console.log(`Waiting ${DELAY_SECS}s before next batch...`);
        await sleep(DELAY_SECS * 1000);
      }
    }

    console.log('✅ All requested lower proofs regenerated.');
  } finally {
    await t2Api.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
