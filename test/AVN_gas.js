const allowedGas = {
  ethLift: 27450,
  erc777Lift: 76100,
  erc20Lift: 58950,
  erc777Lower: 85550,
  erc20Lower: 74500,
  ethLower: 63900,
  erc777ProxyLower: 87700,
  erc20ProxyLower: 76650,
  ethProxyLower: 66050,
  publishRoot: 127450,
  triggerGrowth: 149700,
  releaseGrowth: 39100,
  triggerGrowth_via_owner: 71650,
  triggerGrowth_immediate_release: 150900,
  updateLowerCall: 45800,
  transferOwnership: 31850
}

const testHelper = require('./helpers/testHelper');
const Token777 = artifacts.require('Token777');
const Token20 = artifacts.require('Token20');
const BN = web3.utils.BN;
const GROWTH_DELAY = 100;

let avnBridge, token777, token20;
let accounts, validators;
let owner, someOtherAccount, someT2PublicKey;

contract('AVNBridge Gas [ @skip-on-coverage ]', async () => {

  before(async () => {
    await testHelper.init(); // pass true to run with 8m tx tree size (slow)
    token777 = await Token777.deployed();
    token20 = await Token20.deployed();
    avnBridge = await testHelper.deployAVNBridge(token20.address);
    accounts = testHelper.accounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    someT2PublicKey = testHelper.someT2PublicKey();
    validators = testHelper.validators();
    await testHelper.loadValidators(avnBridge, validators, 10);
    await token20.transferOwnership(avnBridge.address);
    await avnBridge.setGrowthDelay(GROWTH_DELAY);
  });

  it('ETH lift()', async () => {
    const liftAmount = 100;
    const tx = await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
    testHelper.checkGas(tx, allowedGas.ethLift);
  });

  it('ERC777 lift()', async () => {
    const liftAmount = 100;
    const tx = await token777.send(avnBridge.address, liftAmount, someT2PublicKey);
    testHelper.checkGas(tx, allowedGas.erc777Lift);
  });

  it('ERC20 lift()', async () => {
    const liftAmount = 200;
    await token20.approve(avnBridge.address, liftAmount);
    const tx = await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);
    testHelper.checkGas(tx, allowedGas.erc20Lift);
  });

  it('ERC777 lower()', async () => {
    const liftAmount = new BN(100);
    const lowerAmount = new BN(50);
    // lift
    await token777.send(avnBridge.address, liftAmount, someT2PublicKey);
    const tree = await testHelper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount);
    const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc777Lower);
  });

  it('ERC20 lower()', async () => {
    const liftAmount = new BN(10000000);
    const lowerAmount = new BN(1234567);
    // lift
    await token20.approve(avnBridge.address, liftAmount);
    await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);
    const tree = await testHelper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount);
    const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc20Lower);
  });

  it('ETH lower()', async () => {
    const liftAmount = new BN(1000);
    const lowerAmount = new BN(555);
    // lift
    await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
    const tree = await testHelper.createTreeAndPublishRoot(avnBridge, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount);
    const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.ethLower);
  });

  it('ERC777 proxy lower()', async () => {
    const liftAmount = new BN(100);
    const lowerAmount = new BN(50);
    // lift
    await token777.send(avnBridge.address, liftAmount, someT2PublicKey);
    const tree = await testHelper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount, true);
    const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc777ProxyLower);
  });

  it('ERC20 proxy lower()', async () => {
    const liftAmount = new BN(10000000);
    const lowerAmount = new BN(1234567);
    // lift
    await token20.approve(avnBridge.address, liftAmount);
    await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);
    const tree = await testHelper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount, true);
    const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.erc20ProxyLower);
  });

  it('ETH proxy lower()', async () => {
    const liftAmount = new BN(1000);
    const lowerAmount = new BN(555);
    // lift
    await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
    const tree = await testHelper.createTreeAndPublishRoot(avnBridge, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount, true);
    const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
    testHelper.checkGas(tx, allowedGas.ethProxyLower);
  });

  it('publishRoot()', async () => {
    const rootHash = testHelper.randomBytes32();
    const t2TransactionId = testHelper.randomUint256();
    const confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId);
    const tx = await avnBridge.publishRoot(rootHash, t2TransactionId, confirmations, {from: validators[1].t1Address});
    testHelper.checkGas(tx, allowedGas.publishRoot);
  });

  it('triggerGrowth()', async () => {
    const amount = 100;
    const period = 1;
    const growthHash = web3.utils.sha3(web3.eth.abi.encodeParameters(['uint128', 'uint32'], [amount, period]));
    const t2TransactionId = testHelper.randomUint256();
    const confirmations = await testHelper.getConfirmations(avnBridge, growthHash, t2TransactionId);
    const tx = await avnBridge.triggerGrowth(amount, period, t2TransactionId, confirmations, {from: validators[1].t1Address});
    testHelper.checkGas(tx, allowedGas.triggerGrowth);
  });

  it('releaseGrowth()', async () => {
    await testHelper.increaseBlockTimestamp(GROWTH_DELAY);
    const period = 1;
    const tx = await avnBridge.releaseGrowth(period);
    testHelper.checkGas(tx, allowedGas.releaseGrowth);
  });

  it('triggerGrowth() - via owner', async () => {
    const amount = 1000;
    const period = 2;
    const tx = await avnBridge.triggerGrowth(amount, period, 0, '0x');
    testHelper.checkGas(tx, allowedGas.triggerGrowth_via_owner);
  });

  it('triggerGrowth() - immediate release', async () => {
    await avnBridge.setGrowthDelay(0);
    const amount = 10000;
    const period = 3;
    const growthHash = web3.utils.sha3(web3.eth.abi.encodeParameters(['uint128', 'uint32'], [amount, period]));
    const t2TransactionId = testHelper.randomUint256();
    const confirmations = await testHelper.getConfirmations(avnBridge, growthHash, t2TransactionId);
    const tx = await avnBridge.triggerGrowth(amount, period, t2TransactionId, confirmations, {from: validators[1].t1Address});
    testHelper.checkGas(tx, allowedGas.triggerGrowth_immediate_release);
  });

  it('updateLowerCall()', async () => {
    const tx = await avnBridge.updateLowerCall('0x0001', 1234);
    testHelper.checkGas(tx, allowedGas.updateLowerCall);
  });

  it('transferOwnership()', async () => {
    const tx = await avnBridge.transferOwnership(someOtherAccount);
    testHelper.checkGas(tx, allowedGas.transferOwnership);
  });
});