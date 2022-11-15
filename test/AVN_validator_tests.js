const testHelper = require('./helpers/testHelper');
const Token20 = artifacts.require('Token20');
const BN = web3.utils.BN;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ONE_AVT_IN_ATTO = new BN(10).pow(new BN(18));
const GROWTH_DELAY = 100;

let avnBridge, token20;
let accounts, validators;
let owner, someOtherAccount, someT2PublicKey, FROM_ACTIVE_VALIDATOR;
let numInitialValidators, numActiveValidators, nextValidatorId;
let bnEquals;

contract('AVNBridge', async () => {

  before(async () => {
    await testHelper.init();
    token20 = await Token20.deployed();
    avnBridge = await testHelper.deployAVNBridge(token20.address);
    bnEquals = testHelper.bnEquals;
    accounts = testHelper.accounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    someT2PublicKey = testHelper.someT2PublicKey();
    validators = testHelper.validators();
    numInitialValidators = 6;
    numActiveValidators = numInitialValidators;
    nextValidatorId = numInitialValidators + 1;
    await testHelper.loadValidators(avnBridge, validators, numInitialValidators);
    await token20.setOwner(avnBridge.address);
    FROM_ACTIVE_VALIDATOR = {from: validators[1].t1Address};
  });

  context('setCoreOwner()', async () => {

    after(async () => {
      await token20.setOwner(avnBridge.address);
    });

    it('can set the core token owner via the avn bridge', async () => {
      assert.equal(await token20.owner(), avnBridge.address);
      await avnBridge.setCoreOwner();
      const logArgs = await testHelper.getLogArgs(token20, 'LogSetOwner');
      assert.equal(logArgs.owner, owner);
      assert.equal(await token20.owner(), owner);
    });

    context('fails when', async () => {
      it('not called by the AVNBridge owner', async () => {
        await testHelper.expectRevert(() => avnBridge.setCoreOwner({from: someOtherAccount}), 'Ownable: caller is not the owner');
      });
    });
  });

  context('denyGrowth()', async () => {

    it('succeeds when called by the AVNBridge owner', async () => {
      await avnBridge.denyGrowth(0);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogGrowthDenied');
      assert.equal(logArgs.period, 0);
    });

    context('fails when', async () => {
      it('not called by the AVNBridge owner', async () => {
        await testHelper.expectRevert(() => avnBridge.denyGrowth(0, {from: someOtherAccount}), 'Ownable: caller is not the owner');
      });
    });
  });

  context('setGrowthDelay()', async () => {
    it('can set the core token owner via the avn', async () => {
      const oldGrowthDelay = (await avnBridge.growthDelay()).toNumber();
      assert.equal(60 * 60 * 24 * 7, oldGrowthDelay);
      const newGrowthDelay = GROWTH_DELAY;
      await avnBridge.setGrowthDelay(newGrowthDelay);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogGrowthDelayUpdated');
      assert.equal(logArgs.oldDelaySeconds.toNumber(), oldGrowthDelay);
      assert.equal(logArgs.newDelaySeconds.toNumber(), newGrowthDelay);
    });

    context('fails when', async () => {
      it('not called by the AVNBridge owner', async () => {
        await testHelper.expectRevert(() => avnBridge.setGrowthDelay(5, {from: someOtherAccount}), 'Ownable: caller is not the owner');
      });
    });
  });

  context('setQuorum()', async () => {
    let quorum;

    before(async () => {
      quorum = [await avnBridge.quorum(0), await avnBridge.quorum(1)];
    });

    after(async () => {
      await avnBridge.setQuorum(quorum);
    });

    it('can set a new quorum', async () => {
      const newQuorum = [3,4];
      await avnBridge.setQuorum(newQuorum);
      let logArgs = await testHelper.getLogArgs(avnBridge, 'LogQuorumUpdated');
      assert.equal(logArgs.quorum[0].toNumber(), newQuorum[0]);
      assert.equal(logArgs.quorum[1].toNumber(), newQuorum[1]);
    });

    // TODO: Check that setting a new quorum has the desired effect

    context('fails when', async () => {
      it('numerator is greater than denominator', async () => {
        await testHelper.expectRevert(() => avnBridge.setQuorum([2,1]), 'Invalid: above 100%');
      });
      it('denominator is zero', async () => {
        await testHelper.expectRevert(() => avnBridge.setQuorum([1,0]), 'Invalid: div by zero');
      });
      it('not called by the owner', async () => {
        await testHelper.expectRevert(() => avnBridge.setQuorum([2,3], {from: someOtherAccount}), 'Ownable: caller is not the owner');
      });
    });
  });

  context('Growth', async () => {
    const growthAmount = ONE_AVT_IN_ATTO.mul(new BN(3));

    async function getGrowthConfirmations(growthAmount, period, t2TransactionId) {
      const growthHash = web3.utils.sha3(web3.eth.abi.encodeParameters(['uint128', 'uint32'], [growthAmount, period]));
      return await testHelper.getConfirmations(avnBridge, growthHash, t2TransactionId);
    }

    it('fails to trigger zero growth', async () => {
      const zeroAmount = 0;
      const period = 1;
      const t2TransactionId = testHelper.randomUint256();
      const confirmations = await getGrowthConfirmations(zeroAmount, period, t2TransactionId);

      await testHelper.expectRevert(() => avnBridge.triggerGrowth(zeroAmount, period, t2TransactionId, confirmations,
          FROM_ACTIVE_VALIDATOR), 'Cannot trigger zero growth');
    });

    it('succeeds in triggering growth via validators', async () => {
      const period = 1;
      const t2TransactionId = testHelper.randomUint256();
      const confirmations = await getGrowthConfirmations(growthAmount, period, t2TransactionId);

      await avnBridge.triggerGrowth(growthAmount, period, t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogGrowthTriggered');

      testHelper.bnEquals(logArgs.amount, growthAmount);
      testHelper.bnEquals(logArgs.period, period);
      assert.equal(logArgs.releaseTime.toNumber(), await testHelper.getCurrentBlockTimestamp() + GROWTH_DELAY);
    });

    it('succeeds in releasing growth', async () => {
      const period = 1;
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      await testHelper.increaseBlockTimestamp(GROWTH_DELAY);
      await avnBridge.releaseGrowth(period, { from: someOtherAccount });
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogGrowth');
      testHelper.bnEquals(logArgs.amount, growthAmount);
      testHelper.bnEquals(logArgs.period, period);

      testHelper.bnEquals(avnBalanceBefore.add(growthAmount), await token20.balanceOf(avnBridge.address));
      testHelper.bnEquals(avtSupplyBefore.add(growthAmount), await token20.totalSupply());
    });

    it('fails to release growth that has since been denied by the owner', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      const period = 2;
      const t2TransactionId = testHelper.randomUint256();
      const confirmations = await getGrowthConfirmations(growthAmount, period, t2TransactionId);

      await avnBridge.triggerGrowth(growthAmount, period, t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR);
      let logArgs = await testHelper.getLogArgs(avnBridge, 'LogGrowthTriggered');
      testHelper.bnEquals(logArgs.amount, growthAmount);
      testHelper.bnEquals(logArgs.period, period);
      assert.equal(logArgs.releaseTime.toNumber(), await testHelper.getCurrentBlockTimestamp() + GROWTH_DELAY);

      await avnBridge.denyGrowth(period);

      await testHelper.increaseBlockTimestamp(GROWTH_DELAY);
      await testHelper.expectRevert(() => avnBridge.releaseGrowth(period), 'Growth unavailable for period');

      testHelper.bnEquals(avnBalanceBefore, await token20.balanceOf(avnBridge.address));
      testHelper.bnEquals(avtSupplyBefore, await token20.totalSupply());
    });
  });

  context('publishRoot()', async () => {
    let rootHash, t2TransactionId;

    before(async () => {
      rootHash = testHelper.randomBytes32();
      t2TransactionId = testHelper.randomUint256();
    });

    it('validator can publish a root with valid confirmations', async () => {
      const confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId);
      await avnBridge.publishRoot(rootHash, t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogRootPublished');
      assert.equal(logArgs.rootHash, rootHash);
      assert.equal(logArgs.t2TransactionId.toString(), t2TransactionId.toString());
    });

    context('fails when', async () => {

      it('validator functions are disabled', async () => {
        await avnBridge.toggleValidatorFunctions(false);
        let logArgs = await testHelper.getLogArgs(avnBridge, 'LogValidatorFunctionsAreEnabled');
        assert.equal(logArgs.state, false);
        const newT2TransactionId = testHelper.randomUint256();
        const newRootHash = testHelper.randomBytes32();
        const confirmations = await testHelper.getConfirmations(avnBridge, newRootHash, newT2TransactionId);
        await testHelper.expectRevert(() => avnBridge.publishRoot(newRootHash, newT2TransactionId, confirmations,
            FROM_ACTIVE_VALIDATOR), 'Function currently disabled');
        await avnBridge.toggleValidatorFunctions(true);
        logArgs = await testHelper.getLogArgs(avnBridge, 'LogValidatorFunctionsAreEnabled');
        assert.equal(logArgs.state, true);
      });

      it('the t2 transaction ID is not unique', async () => {
        const newRootHash = testHelper.randomBytes32();
        const confirmations = await testHelper.getConfirmations(avnBridge, newRootHash, t2TransactionId);
        await testHelper.expectRevert(() => avnBridge.publishRoot(newRootHash, t2TransactionId, confirmations,
            FROM_ACTIVE_VALIDATOR), 'T2 transaction must be unique');
      });

      it('the root has already been published', async () => {
        const newT2TransactionId = testHelper.randomUint256();
        const confirmations = await testHelper.getConfirmations(avnBridge, rootHash, newT2TransactionId);
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, newT2TransactionId, confirmations,
            FROM_ACTIVE_VALIDATOR), 'Root already exists');
      });

      it('the publishing validator is not registered', async () => {
        t2TransactionId = testHelper.randomUint256();
        rootHash = testHelper.randomBytes32();
        const confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId);
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, t2TransactionId, confirmations),
            'Invalid confirmations');
      });

      it('the confirmations are invalid', async () => {
        t2TransactionId = testHelper.randomUint256();
        rootHash = testHelper.randomBytes32();

        let confirmations = '0xbad' + testHelper.strip_0x(await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId));
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR),
            'Invalid confirmations');
      });

      it('there are no confirmations', async () => {
        rootHash = testHelper.randomBytes32();
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, t2TransactionId, '0x', FROM_ACTIVE_VALIDATOR),
            'Invalid confirmations');
      });

      it('there are not enough confirmations', async () => {
        t2TransactionId = testHelper.randomUint256();
        rootHash = testHelper.randomBytes32();
        const numRequiredConfirmations = await testHelper.getNumRequiredConfirmations(avnBridge);
        const confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId, -1);
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR),
            'Invalid confirmations');
      });

      it('the confirmations are corrupted', async () => {
        t2TransactionId = testHelper.randomUint256();
        rootHash = testHelper.randomBytes32();
        let confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId);
        confirmations = confirmations.replace(/1/g, '2');
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR),
            'Invalid confirmations');
      });

      it('the confirmations are not signed by registered validators', async () => {
        t2TransactionId = testHelper.randomUint256();
        rootHash = testHelper.randomBytes32();
        const startFromNonValidator = nextValidatorId;
        const confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId, 0, startFromNonValidator);
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR),
            'Invalid confirmations');
      });

      it('the confirmations are not unique', async () => {
        t2TransactionId = testHelper.randomUint256();
        rootHash = testHelper.randomBytes32();
        const halfSet = Math.round(numActiveValidators/2);
        const confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId, - halfSet);
        const duplicateConfirmations = confirmations + testHelper.strip_0x(confirmations);
        await testHelper.expectRevert(() => avnBridge.publishRoot(rootHash, t2TransactionId, duplicateConfirmations,
            FROM_ACTIVE_VALIDATOR), 'Invalid confirmations');
      });
    });
  });

  context('registerValidator()', async () => {

    it('a new validator can be registered', async () => {
      const numActiveValidatorsBefore = await avnBridge.numActiveValidators();

      const newValidator = validators[nextValidatorId];
      let t2TransactionId = testHelper.randomUint256();
      const registerValidatorHash = testHelper.hash(newValidator.t1PublicKey, newValidator.t2PublicKey);
      let confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await avnBridge.registerValidator(newValidator.t1PublicKey, newValidator.t2PublicKey, t2TransactionId, confirmations,
          FROM_ACTIVE_VALIDATOR);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogValidatorRegistered');
      assert.equal(await avnBridge.idToT1Address(nextValidatorId), newValidator.t1Address);
      assert.equal(logArgs.t1PublicKeyLHS, newValidator.t1PublicKeyLHS);
      assert.equal(logArgs.t1PublicKeyRHS, newValidator.t1PublicKeyRHS);
      assert.equal(logArgs.t2PublicKey, newValidator.t2PublicKey);
      bnEquals(logArgs.t2TransactionId, t2TransactionId);

      // The validator is registered but not active
      bnEquals(numActiveValidatorsBefore, await avnBridge.numActiveValidators());
      assert.equal(await avnBridge.isActiveValidator(nextValidatorId), false);

      // Publishing a root containing a confirmation from the new validator activates the validator
      rootHash = testHelper.randomBytes32();
      t2TransactionId = testHelper.randomUint256();
      confirmations = await testHelper.getConfirmations(avnBridge, rootHash, t2TransactionId);
      newValidatorConfirmation = await testHelper.getSingleConfirmation(avnBridge, rootHash, t2TransactionId, newValidator.t1Address);
      const confirmationsIncludingNewValidator = newValidatorConfirmation + confirmations.substring(132);
      await avnBridge.publishRoot(rootHash, t2TransactionId, confirmationsIncludingNewValidator, FROM_ACTIVE_VALIDATOR);

      bnEquals(numActiveValidatorsBefore.add(new BN(1)), await avnBridge.numActiveValidators());
      assert.equal(await avnBridge.isActiveValidator(nextValidatorId), true);
      nextValidatorId++;
      numActiveValidators++;
    });

    it('a validator cannot be registered with an empty t1 public key', async () => {
      const prospectValidator = validators[nextValidatorId];
      const emptyKey = '0x';
      const t2TransactionId = testHelper.randomUint256();
      const registerValidatorHash = testHelper.hash(emptyKey, prospectValidator.t2PublicKey);
      const confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await testHelper.expectRevert(() => avnBridge.registerValidator(emptyKey, prospectValidator.t2PublicKey, t2TransactionId,
          confirmations, FROM_ACTIVE_VALIDATOR), 'T1 public key must be 64 bytes');
    });

    it('an existing active validator cannot be re-registered', async () => {
      const existingValidator = validators[1];
      const t2TransactionId = testHelper.randomUint256();
      const registerValidatorHash = testHelper.hash(existingValidator.t1PublicKey, existingValidator.t2PublicKey);
      const confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await testHelper.expectRevert(() => avnBridge.registerValidator(existingValidator.t1PublicKey, existingValidator.t2PublicKey,
          t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR), 'Validator is already registered');
    });

    it('an existing deregistered validator cannot be re-registered with a different public key', async () => {
      const existingValidator = validators[numActiveValidators];
      let t2TransactionId = testHelper.randomUint256();
      const deregisterValidatorHash = testHelper.hash(existingValidator.t2PublicKey, existingValidator.t1PublicKey);
      let confirmations = await testHelper.getConfirmations(avnBridge, deregisterValidatorHash, t2TransactionId);
      await avnBridge.deregisterValidator(existingValidator.t1PublicKey, existingValidator.t2PublicKey, t2TransactionId,
          confirmations, FROM_ACTIVE_VALIDATOR);
      numActiveValidators--;

      const newValidator = validators[nextValidatorId];
      t2TransactionId = testHelper.randomUint256();
      let registerValidatorHash = testHelper.hash(existingValidator.t1PublicKey, newValidator.t2PublicKey);
      confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await testHelper.expectRevert(() => avnBridge.registerValidator(existingValidator.t1PublicKey, newValidator.t2PublicKey,
          t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR), 'Cannot change T2 public key');

      t2TransactionId = testHelper.randomUint256();
      registerValidatorHash = testHelper.hash(existingValidator.t1PublicKey, existingValidator.t2PublicKey);
      confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await avnBridge.registerValidator(existingValidator.t1PublicKey, existingValidator.t2PublicKey, t2TransactionId, confirmations,
          FROM_ACTIVE_VALIDATOR);
    });

    it('validators cannot be registered with a T2 public key that is already in use', async () => {
      const prospectValidator = validators[nextValidatorId];
      const existingValidator = validators[1];
      const t2TransactionId = testHelper.randomUint256();
      const registerValidatorHash = testHelper.hash(prospectValidator.t1PublicKey, existingValidator.t2PublicKey);
      const confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await testHelper.expectRevert(() => avnBridge.registerValidator(prospectValidator.t1PublicKey, existingValidator.t2PublicKey,
          t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR), 'T2 public key already in use');
    });
  });

  context('deregisterValidator()', async () => {

    it('a validator can be deregistered', async () => {
      const newValidator = validators[nextValidatorId];
      let t2TransactionId = testHelper.randomUint256();
      const registerValidatorHash = testHelper.hash(newValidator.t1PublicKey, newValidator.t2PublicKey)
      let confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await avnBridge.registerValidator(newValidator.t1PublicKey, newValidator.t2PublicKey, t2TransactionId, confirmations,
          FROM_ACTIVE_VALIDATOR);
      nextValidatorId++;
      let logArgs = await testHelper.getLogArgs(avnBridge, 'LogValidatorRegistered');

      t2TransactionId = testHelper.randomUint256();
      const deregisterValidatorHash = testHelper.hash(newValidator.t2PublicKey, newValidator.t1PublicKey);
      confirmations = await testHelper.getConfirmations(avnBridge, deregisterValidatorHash, t2TransactionId);
      await avnBridge.deregisterValidator(newValidator.t1PublicKey, newValidator.t2PublicKey, t2TransactionId, confirmations,
          FROM_ACTIVE_VALIDATOR);
      logArgs = await testHelper.getLogArgs(avnBridge, 'LogValidatorDeregistered');
      assert.equal(logArgs.t1PublicKeyLHS, newValidator.t1PublicKeyLHS);
      assert.equal(logArgs.t1PublicKeyRHS, newValidator.t1PublicKeyRHS);
      assert.equal(logArgs.t2PublicKey, newValidator.t2PublicKey);
      bnEquals(logArgs.t2TransactionId, t2TransactionId);
      numActiveValidators--;
      bnEquals(await avnBridge.numActiveValidators(), numActiveValidators);
    });

    it('cannot deregister an already dergistered validator', async () => {
      const newValidator = validators[nextValidatorId];
      let t2TransactionId = testHelper.randomUint256();
      const registerValidatorHash = testHelper.hash(newValidator.t1PublicKey, newValidator.t2PublicKey)
      let confirmations = await testHelper.getConfirmations(avnBridge, registerValidatorHash, t2TransactionId);
      await avnBridge.registerValidator(newValidator.t1PublicKey, newValidator.t2PublicKey, t2TransactionId, confirmations,
          FROM_ACTIVE_VALIDATOR);
      nextValidatorId++;
      t2TransactionId = testHelper.randomUint256();
      let deregisterValidatorHash = testHelper.hash(newValidator.t2PublicKey, newValidator.t1PublicKey);
      confirmations = await testHelper.getConfirmations(avnBridge, deregisterValidatorHash, t2TransactionId);
      await avnBridge.deregisterValidator(newValidator.t1PublicKey, newValidator.t2PublicKey, t2TransactionId, confirmations,
          FROM_ACTIVE_VALIDATOR);
      numActiveValidators--;
      t2TransactionId = testHelper.randomUint256();
      deregisterValidatorHash = testHelper.hash(newValidator.t2PublicKey, newValidator.t1PublicKey);
      confirmations = await testHelper.getConfirmations(avnBridge, deregisterValidatorHash, t2TransactionId);
      await testHelper.expectRevert(() => avnBridge.deregisterValidator(newValidator.t1PublicKey, newValidator.t2PublicKey,
          t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR), 'Validator is not registered');
    });

    it('validator functions are disabled', async () => {
      await avnBridge.toggleValidatorFunctions(false);
      let logArgs = await testHelper.getLogArgs(avnBridge, 'LogValidatorFunctionsAreEnabled');
      assert.equal(logArgs.state, false);
      const activeValidator = validators[1];
      const t2TransactionId = testHelper.randomUint256();
      const deregisterValidatorHash = testHelper.hash(activeValidator.t2PublicKey, activeValidator.t1PublicKey);
      const confirmations = await testHelper.getConfirmations(avnBridge, deregisterValidatorHash, t2TransactionId);
      await testHelper.expectRevert(() => avnBridge.deregisterValidator(activeValidator.t1PublicKey, activeValidator.t2PublicKey,
          t2TransactionId, confirmations, FROM_ACTIVE_VALIDATOR), 'Function currently disabled');
      await avnBridge.toggleValidatorFunctions(true);
      logArgs = await testHelper.getLogArgs(avnBridge, 'LogValidatorFunctionsAreEnabled');
      assert.equal(logArgs.state, true);
    });

    it('the account making the call is not registered', async () => {
      const activeValidator = validators[1];
      const t2TransactionId = testHelper.randomUint256();
      const deregisterValidatorHash = testHelper.hash(activeValidator.t2PublicKey, activeValidator.t1PublicKey);
      const confirmations = await testHelper.getConfirmations(avnBridge, deregisterValidatorHash, t2TransactionId);
      await testHelper.expectRevert(() => avnBridge.deregisterValidator(activeValidator.t1PublicKey, activeValidator.t2PublicKey,
          t2TransactionId, confirmations), 'Invalid confirmations');
    });
  });
});