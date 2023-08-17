const helper = require('./helpers/testHelper');
const { expect } = require('chai');

const GROWTH_DELAY = 100;

let avnBridge, token20;
let accounts, validators;
let owner, someOtherAccount, activeValidator, someT2PublicKey;
let numInitialValidators, numActiveValidators, nextValidatorId;

describe('AVNBridge', async () => {

  before(async () => {
    await helper.init();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000);
    avnBridge = await helper.deployAVNBridge(token20.address);
    accounts = helper.accounts();
    owner = helper.owner();
    someOtherAccount = accounts[1];
    someT2PublicKey = helper.someT2PublicKey();
    validators = helper.validators();
    activeValidator = validators[0].account;
    numInitialValidators = 6;
    numActiveValidators = numInitialValidators;
    nextValidatorId = numInitialValidators + 1;
    await helper.loadValidators(avnBridge, validators, numInitialValidators);
    await token20.setOwner(avnBridge.address);
  });

  context('setCoreOwner()', async () => {

    after(async () => {
      await token20.setOwner(avnBridge.address);
    });

    it('can set the core token owner via the avn bridge', async () => {
      expect(await token20.owner()).to.equal(avnBridge.address);
      await expect(avnBridge.setCoreOwner()).to.emit(token20, 'LogSetOwner').withArgs(owner);
      expect(await token20.owner()).to.equal(owner);
    });

    context('fails when', async () => {
      it('not called by the AVNBridge owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).setCoreOwner()).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  context('denyGrowth()', async () => {

    it('succeeds when called by the AVNBridge owner', async () => {
      await expect(avnBridge.denyGrowth(0)).to.emit(avnBridge, 'LogGrowthDenied').withArgs(0);
    });

    context('fails when', async () => {
      it('not called by the AVNBridge owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).denyGrowth(0)).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  context('setGrowthDelay()', async () => {
    it('can set the core token owner via the avn', async () => {
      const oldGrowthDelay = (await avnBridge.growthDelay()).toNumber();
      expect(60 * 60 * 24 * 7).to.equal(oldGrowthDelay);
      const newGrowthDelay = GROWTH_DELAY;
      await expect(avnBridge.setGrowthDelay(newGrowthDelay)).to.emit(avnBridge, 'LogGrowthDelayUpdated').withArgs(oldGrowthDelay, newGrowthDelay);
    });

    context('fails when', async () => {
      it('not called by the AVNBridge owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).setGrowthDelay(5))
            .to.be.revertedWith('Ownable: caller is not the owner');
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
      await expect(avnBridge.setQuorum(newQuorum)).to.emit(avnBridge, 'LogQuorumUpdated').withArgs(newQuorum);
    });

    context('fails when', async () => {
      it('numerator is greater than denominator', async () => {
        await expect(avnBridge.setQuorum([2,1])).to.be.revertedWithCustomError(avnBridge, 'InvalidQuorum');
      });
      it('numerator is zero', async () => {
        await expect(avnBridge.setQuorum([0,1])).to.be.revertedWithCustomError(avnBridge, 'InvalidQuorum');
      });
      it('denominator is zero', async () => {
        await expect(avnBridge.setQuorum([1,0])).to.be.revertedWithCustomError(avnBridge, 'InvalidQuorum');
      });
      it('not called by the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).setQuorum([2,3]))
            .to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  context('Growth', async () => {
    const growthAmount = helper.ONE_AVT_IN_ATTO.mul(ethers.BigNumber.from(3));

    async function getGrowthConfirmations(growthAmount, period, expiry, t2TransactionId) {
      const growthHash = helper.keccak256(ethers.utils.defaultAbiCoder.encode(['uint128', 'uint32'], [growthAmount, period]));
      return await helper.getConfirmations(avnBridge, growthHash, expiry, t2TransactionId);
    }

    it('fails to trigger zero growth', async () => {
      const zeroAmount = 0;
      const period = 1;
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(zeroAmount, period, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).triggerGrowth(zeroAmount, period, expiry, t2TransactionId, confirmations))
          .to.be.revertedWithCustomError(avnBridge, 'AmountCannotBeZero');
    });

    it('succeeds in triggering growth via validators', async () => {
      const period = 1;
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = 1;
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).triggerGrowth(growthAmount, period, expiry, t2TransactionId, confirmations))
          .to.emit(avnBridge, 'LogGrowthTriggered')
          .withArgs(growthAmount, period, await helper.getCurrentBlockTimestamp() + GROWTH_DELAY + 1, t2TransactionId);
    });

    it('fails to trigger growth with an invalid transaction ID', async () => {
      const period = 2;
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = 1;
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).triggerGrowth(growthAmount, period, expiry, t2TransactionId, confirmations))
          .to.be.revertedWithCustomError(avnBridge, 'TransactionIdAlreadyUsed');
    });

    it('fails to trigger growth with an expiry that has passed', async () => {
      const period = 2;
      const expiry = await helper.getCurrentBlockTimestamp() - 1;
      const t2TransactionId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).triggerGrowth(growthAmount, period, expiry, t2TransactionId, confirmations))
          .to.be.revertedWithCustomError(avnBridge, 'WindowHasExpired');
    });

    it('fails to trigger growth with InvalidConfirmations', async () => {
      const period = 2;
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = helper.randomT2TxId();
      const confirmations = "0xbadd";

      await expect(avnBridge.connect(activeValidator).triggerGrowth(growthAmount, period, expiry, t2TransactionId, confirmations))
          .to.be.revertedWithCustomError(avnBridge, 'InvalidConfirmations');
    });

    it('succeeds in releasing growth', async () => {
      const period = 1;
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      await helper.increaseBlockTimestamp(GROWTH_DELAY);
      await expect(avnBridge.connect(someOtherAccount).releaseGrowth(period)).to.emit(avnBridge, 'LogGrowth').withArgs(growthAmount, period);

      expect(avnBalanceBefore.add(growthAmount), await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore.add(growthAmount), await token20.totalSupply());
    });

    it('fails to release growth that has already been released', async () => {
      const period = 1;
      await helper.increaseBlockTimestamp(GROWTH_DELAY);
      await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'GrowthUnavailableForPeriod');
    });

    it('fails to release growth that has since been denied by the owner', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      const period = 2;
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TransactionId);

      await expect(avnBridge.connect(activeValidator).triggerGrowth(growthAmount, period, expiry, t2TransactionId, confirmations))
          .to.emit(avnBridge, 'LogGrowthTriggered')
          .withArgs(growthAmount, period, await helper.getCurrentBlockTimestamp() + GROWTH_DELAY + 1, t2TransactionId);

      await avnBridge.denyGrowth(period);

      await helper.increaseBlockTimestamp(GROWTH_DELAY);
      await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'GrowthUnavailableForPeriod');

      expect(avnBalanceBefore).to.equal(await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore).to.equal(await token20.totalSupply());
    });

    it('fails to release growth before its release time', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      const period = 3;
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TransactionId);

      await avnBridge.connect(activeValidator).triggerGrowth(growthAmount, period, expiry, t2TransactionId, confirmations);
      await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'ReleaseTimeNotPassed');
      expect(avnBalanceBefore).to.equal(await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore).to.equal(await token20.totalSupply());

      await helper.increaseBlockTimestamp(GROWTH_DELAY);
      await avnBridge.releaseGrowth(period);

      expect(avnBalanceBefore.add(growthAmount), await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore.add(growthAmount), await token20.totalSupply());
    });

    it('succeeds in triggering and releasing immediate growth', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      const period = 4;
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TransactionId);

      await avnBridge.setGrowthDelay(0);

      await expect(avnBridge.connect(activeValidator).triggerGrowth(growthAmount, period, expiry, t2TransactionId, confirmations)).to.emit(avnBridge, 'LogGrowth').withArgs(growthAmount, period);

      expect(avnBalanceBefore.add(growthAmount)).to.equal(await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore.add(growthAmount)).to.equal(await token20.totalSupply());
    });
  });

  context('publishRoot()', async () => {
    let rootHash, t2TransactionId;

    before(async () => {
      rootHash = helper.randomBytes32();
      t2TransactionId = helper.randomT2TxId();
    });

    it('validator can publish a root with valid confirmations', async () => {
      const expiry = await helper.getValidExpiry();
      const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, confirmations))
          .to.emit(avnBridge, 'LogRootPublished').withArgs(rootHash, t2TransactionId);
    });

    context('fails when', async () => {

      it('validator functions are disabled', async () => {
        await expect(avnBridge.toggleValidatorFunctions(false)).to.emit(avnBridge, 'LogValidatorFunctionsAreEnabled')
            .withArgs(false);
        const newT2TransactionId = helper.randomT2TxId();
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, newRootHash, expiry, newT2TransactionId);
        await expect(avnBridge.connect(activeValidator).publishRoot(newRootHash, expiry, newT2TransactionId, confirmations))
            .to.be.revertedWithCustomError(avnBridge, 'ValidatorFunctionsAreDisabled');
        await expect(avnBridge.toggleValidatorFunctions(true)).to.emit(avnBridge, 'LogValidatorFunctionsAreEnabled')
            .withArgs(true);
      });

      it('the expiry time has passed', async () => {
        const newT2TransactionId = helper.randomT2TxId();
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getCurrentBlockTimestamp() - 1;
        const confirmations = await helper.getConfirmations(avnBridge, newRootHash, expiry, newT2TransactionId);
        await expect(avnBridge.connect(activeValidator).publishRoot(newRootHash, expiry, newT2TransactionId, confirmations,))
            .to.be.revertedWithCustomError(avnBridge, 'WindowHasExpired');
      });

      it('the t2 transaction ID is not unique', async () => {
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, newRootHash, expiry, t2TransactionId);
        await expect(avnBridge.connect(activeValidator).publishRoot(newRootHash, expiry, t2TransactionId, confirmations,))
            .to.be.revertedWithCustomError(avnBridge, 'TransactionIdAlreadyUsed');
      });

      it('the root has already been published', async () => {
        const newT2TransactionId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, newT2TransactionId);
        await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, newT2TransactionId, confirmations))
            .to.be.revertedWithCustomError(avnBridge, 'RootHashAlreadyPublished');
      });

      it('the confirmations are invalid', async () => {
        t2TransactionId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations = '0xbadd' + helper.strip_0x(await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId));
        await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, confirmations))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidConfirmations');
      });

      it('there are no confirmations', async () => {
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, '0x'))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidConfirmations');
      });

      it('there are not enough confirmations', async () => {
        t2TransactionId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const numRequiredConfirmations = await helper.getNumRequiredConfirmations(avnBridge);
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId, -1);
        await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, confirmations))
            .to.be.revertedWithCustomError(avnBridge,  'InvalidConfirmations');
      });

      it('the confirmations are corrupted', async () => {
        t2TransactionId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId);
        confirmations = confirmations.replace(/1/g, '2');
        await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, confirmations))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidConfirmations');
      });

      it('the confirmations are not signed by registered validators', async () => {
        t2TransactionId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const startFromNonValidator = nextValidatorId;
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId, 0, startFromNonValidator);
        await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, confirmations))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidConfirmations');
      });

      it('the confirmations are not unique', async () => {
        t2TransactionId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const halfSet = Math.round(numActiveValidators/2);
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId, - halfSet);
        const duplicateConfirmations = confirmations + helper.strip_0x(confirmations);
        await expect(avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, duplicateConfirmations,))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidConfirmations');
      });
    });
  });

  context('registerValidator()', async () => {

    it('a new validator can be registered', async () => {
      const numActiveValidatorsBefore = await avnBridge.numActiveValidators();

      const newValidator = validators[nextValidatorId];
      let t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [newValidator.t1PublicKey, newValidator.t2PublicKey]);
      let expiry = await helper.getValidExpiry();
      let confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).registerValidator(newValidator.t1PublicKey, newValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations)).to.emit(avnBridge, 'LogValidatorRegistered')
          .withArgs(newValidator.t1Address, newValidator.t2PublicKey, t2TransactionId);
      expect(await avnBridge.idToT1Address(nextValidatorId)).to.equal(newValidator.t1Address);

      // The validator is registered but not active
      expect(numActiveValidatorsBefore, await avnBridge.numActiveValidators());
      expect(await avnBridge.isActiveValidator(nextValidatorId), false);

      // Publishing a root containing a confirmation from the new validator activates the validator
      rootHash = helper.randomBytes32();
      expiry = await helper.getValidExpiry();
      t2TransactionId = helper.randomT2TxId();
      confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId);
      newValidatorConfirmation = await helper.getSingleConfirmation(avnBridge, rootHash, expiry, t2TransactionId, newValidator);
      const confirmationsIncludingNewValidator = newValidatorConfirmation + confirmations.substring(132);
      await avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, confirmationsIncludingNewValidator);

      expect(numActiveValidatorsBefore.add(ethers.BigNumber.from(1))).to.equal(await avnBridge.numActiveValidators());
      expect(await avnBridge.isActiveValidator(nextValidatorId)).to.equal(true);
      nextValidatorId++;
      numActiveValidators++;
    });

    it('a validator cannot be registered with an empty t1 public key', async () => {
      const prospectValidator = validators[nextValidatorId];
      const emptyKey = '0x';
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [emptyKey, prospectValidator.t2PublicKey]);
      const confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).registerValidator(emptyKey, prospectValidator.t2PublicKey,
        expiry, t2TransactionId, confirmations)).to.be.revertedWithCustomError(avnBridge, 'InvalidT1PublicKey');
    });

    it('a validator cannot be registered if the expiry time has passed', async () => {
      const prospectValidator = validators[nextValidatorId];
      const expiry = await helper.getCurrentBlockTimestamp() - 1;
      const t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [prospectValidator.t1PublicKey, prospectValidator.t2PublicKey]);
      const confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).registerValidator(prospectValidator.t1PublicKey, prospectValidator.t2PublicKey,
        expiry, t2TransactionId, confirmations)).to.be.revertedWithCustomError(avnBridge, 'WindowHasExpired');
    });

    it('an existing active validator cannot be re-registered', async () => {
      const existingValidator = validators[1];
      const expiry = await helper.getValidExpiry();
      const t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = helper.keccak256(existingValidator.t1PublicKey, existingValidator.t2PublicKey);
      const confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).registerValidator(existingValidator.t1PublicKey,
          existingValidator.t2PublicKey, expiry, t2TransactionId, confirmations))
          .to.be.revertedWithCustomError(avnBridge, 'ValidatorAlreadyRegistered');
    });

    it('an existing deregistered validator cannot be re-registered with a different public key', async () => {
      const existingValidator = validators[numActiveValidators];
      let expiry = await helper.getValidExpiry();
      let t2TransactionId = helper.randomT2TxId();
      const deregisterValidatorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [existingValidator.t2PublicKey, existingValidator.t1PublicKey]);
      let confirmations = await helper.getConfirmations(avnBridge, deregisterValidatorHash, expiry, t2TransactionId);
      await avnBridge.connect(activeValidator).deregisterValidator(existingValidator.t1PublicKey, existingValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations);
      numActiveValidators--;

      const newValidator = validators[nextValidatorId];
      expiry = await helper.getValidExpiry();
      t2TransactionId = helper.randomT2TxId();
      let registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [existingValidator.t1PublicKey, newValidator.t2PublicKey]);
      confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).registerValidator(existingValidator.t1PublicKey, newValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations)).to.be.revertedWithCustomError(avnBridge, 'CannotChangeT2PublicKey');

      t2TransactionId = helper.randomT2TxId();
      registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [existingValidator.t1PublicKey, existingValidator.t2PublicKey]);
      confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await avnBridge.connect(activeValidator).registerValidator(existingValidator.t1PublicKey, existingValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations);
    });

    it('validators cannot be registered with a T2 public key that is already in use', async () => {
      const prospectValidator = validators[nextValidatorId];
      const existingValidator = validators[1];
      const t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [prospectValidator.t1PublicKey, existingValidator.t2PublicKey]);
      const expiry = await helper.getValidExpiry();
      const confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).registerValidator(prospectValidator.t1PublicKey,
        existingValidator.t2PublicKey, expiry, t2TransactionId, confirmations))
        .to.be.revertedWithCustomError(avnBridge, 'T2PublicKeyAlreadyInUse');
    });
  });

  context('deregisterValidator()', async () => {

    it('a validator can be registered, activated and deregistered', async () => {
      let numActiveValidatorsBeforeRegistration = await avnBridge.numActiveValidators();
      expect(await avnBridge.nextValidatorId()).to.equal(nextValidatorId);
      const newValidator = validators[nextValidatorId];
      let expiry = await helper.getValidExpiry();
      let t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [newValidator.t1PublicKey, newValidator.t2PublicKey]);
      let confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await avnBridge.connect(activeValidator).registerValidator(newValidator.t1PublicKey, newValidator.t2PublicKey, expiry, t2TransactionId,
          confirmations);
      nextValidatorId++;
      expect(await avnBridge.nextValidatorId()).to.equal(nextValidatorId);
      expect(await avnBridge.numActiveValidators()).to.equal(numActiveValidatorsBeforeRegistration);

      // Publishing a root with a confirmation from the newly registered validator activates them
      expiry = await helper.getValidExpiry();
      t2TransactionId = helper.randomT2TxId();
      const rootHash = helper.randomBytes32();
      confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TransactionId);
      const newValidatorConfirmation = await helper.getSingleConfirmation(avnBridge, rootHash, expiry, t2TransactionId, newValidator);
      const confirmationsIncludingNewValidator = newValidatorConfirmation + confirmations.substring(132);
      await avnBridge.connect(activeValidator).publishRoot(rootHash, expiry, t2TransactionId, confirmationsIncludingNewValidator);
      expect(await avnBridge.numActiveValidators()).to.equal(numActiveValidatorsBeforeRegistration.add(1));

      expiry = await helper.getValidExpiry();
      t2TransactionId = helper.randomT2TxId();
      const deregisterValidatorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [newValidator.t2PublicKey, newValidator.t1PublicKey]);
      confirmations = await helper.getConfirmations(avnBridge, deregisterValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).deregisterValidator(newValidator.t1PublicKey, newValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations)).to.emit(avnBridge, 'LogValidatorDeregistered')
          .withArgs(newValidator.t1Address, newValidator.t2PublicKey, t2TransactionId);

      expect(await avnBridge.nextValidatorId()).to.equal(nextValidatorId);
      expect(await avnBridge.numActiveValidators()).to.equal(numActiveValidatorsBeforeRegistration);
    });

    it('a validator can be registered and deregistered without being activated', async () => {
      const numActiveValidatorsBeforeRegistration = await avnBridge.numActiveValidators();
      expect(await avnBridge.nextValidatorId()).to.equal(nextValidatorId);
      const newValidator = validators[nextValidatorId];
      let t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [newValidator.t1PublicKey, newValidator.t2PublicKey]);
      let expiry = await helper.getValidExpiry();
      let confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await avnBridge.connect(activeValidator).registerValidator(newValidator.t1PublicKey, newValidator.t2PublicKey, expiry, t2TransactionId,
          confirmations);
      nextValidatorId++;
      expect(await avnBridge.nextValidatorId()).to.equal(nextValidatorId);
      expect(await avnBridge.numActiveValidators()).to.equal(numActiveValidatorsBeforeRegistration);

      t2TransactionId = helper.randomT2TxId();
      const deregisterValidatorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [newValidator.t2PublicKey, newValidator.t1PublicKey]);
      expiry = await helper.getValidExpiry();
      confirmations = await helper.getConfirmations(avnBridge, deregisterValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).deregisterValidator(newValidator.t1PublicKey, newValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations)).to.emit(avnBridge, 'LogValidatorDeregistered')
          .withArgs(newValidator.t1Address, newValidator.t2PublicKey, t2TransactionId);

      expect(await avnBridge.nextValidatorId()).to.equal(nextValidatorId);
      expect(await avnBridge.numActiveValidators()).to.equal(numActiveValidatorsBeforeRegistration);
    });

    it('cannot deregister an already deregistered validator', async () => {
      const newValidator = validators[nextValidatorId];
      let t2TransactionId = helper.randomT2TxId();
      const registerValidatorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [newValidator.t1PublicKey, newValidator.t2PublicKey]);
      let expiry = await helper.getValidExpiry();
      let confirmations = await helper.getConfirmations(avnBridge, registerValidatorHash, expiry, t2TransactionId);
      await avnBridge.connect(activeValidator).registerValidator(newValidator.t1PublicKey, newValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations);
      nextValidatorId++;
      t2TransactionId = helper.randomT2TxId();
      expiry = await helper.getValidExpiry();
      let deregisterValidatorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [newValidator.t2PublicKey, newValidator.t1PublicKey]);
      confirmations = await helper.getConfirmations(avnBridge, deregisterValidatorHash, expiry, t2TransactionId);
      await avnBridge.connect(activeValidator).deregisterValidator(newValidator.t1PublicKey, newValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations);
      numActiveValidators--;
      t2TransactionId = helper.randomT2TxId();
      expiry = await helper.getValidExpiry();
      deregisterValidatorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'],
          [newValidator.t2PublicKey, newValidator.t1PublicKey]);
      confirmations = await helper.getConfirmations(avnBridge, deregisterValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).deregisterValidator(newValidator.t1PublicKey, newValidator.t2PublicKey,
          expiry, t2TransactionId, confirmations)).to.be.revertedWithCustomError(avnBridge, 'ValidatorNotRegistered');
    });

    it('validator functions are disabled', async () => {
      await expect(avnBridge.toggleValidatorFunctions(false)).to.emit(avnBridge, 'LogValidatorFunctionsAreEnabled')
          .withArgs(false);
      const t2TransactionId = helper.randomT2TxId();
      const deregisterValidatorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [validators[0].t2PublicKey,
          validators[0].t1PublicKey]);
      const expiry = await helper.getValidExpiry();
      const confirmations = await helper.getConfirmations(avnBridge, deregisterValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.connect(activeValidator).deregisterValidator(validators[0].t1PublicKey, validators[0].t2PublicKey,
          expiry, t2TransactionId, confirmations)).to.be.revertedWithCustomError(avnBridge, 'ValidatorFunctionsAreDisabled');
      await expect(avnBridge.toggleValidatorFunctions(true)).to.emit(avnBridge, 'LogValidatorFunctionsAreEnabled')
          .withArgs(true);

    });

    it('the expiry time for the call has passed', async () => {
      const expiry = await helper.getCurrentBlockTimestamp() - 1;
      const t2TransactionId = helper.randomT2TxId();
      const deregisterValidatorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [validators[0].t2PublicKey,
          validators[0].t1PublicKey]);
      const confirmations = await helper.getConfirmations(avnBridge, deregisterValidatorHash, expiry, t2TransactionId);
      await expect(avnBridge.deregisterValidator(validators[0].t1PublicKey, validators[0].t2PublicKey, expiry, t2TransactionId,
          confirmations)).to.be.revertedWithCustomError(avnBridge, 'WindowHasExpired');
    });
  });
});