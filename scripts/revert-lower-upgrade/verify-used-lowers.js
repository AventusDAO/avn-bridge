const { init, loadState } = require('./common');

const [CHAIN] = process.argv.slice(2);

async function main() {
  const { t2Api, bridge } = await init(CHAIN);

  try {
    const { filePath, state } = loadState(CHAIN);
    const claimed = (state.claimed || []).map(n => Number(n)).filter(n => !Number.isNaN(n));
    console.log(`Loaded ${claimed.length} claimed lower ID(s) from ${filePath.split(/[\\/]/).pop()}`);
    console.log(`Checking ${claimed.length} lowers...`);

    const bad = [];
    let checked = 0;

    for (const id of claimed) {
      try {
        const used = await bridge.isLowerUsed(id);
        if (!used) bad.push(id);
      } catch (e) {
        console.error(`Error checking lower ID ${id}: ${e.message || e.toString()}`);
        bad.push(id);
      }

      if (++checked % 100 === 0) console.log(`Checked ${checked}/${claimed.length}`);
    }

    if (checked % 100 !== 0) console.log(`Checked ${checked}/${claimed.length}`);

    if (bad.length) {
      bad.sort((a, b) => a - b);
      console.log(`\n❌ ${bad.length} ID(s) NOT marked used:`);
      console.log(JSON.stringify(bad, null, 2));
      process.exitCode = 1;
    } else {
      console.log('\n✅ All lowers marked used');
    }
  } finally {
    await t2Api.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
