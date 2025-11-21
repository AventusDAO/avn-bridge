const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { hexToU8a, isHex } = require('@polkadot/util');
require('dotenv').config();

const [ENVIRONMENT] = process.argv.slice(2);
const WS_ENDPOINT = `wss://avn-parachain-internal.${ENVIRONMENT}.aventus.io`;
const T2_PRIVATE_KEY = ENVIRONMENT === 'dev' ? process.env.T2_PRIVATE_KEY_DEV : process.env.T2_PRIVATE_KEY_TESTNET;
const T1_RECIPIENT = '0xde7e1091cde63c05aa4d82c62e4c54edbc701b22';

const TOKEN_START_AMOUNT = 1000;
const PER_BLOCK = 5;

async function sendDirectLower(api, signer, avtAddress, amount, from, nonce) {
  return new Promise(async (resolve, reject) => {
    try {
      const tx = api.tx.tokenManager.scheduleDirectLower(from, avtAddress, amount, T1_RECIPIENT);
      let lowerId = null;

      const unsub = await tx.signAndSend(signer, { nonce }, ({ status, dispatchError, events }) => {
        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            const { section, name, docs } = decoded;
            console.error(`❌ Failed amount=${amount}: ${section}.${name} - ${docs.join(' ')}`);
          } else {
            console.error(`❌ Failed amount=${amount}: ${dispatchError.toString()}`);
          }
          unsub();
          reject(dispatchError);
          return;
        }

        if (events && events.length) {
          events.forEach(({ event }) => {
            const { section, method, data } = event;
            if (section === 'tokenManager' && method === 'LowerRequested') {
              const id = data[5];
              if (id) {
                lowerId = id.toNumber ? id.toNumber() : Number(id);
                console.log(`LowerRequested: amount=${amount} lowerId=${lowerId}`);
              }
            }
          });
        }

        if (status.isInBlock) {
          console.log(`Included in block ${status.asInBlock.toHex()} amount=${amount} nonce=${nonce.toString()}`);
        } else if (status.isFinalized) {
          console.log(`✅ Finalized amount=${amount} lowerId=${lowerId !== null ? lowerId : 'unknown'} nonce=${nonce.toString()}`);
          unsub();
          resolve(lowerId);
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

  let amount = TOKEN_START_AMOUNT;

  const avtAddressRaw = await api.query.tokenManager.avtTokenContract();
  const avtAddress = avtAddressRaw.toString();
  console.log(`AVT address: ${avtAddress}`);

  while (true) {
    let nextNonce = await api.rpc.system.accountNextIndex(FROM);
    console.log(`\n=== New batch: ${PER_BLOCK} lowers starting amount=${amount + 1}, starting nonce=${nextNonce.toString()} ===`);

    const batchTx = [];

    for (let i = 0; i < PER_BLOCK; i++) {
      const thisAmount = ++amount;
      const thisNonce = nextNonce;
      nextNonce = nextNonce.addn(1);

      console.log(`Sending scheduleDirectLower amount=${thisAmount} nonce=${thisNonce.toString()}`);

      const p = sendDirectLower(api, signer, avtAddress, thisAmount, FROM, thisNonce)
        .then(lowerId => {
          console.log(`Completed amount=${thisAmount}, lowerId=${lowerId ?? 'unknown'}, nonce=${thisNonce.toString()}`);
          return lowerId;
        })
        .catch(err => {
          console.error(`❌ Error amount=${thisAmount}, nonce=${thisNonce.toString()}: ${err}`);
        });

      batchTx.push(p);
    }

    await Promise.allSettled(batchTx);
  }
}

main().catch(err => {
  console.error('Exiting:', err);
  process.exit(1);
});
