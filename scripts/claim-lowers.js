const { ApiPromise, WsProvider } = require('@polkadot/api');
const ethers = require('ethers');
require('dotenv').config();

const [CHAIN, FROM_ID_ARG, TO_ID_ARG] = process.argv.slice(2);
const FROM_ID = Number(FROM_ID_ARG);
const TO_ID = Number(TO_ID_ARG);

if (CHAIN === 'mainnet') {
  console.error('Not for mainnet use.');
  process.exit(1);
}

const ETH_RPC = process.env.SEPOLIA_RPC_URL;
const WS_ENDPOINT = `wss://avn-parachain-internal.${CHAIN}.aventus.io`;
const NETWORK = 'sepolia';
const T1_PROVIDER = new ethers.JsonRpcProvider(ETH_RPC);
const BRIDGE_ABI = ['function claimLower(bytes proof)'];

async function main() {
  console.log(`T1 Network: ${NETWORK}`);
  console.log(`T1 RPC    : ${ETH_RPC}`);
  console.log(`T2 Chain  : ${CHAIN}`);
  console.log(`T2 WS     : ${WS_ENDPOINT}`);
  console.log(`Scanning lowerIds in range: [${FROM_ID}, ${TO_ID}]`);

  const wsProvider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider: wsProvider });

  console.log('T2 API connected.');
  const bridgeAddress = (await api.query.avn.avnBridgeContractAddress()).toString();
  console.log(`Bridge address (T1): ${bridgeAddress}`);

  const wallet = new ethers.Wallet(process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY, T1_PROVIDER);
  console.log(`Using T1 signer: ${wallet.address}`);

  const bridge = new ethers.Contract(bridgeAddress, BRIDGE_ABI, wallet);

  let foundCount = 0;
  let successCount = 0;
  const failed = [];

  for (let lowerId = FROM_ID; lowerId <= TO_ID; lowerId++) {
    const entry = await api.query.tokenManager.lowersReadyToClaim(lowerId);

    if (entry.isNone) continue;

    const json = entry.toJSON();
    const encodedLowerData = json && json.encodedLowerData;

    if (!encodedLowerData || typeof encodedLowerData !== 'string') {
      console.warn(`⚠️ lowerId=${lowerId}: entry present but encodedLowerData missing/invalid`);
      continue;
    }

    foundCount++;
    console.log(`\nFound lowersReadyToClaim for lowerId=${lowerId}`);
    console.log(`  encodedLowerData length: ${encodedLowerData.length} chars`);

    try {
      console.log(`  → Sending claimLower tx for lowerId=${lowerId}...`);
      const tx = await bridge.claimLower(encodedLowerData);
      console.log(`    tx.hash = ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`    ✅ Mined in block ${receipt.blockNumber}`);

      successCount++;
    } catch (e) {
      console.error(`    ❌ Failed to claim lowerId=${lowerId}: ${e.message || e.toString()}`);
      failed.push({ lowerId, error: e.message || e.toString() });
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total lowersReadyToClaim found in [${FROM_ID}, ${TO_ID}]: ${foundCount}`);
  console.log(`Successfully claimed: ${successCount}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailures:');
    failed.forEach(f => {
      console.log(`  lowerId=${f.lowerId}: ${f.error}`);
    });
    process.exitCode = 1;
  }

  await api.disconnect();
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
