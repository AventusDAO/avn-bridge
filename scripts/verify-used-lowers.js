const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { MAINNET_RPC_URL, SEPOLIA_RPC_URL } = process.env;
const RPCS = { mainnet: MAINNET_RPC_URL, sepolia: SEPOLIA_RPC_URL };
const [NETWORK, CONTRACT] = process.argv.slice(2);
const ABI = ['function lowerUsed(uint32 lowerId) view returns (bool)'];

const provider = new ethers.JsonRpcProvider(RPCS[NETWORK]);
const contract = new ethers.Contract(CONTRACT, ABI, provider);

const filename = path.join(__dirname, `${CONTRACT.toLowerCase()}.txt`);
if (!fs.existsSync(filename)) {
  console.error(`Missing ${filename}. Run "used-lowers.js" first.`);
  process.exit(1);
}

const lowerIds = fs
  .readFileSync(filename, 'utf8')
  .split('\n')
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => Number(s))
  .sort((a, b) => a - b);

if (lowerIds.some(n => !Number.isInteger(n) || n < 0)) {
  console.error('File contains invalid lower IDs.');
  process.exit(1);
}

(async () => {
  console.log(`\nNetwork: ${NETWORK}`);
  console.log(`\nBridge: ${CONTRACT}`);
  console.log(`\nLoaded ${lowerIds.length} lowerId(s) from ${filename}`);

  const bad = [];
  const CONCURRENCY = 25;

  async function worker(ids) {
    for (const id of ids) {
      try {
        const used = await contract.lowerUsed(id);
        if (!used) bad.push(id);
      } catch (e) {
        console.error(`Error checking lowerId ${id}`);
        bad.push(id);
      }
    }
  }

  const chunkSize = Math.ceil(lowerIds.length / CONCURRENCY) || 1;
  const chunks = [];
  for (let i = 0; i < lowerIds.length; i += chunkSize) {
    chunks.push(lowerIds.slice(i, i + chunkSize));
  }

  await Promise.all(chunks.map(worker));

  if (bad.length === 0) {
    console.log('\n✅ Verification passed: all IDs return lowerUsed == true.');
  } else {
    console.log(`\n❌ ${bad.length} ID(s) were NOT marked used:`);
    console.log(
      JSON.stringify(
        bad.sort((a, b) => a - b),
        null,
        2
      )
    );
    process.exitCode = 1;
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
