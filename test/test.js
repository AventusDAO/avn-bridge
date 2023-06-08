const { expect } = require('chai');
const helpers = require('@nomicfoundation/hardhat-network-helpers');

const validators = require('../validators.json');

async function impersonate(address) {
  await helpers.impersonateAccount(address);
  return await ethers.getSigner(address);
}

const AVN_BRIDGE_ADDRESS = '0x486B45844c4ab8F683f590217E8FC2128Af77A19'

describe('Using forked mainnet state to test upgrade', function () {
  before(async () => {
    const bridge = new ethers.Contract(AVN_BRIDGE_ADDRESS, (require('../artifacts/contracts/AVNBridge.sol/AVNBridge.json')).abi, ethers.provider);

    const alice = new ethers.Wallet(validators[0].ethPrivateKey, ethers.provider);
    const bob = new ethers.Wallet(validators[1].ethPrivateKey, ethers.provider);
    const charlie = new ethers.Wallet(validators[2].ethPrivateKey, ethers.provider);
    const dave = new ethers.Wallet(validators[3].ethPrivateKey, ethers.provider);
    const eve = new ethers.Wallet(validators[4].ethPrivateKey, ethers.provider);

    const dave_T2_pubKey = validators[3].validator.tier2PublicKeyHex;
    const eve_T1_pubKey = '0x' + validators[4].ethUncompressedPublicKey.slice(4);
    const eve_T2_pubKey = validators[4].validator.tier2PublicKeyHex;

    let t2_transactionID = 1;
    const deregistrationHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [eve_T2_pubKey, eve_T1_pubKey]);
    let encodedParams = ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256', 'bytes32'], [deregistrationHash, t2_transactionID, dave_T2_pubKey]);
    let confirmationHash = ethers.utils.solidityKeccak256(['bytes'], [encodedParams]);
    let aliceSignature = await alice.signMessage(ethers.utils.arrayify(confirmationHash));
    let bobSignature = await bob.signMessage(ethers.utils.arrayify(confirmationHash));
    let charlieSignature = await charlie.signMessage(ethers.utils.arrayify(confirmationHash));
    let daveSignature = await dave.signMessage(ethers.utils.arrayify(confirmationHash));
    let eveSignature = await eve.signMessage(ethers.utils.arrayify(confirmationHash));
    let confirmations = aliceSignature + bobSignature.slice(2) + charlieSignature.slice(2) + daveSignature.slice(2);

    const daveSender = await impersonate(dave.address);
    await bridge.connect(daveSender).deregisterValidator(eve_T1_pubKey, eve_T2_pubKey, t2_transactionID, confirmations);

    t2_transactionID++;
    const registrationHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [eve_T1_pubKey, eve_T2_pubKey]);
    encodedParams = ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256', 'bytes32'], [registrationHash, t2_transactionID, dave_T2_pubKey]);
    confirmationHash = ethers.utils.solidityKeccak256(['bytes'], [encodedParams]);
    aliceSignature = await alice.signMessage(ethers.utils.arrayify(confirmationHash));
    bobSignature = await bob.signMessage(ethers.utils.arrayify(confirmationHash));
    charlieSignature = await charlie.signMessage(ethers.utils.arrayify(confirmationHash));
    daveSignature = await dave.signMessage(ethers.utils.arrayify(confirmationHash));
    eveSignature = await eve.signMessage(ethers.utils.arrayify(confirmationHash));
    confirmations = aliceSignature + bobSignature.slice(2) + charlieSignature.slice(2) + daveSignature.slice(2);

    await bridge.connect(daveSender).registerValidator(eve_T1_pubKey, eve_T2_pubKey, t2_transactionID, confirmations);
  });

  it('X', async function () {
  });
});

