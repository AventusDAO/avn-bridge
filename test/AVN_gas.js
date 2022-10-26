const allowedGas = {
  ethLift: 26000,
  erc777Lift: 79500,
  erc20Lift: 104000,
  erc20ProxyLift: 118500,
  erc777Lower: 110500,
  erc20Lower: 96000,
  ethLower: 83000,
  erc777ProxyLower: 112500,
  erc20ProxyLower: 98000,
  ethProxyLower: 85500,
  publishRoot: 127500,
  updateLowerCall: 45000,
  setOwner: 31000
}

const testHelper = require('./helpers/testHelper');
const AVN = artifacts.require('AVN');
const MockERC777 = artifacts.require('MockERC777');
const MockERC20 = artifacts.require('MockERC20');
const AvnValidatorsManager = artifacts.require('AvnValidatorsManager');
const BN = web3.utils.BN;

let avn, avnValidatorsManager, mockERC777, mockERC20;
let accounts, validators;
let owner, someOtherAccount, someT2PublicKey;

contract('AVN Gas [ @skip-on-coverage ]', async () => {

  before(async () => {
    await testHelper.init(); // pass true to run with 8m tx tree size (slow)
    mockERC777 = await MockERC777.deployed();
    mockERC20 = await MockERC20.deployed();
    avnValidatorsManager = await AvnValidatorsManager.deployed();
    avn = await AVN.deployed();
    accounts = testHelper.accounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    someT2PublicKey = testHelper.someT2PublicKey();
    validators = testHelper.validators();
    await testHelper.initialise_V1(mockERC20, avnValidatorsManager, validators, 10);
    await avn.transferValidators();
  });

  it('ETH lift()', async () => {
    const liftAmount = 100;
    const tx = await avn.liftETH(someT2PublicKey, {value: liftAmount});
    testHelper.checkGas(tx, allowedGas.ethLift);
  });

  it('ERC777 lift()', async () => {
    const liftAmount = 100;
    const tx = await mockERC777.send(avn.address, liftAmount, someT2PublicKey);
    testHelper.checkGas(tx, allowedGas.erc777Lift);
  });

  it('ERC20 lift()', async () => {
    const liftAmount = 200;
    const approveTx = await mockERC20.approve(avn.address, liftAmount);
    const liftTx = await avn.lift(mockERC20.address, someT2PublicKey, liftAmount);
    const tx = testHelper.sumTxGas(approveTx, liftTx);
    testHelper.checkGas(tx, allowedGas.erc20Lift);
  });

  it('ERC20 proxy lift()', async () => {
    const liftAmount = 300;
    const proofNonce = 1;
    const liftProofHash = testHelper.hash(mockERC20.address, someT2PublicKey, liftAmount, proofNonce);
    const proof = await testHelper.sign(liftProofHash, owner);
    const approveTx = await mockERC20.approve(avn.address, liftAmount, {from: owner});
    const proxyLiftTx = await avn.proxyLift(mockERC20.address, someT2PublicKey, liftAmount, owner, proofNonce, proof,
        {from: someOtherAccount});
    const tx = testHelper.sumTxGas(approveTx, proxyLiftTx);
    testHelper.checkGas(tx, allowedGas.erc20ProxyLift);
  });

  it('ERC777 lower()', async () => {
    const liftAmount = new BN(100);
    const lowerAmount = new BN(50);
    // lift
    await mockERC777.send(avn.address, liftAmount, someT2PublicKey);
    const tree = await testHelper.createTreeAndPublishRoot(avn, mockERC777.address, lowerAmount);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc777Lower);
  });

  it('ERC20 lower()', async () => {
    const liftAmount = new BN(10000000);
    const lowerAmount = new BN(1234567);
    // lift
    await mockERC20.approve(avn.address, liftAmount);
    await avn.lift(mockERC20.address, someT2PublicKey, liftAmount);
    const tree = await testHelper.createTreeAndPublishRoot(avn, mockERC20.address, lowerAmount);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc20Lower);
  });

  it('ETH lower()', async () => {
    const liftAmount = new BN(1000);
    const lowerAmount = new BN(555);
    // lift
    await avn.liftETH(someT2PublicKey, {value: liftAmount});
    const tree = await testHelper.createTreeAndPublishRoot(avn, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.ethLower);
  });

  it('ERC777 proxy lower()', async () => {
    const liftAmount = new BN(100);
    const lowerAmount = new BN(50);
    // lift
    await mockERC777.send(avn.address, liftAmount, someT2PublicKey);
    const tree = await testHelper.createTreeAndPublishRoot(avn, mockERC777.address, lowerAmount, true);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc777ProxyLower);
  });

  it('ERC20 proxy lower()', async () => {
    const liftAmount = new BN(10000000);
    const lowerAmount = new BN(1234567);
    // lift
    await mockERC20.approve(avn.address, liftAmount);
    await avn.lift(mockERC20.address, someT2PublicKey, liftAmount);
    const tree = await testHelper.createTreeAndPublishRoot(avn, mockERC20.address, lowerAmount, true);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc20ProxyLower);
  });

  it('ETH proxy lower()', async () => {
    const liftAmount = new BN(1000);
    const lowerAmount = new BN(555);
    // lift
    await avn.liftETH(someT2PublicKey, {value: liftAmount});
    const tree = await testHelper.createTreeAndPublishRoot(avn, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount, true);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.ethProxyLower);
  });

  it('publishRoot()', async () => {
    const rootHash = testHelper.randomBytes32();
    const t2TransactionId = testHelper.randomUint256();
    const confirmations = await testHelper.getConfirmations(avn, rootHash, t2TransactionId);
    const tx = await avn.publishRoot(rootHash, t2TransactionId, confirmations, {from: validators[1].t1Address});
    testHelper.checkGas(tx, allowedGas.publishRoot);
  });

  it('updateLowerCall()', async () => {
    const tx = await avn.updateLowerCall('0x0001', 1234);
    testHelper.checkGas(tx, allowedGas.updateLowerCall);
  });

  it('setOwner()', async () => {
    const tx = await avn.setOwner(someOtherAccount);
    testHelper.checkGas(tx, allowedGas.setOwner);
  });
});