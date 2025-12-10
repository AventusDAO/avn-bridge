const { init } = require('./common');

const [CHAIN, FROM, TO] = process.argv.slice(2);

if (!CHAIN || !FROM || !TO) throw new Error('Usage: node claim-lowers.js <CHAIN> <FROM_ID> <TO_ID>');
if (CHAIN === 'mainnet') throw new Error('Not for mainnet use.');

const FROM_ID = Number(FROM);
const TO_ID = Number(TO);

async function main() {
  const { t2Api, bridge } = await init(CHAIN);

  let foundCount = 0;
  let successCount = 0;
  let awaitingProofCount = 0;
  const failed = [];

  console.log(`Searching from Lower ID ${FROM_ID} to ${TO_ID}`);

  try {
    for (let id = FROM_ID; id <= TO_ID; id++) {
      const entry = await t2Api.query.tokenManager.lowersReadyToClaim(id);
      if (entry.isNone) {
        awaitingProofCount++;
        continue;
      }

      const json = entry.toJSON();
      const proof = json && json.encodedLowerData;
      if (!proof || typeof proof !== 'string') {
        console.warn(`⚠️ lower ID ${id}: encodedLowerData missing/invalid`);
        continue;
      }

      foundCount++;
      console.log(`\nClaiming lower ID ${id}`);

      try {
        const tx = await bridge.claimLower(proof);
        console.log(`  tx.hash = ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`  ✅ Mined in block ${receipt.blockNumber}`);
        successCount++;
      } catch (e) {
        const msg = e?.message || e?.toString() || 'unknown error';
        console.error(`  ❌ Failed to claim lower ID ${id}: ${msg}`);
        failed.push(id);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Found lowersReadyToClaim: ${foundCount}`);
    console.log(`Successfully claimed    : ${successCount}`);
    console.log(`Still awaiting proof    : ${awaitingProofCount}`);
    console.log(`Failed                  : ${failed.length}`);

    if (failed.length) {
      console.log(`\nFailures: ${failed.join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await t2Api.disconnect();
  }
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
