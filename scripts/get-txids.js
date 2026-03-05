const { accumulateBitmap, blockRanges, findDeploymentBlock, init, parseIdFromTopic, sleep, saveState } = require('./common');
const { ethers } = require('ethers');
const [CHAIN] = process.argv.slice(2);

async function main() {
  if (!CHAIN) {
    console.error('Missing chain');
    process.exit(1);
  }

  const { t2Api, t1Provider, bridge } = await init(CHAIN);

  try {
    const deployBlock = await findDeploymentBlock(t1Provider, bridge.address);
    if (!deployBlock) throw new Error('Bridge deployment block not found');

    console.log(`T1 bridge deployment block : ${deployBlock}`);

    const sigAuthorAdded = ethers.id('LogAuthorAdded(address,bytes32,uint32)');
    const sigAuthorRemoved = ethers.id('LogAuthorRemoved(address,bytes32,uint32)');
    const sigAvtSupplyUpdated = ethers.id('LogAvtSupplyUpdated(uint256,uint256,uint32)');
    const sigRootPublished = ethers.id('LogRootPublished(bytes32,uint32)');

    const used = new Set();

    for await (const [from, to] of blockRanges(t1Provider, deployBlock)) {
      const logs = await t1Provider.getLogs({
        address: bridge.address,
        topics: [[sigAuthorAdded, sigAuthorRemoved, sigAvtSupplyUpdated, sigRootPublished]],
        fromBlock: from,
        toBlock: to
      });

      for (const log of logs) {
        const sig = log.topics[0];
        const t2TxId = sig === sigRootPublished ? parseIdFromTopic(log.topics[2]) : parseIdFromTopic(log.topics[3]);
        used.add(t2TxId);
      }

      await sleep(1500);
    }

    console.log(`Used T2 Tx IDs found       : ${used.size}`);

    const idsSorted = [...used].sort((a, b) => a - b);
    const { buckets, words } = accumulateBitmap(idsSorted);

    const state = {
      migrateArgs: {
        buckets: `[${buckets.join(',')}]`,
        words: `[${words.map(w => w.toString(10)).join(',')}]`
      },
      usedT2TxIds: idsSorted
    };

    saveState(`${CHAIN}-txids`, state);

    console.log('Buckets:', state.migrateArgs.buckets);
    console.log('Words  :', state.migrateArgs.words);
  } finally {
    if (t2Api) await t2Api.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
