const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { MAINNET_RPC_URL, SEPOLIA_RPC_URL } = process.env;
const RPCS = { mainnet: MAINNET_RPC_URL, sepolia: SEPOLIA_RPC_URL };
const [NETWORK, BRIDGE_ADDRESS] = process.argv.slice(2);
const ABI = ['function lowerUsed(uint32 lowerId) view returns (bool)'];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPCS[NETWORK]);
  const contract = new ethers.Contract(BRIDGE_ADDRESS, ABI, provider);
  const filePath = path.join(__dirname, `${BRIDGE_ADDRESS}.json`);

  if (!fs.existsSync(filePath)) {
    console.error(`State file not found: ${filePath}`);
    process.exit(1);
  }

  let lowers;
  try {
    lowers = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse JSON from ${filePath}:`, e);
    process.exit(1);
  }

  const claimedLowerIDs = lowers.claimed.map(n => Number(n)).filter(n => !Number.isNaN(n));

  console.log(`\nNetwork: ${NETWORK}`);
  console.log(`\nBridge: ${BRIDGE_ADDRESS}`);
  console.log(`\nLoaded ${claimedLowerIDs.length} lowerId(s) from ${filePath}`);

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

  const chunkSize = Math.ceil(claimedLowerIDs.length / CONCURRENCY) || 1;
  const chunks = [];
  for (let i = 0; i < claimedLowerIDs.length; i += chunkSize) {
    chunks.push(claimedLowerIDs.slice(i, i + chunkSize));
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
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
