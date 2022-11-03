const allowedGas = {
  ethLift: 27500,
  erc777Lift: 76200,
  erc20Lift: 103500,
  erc20ProxyLift: 117800,
  erc777Lower: 87000,
  erc20Lower: 76000,
  ethLower: 65300,
  erc777ProxyLower: 89100,
  erc20ProxyLower: 78200,
  ethProxyLower: 67500,
  publishRoot: 129100,
  updateLowerCall: 45800,
  transferOwnership: 31900
}

const testHelper = require('./helpers/testHelper');
const Token777 = artifacts.require('Token777');
const Token20 = artifacts.require('Token20');
const BN = web3.utils.BN;

let avn, token777, token20;
let accounts, validators;
let owner, someOtherAccount, someT2PublicKey;

contract('AVN Gas [ @skip-on-coverage ]', async () => {

  before(async () => {
    await testHelper.init(); // pass true to run with 8m tx tree size (slow)
    token777 = await Token777.deployed();
    token20 = await Token20.deployed();
    avn = await testHelper.deployAVN(token20.address);
    accounts = testHelper.accounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    someT2PublicKey = testHelper.someT2PublicKey();
    validators = testHelper.validators();
    await testHelper.loadValidators(avn, validators, 10);
  });

  it('ETH lift()', async () => {
    const liftAmount = 100;
    const tx = await avn.liftETH(someT2PublicKey, {value: liftAmount});
    testHelper.checkGas(tx, allowedGas.ethLift);
  });

  it('ERC777 lift()', async () => {
    const liftAmount = 100;
    const tx = await token777.send(avn.address, liftAmount, someT2PublicKey);
    testHelper.checkGas(tx, allowedGas.erc777Lift);
  });

  it('ERC20 lift()', async () => {
    const liftAmount = 200;
    const approveTx = await token20.approve(avn.address, liftAmount);
    const liftTx = await avn.lift(token20.address, someT2PublicKey, liftAmount);
    const tx = testHelper.sumTxGas(approveTx, liftTx);
    testHelper.checkGas(tx, allowedGas.erc20Lift);
  });

  it('ERC20 proxy lift()', async () => {
    const liftAmount = 300;
    const proofNonce = 1;
    const liftProofHash = testHelper.hash(token20.address, someT2PublicKey, liftAmount, proofNonce);
    const proof = await testHelper.sign(liftProofHash, owner);
    const approveTx = await token20.approve(avn.address, liftAmount, {from: owner});
    const proxyLiftTx = await avn.proxyLift(token20.address, someT2PublicKey, liftAmount, owner, proofNonce, proof,
        {from: someOtherAccount});
    const tx = testHelper.sumTxGas(approveTx, proxyLiftTx);
    testHelper.checkGas(tx, allowedGas.erc20ProxyLift);
  });

  it('ERC777 lower()', async () => {
    const liftAmount = new BN(100);
    const lowerAmount = new BN(50);
    // lift
    await token777.send(avn.address, liftAmount, someT2PublicKey);
    const tree = await testHelper.createTreeAndPublishRoot(avn, token777.address, lowerAmount);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc777Lower);
  });

  it('ERC20 lower()', async () => {
    const liftAmount = new BN(10000000);
    const lowerAmount = new BN(1234567);
    // lift
    await token20.approve(avn.address, liftAmount);
    await avn.lift(token20.address, someT2PublicKey, liftAmount);
    const tree = await testHelper.createTreeAndPublishRoot(avn, token20.address, lowerAmount);
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
    await token777.send(avn.address, liftAmount, someT2PublicKey);
    const tree = await testHelper.createTreeAndPublishRoot(avn, token777.address, lowerAmount, true);
    const tx = await avn.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc777ProxyLower);
  });

  it('ERC20 proxy lower()', async () => {
    const liftAmount = new BN(10000000);
    const lowerAmount = new BN(1234567);
    // lift
    await token20.approve(avn.address, liftAmount);
    await avn.lift(token20.address, someT2PublicKey, liftAmount);
    const tree = await testHelper.createTreeAndPublishRoot(avn, token20.address, lowerAmount, true);
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

  it('transferOwnership()', async () => {
    const tx = await avn.transferOwnership(someOtherAccount);
    testHelper.checkGas(tx, allowedGas.transferOwnership);
  });
});