const helper = require('./helpers/testHelper');
const { expect } = require('chai');

const GROWTH_DELAY = 100;

let avnBridge, token20;
let accounts, authors;
let owner, someOtherAccount, activeAuthor, someT2PubKey;
let numInitialAuthors, numActiveAuthors, nextAuthorId;

describe('AVNBridge', async () => {
  before(async () => {
    await helper.init();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000);
    avnBridge = await helper.deployAVNBridge(token20.address);
    accounts = helper.accounts();
    owner = helper.owner();
    someOtherAccount = accounts[1];
    someT2PubKey = helper.someT2PubKey();
    authors = helper.authors();
    activeAuthor = authors[0].account;
    numInitialAuthors = 6;
    numActiveAuthors = numInitialAuthors;
    nextAuthorId = numInitialAuthors + 1;
    await helper.loadAuthors(avnBridge, authors, numInitialAuthors);
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
      await expect(avnBridge.setGrowthDelay(newGrowthDelay))
        .to.emit(avnBridge, 'LogGrowthDelayUpdated')
        .withArgs(oldGrowthDelay, newGrowthDelay);
    });

    context('fails when', async () => {
      it('not called by the AVNBridge owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).setGrowthDelay(5)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });

  context('Growth', async () => {
    const growthAmount = helper.ONE_AVT_IN_ATTO.mul(ethers.BigNumber.from(3));

    async function getGrowthConfirmations(growthAmount, period, expiry, t2TxId) {
      const growthHash = helper.keccak256(ethers.utils.defaultAbiCoder.encode(['uint128', 'uint32'], [growthAmount, period]));
      return await helper.getConfirmations(avnBridge, growthHash, expiry, t2TxId);
    }

    it('fails to trigger zero growth', async () => {
      const zeroAmount = 0;
      const period = 1;
      const expiry = await helper.getValidExpiry();
      const t2TxId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(zeroAmount, period, expiry, t2TxId);
      await expect(
        avnBridge.connect(activeAuthor).triggerGrowth(zeroAmount, period, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
    });

    it('succeeds in triggering growth via authors', async () => {
      const period = 1;
      const expiry = await helper.getValidExpiry();
      const t2TxId = 1;
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TxId);
      await expect(avnBridge.connect(activeAuthor).triggerGrowth(growthAmount, period, expiry, t2TxId, confirmations))
        .to.emit(avnBridge, 'LogGrowthTriggered')
        .withArgs(growthAmount, period, (await helper.getCurrentBlockTimestamp()) + GROWTH_DELAY + 1, t2TxId);
    });

    it('fails to trigger growth with an invalid transaction ID', async () => {
      const period = 2;
      const expiry = await helper.getValidExpiry();
      const t2TxId = 1;
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TxId);
      await expect(
        avnBridge.connect(activeAuthor).triggerGrowth(growthAmount, period, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'TxIdIsUsed');
    });

    it('fails to trigger growth with an expiry that has passed', async () => {
      const period = 2;
      const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
      const t2TxId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TxId);
      await expect(
        avnBridge.connect(activeAuthor).triggerGrowth(growthAmount, period, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
    });

    it('fails to trigger growth with BadConfirmations', async () => {
      const period = 2;
      const expiry = await helper.getValidExpiry();
      const t2TxId = helper.randomT2TxId();
      const confirmations = '0xbadd';

      await expect(
        avnBridge.connect(activeAuthor).triggerGrowth(growthAmount, period, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
    });

    it('succeeds in releasing growth', async () => {
      const period = 1;
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      await helper.increaseBlockTimestamp(GROWTH_DELAY);
      await expect(avnBridge.connect(someOtherAccount).releaseGrowth(period))
        .to.emit(avnBridge, 'LogGrowth')
        .withArgs(growthAmount, period);

      expect(avnBalanceBefore.add(growthAmount), await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore.add(growthAmount), await token20.totalSupply());
    });

    it('fails to release growth that has already been released', async () => {
      const period = 1;
      await helper.increaseBlockTimestamp(GROWTH_DELAY);
      await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'GrowthUnavailable');
    });

    it('fails to release growth that has since been denied by the owner', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      const period = 2;
      const expiry = await helper.getValidExpiry();
      const t2TxId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TxId);

      await expect(avnBridge.connect(activeAuthor).triggerGrowth(growthAmount, period, expiry, t2TxId, confirmations))
        .to.emit(avnBridge, 'LogGrowthTriggered')
        .withArgs(growthAmount, period, (await helper.getCurrentBlockTimestamp()) + GROWTH_DELAY + 1, t2TxId);

      await avnBridge.denyGrowth(period);

      await helper.increaseBlockTimestamp(GROWTH_DELAY);
      await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'GrowthUnavailable');

      expect(avnBalanceBefore).to.equal(await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore).to.equal(await token20.totalSupply());
    });

    it('fails to release growth before its release time', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      const period = 3;
      const expiry = await helper.getValidExpiry();
      const t2TxId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TxId);

      await avnBridge.connect(activeAuthor).triggerGrowth(growthAmount, period, expiry, t2TxId, confirmations);
      await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'NotReady');
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
      const t2TxId = helper.randomT2TxId();
      const confirmations = await getGrowthConfirmations(growthAmount, period, expiry, t2TxId);

      await avnBridge.setGrowthDelay(0);

      const nextBlockTimestamp = (await helper.getCurrentBlockTimestamp()) + 1;
      await expect(avnBridge.connect(activeAuthor).triggerGrowth(growthAmount, period, expiry, t2TxId, confirmations))
        .to.emit(avnBridge, 'LogGrowthTriggered')
        .withArgs(growthAmount, period, nextBlockTimestamp, t2TxId)
        .to.emit(avnBridge, 'LogGrowth')
        .withArgs(growthAmount, period);

      expect(avnBalanceBefore.add(growthAmount)).to.equal(await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore.add(growthAmount)).to.equal(await token20.totalSupply());
    });
  });

  context('publishRoot()', async () => {
    let rootHash, t2TxId;

    before(async () => {
      rootHash = helper.randomBytes32();
      t2TxId = helper.randomT2TxId();
    });

    it('author can publish a root with valid confirmations', async () => {
      const expiry = await helper.getValidExpiry();
      const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TxId);
      await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations))
        .to.emit(avnBridge, 'LogRootPublished')
        .withArgs(rootHash, t2TxId);
    });

    context('fails when', async () => {
      it('author functions are disabled', async () => {
        await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
        const newt2TxId = helper.randomT2TxId();
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, newRootHash, expiry, newt2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
        await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the expiry time has passed', async () => {
        const newt2TxId = helper.randomT2TxId();
        const newRootHash = helper.randomBytes32();
        const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
        const confirmations = await helper.getConfirmations(avnBridge, newRootHash, expiry, newt2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
      });

      it('the t2 transaction ID is not unique', async () => {
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, newRootHash, expiry, t2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'TxIdIsUsed');
      });

      it('the root has already been published', async () => {
        const newt2TxId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, newt2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, newt2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'RootHashIsUsed');
      });

      it('the confirmations are invalid', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations =
          '0xbadd' + helper.strip_0x(await helper.getConfirmations(avnBridge, rootHash, expiry, t2TxId));
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('there are no confirmations', async () => {
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, '0x')
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('there are not enough confirmations', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const numRequiredConfirmations = await helper.getNumRequiredConfirmations(avnBridge);
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TxId, -1);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('the confirmations are corrupted', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TxId);
        confirmations = confirmations.replace(/1/g, '2');
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('the confirmations are not signed by active authors', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const startFromNonAuthor = nextAuthorId;
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          rootHash,
          expiry,
          t2TxId,
          0,
          startFromNonAuthor
        );
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('the confirmations are not unique', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const halfSet = Math.round(numActiveAuthors / 2);
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TxId, -halfSet);
        const duplicateConfirmations = confirmations + helper.strip_0x(confirmations);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, duplicateConfirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });
    });
  });

  context('addAuthor()', async () => {
    it('a new author can be added', async () => {
      const numActiveAuthorsBefore = await avnBridge.numActiveAuthors();

      const newAuthor = authors[nextAuthorId];
      let t2TxId = helper.randomT2TxId();
      const addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [newAuthor.t1PubKey, newAuthor.t2PubKey]
      );
      let expiry = await helper.getValidExpiry();
      let confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
      )
        .to.emit(avnBridge, 'LogAuthorAdded')
        .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);
      expect(await avnBridge.idToT1Address(nextAuthorId)).to.equal(newAuthor.t1Address);

      // The author has been added but is not active
      expect(numActiveAuthorsBefore, await avnBridge.numActiveAuthors());
      expect(await avnBridge.authorIsActive(nextAuthorId), false);

      // Publishing a root containing a confirmation from the new author activates the author
      rootHash = helper.randomBytes32();
      expiry = await helper.getValidExpiry();
      t2TxId = helper.randomT2TxId();
      confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TxId);
      newAuthorConfirmation = await helper.getSingleConfirmation(avnBridge, rootHash, expiry, t2TxId, newAuthor);
      const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
      await avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);

      expect(numActiveAuthorsBefore.add(ethers.BigNumber.from(1))).to.equal(await avnBridge.numActiveAuthors());
      expect(await avnBridge.authorIsActive(nextAuthorId)).to.equal(true);
      nextAuthorId++;
      numActiveAuthors++;
    });

    it('an author cannot be added with an empty t1 public key', async () => {
      const prospectAuthor = authors[nextAuthorId];
      const emptyKey = '0x';
      const expiry = await helper.getValidExpiry();
      const t2TxId = helper.randomT2TxId();
      const addAuthorHash = ethers.utils.solidityKeccak256(['bytes', 'bytes32'], [emptyKey, prospectAuthor.t2PubKey]);
      const confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge.connect(activeAuthor).addAuthor(emptyKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'InvalidT1Key');
    });

    it('an author cannot be added if the expiry time has passed', async () => {
      const prospectAuthor = authors[nextAuthorId];
      const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
      const t2TxId = helper.randomT2TxId();
      const addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [prospectAuthor.t1PubKey, prospectAuthor.t2PubKey]
      );
      const confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .addAuthor(prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
    });

    it('an existing active author cannot be re-added', async () => {
      const existingAuthor = authors[1];
      const expiry = await helper.getValidExpiry();
      const t2TxId = helper.randomT2TxId();
      const addAuthorHash = helper.keccak256(existingAuthor.t1PubKey, existingAuthor.t2PubKey);
      const confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'AlreadyAdded');
    });

    it('an existing author who was removed cannot be re-added with a different public key', async () => {
      const existingAuthor = authors[numActiveAuthors];
      let expiry = await helper.getValidExpiry();
      let t2TxId = helper.randomT2TxId();
      const removeAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [existingAuthor.t2PubKey, existingAuthor.t1PubKey]
      );
      let confirmations = await helper.getConfirmations(avnBridge, removeAuthorHash, expiry, t2TxId);
      await avnBridge
        .connect(activeAuthor)
        .removeAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations);
      numActiveAuthors--;

      const newAuthor = authors[nextAuthorId];
      expiry = await helper.getValidExpiry();
      t2TxId = helper.randomT2TxId();
      let addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [existingAuthor.t1PubKey, newAuthor.t2PubKey]
      );
      confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .addAuthor(existingAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'CannotChangeT2Key');

      t2TxId = helper.randomT2TxId();
      addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [existingAuthor.t1PubKey, existingAuthor.t2PubKey]
      );
      confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await avnBridge
        .connect(activeAuthor)
        .addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations);
    });

    it('an author cannot be added with a T2 public key that is already in use', async () => {
      const prospectAuthor = authors[nextAuthorId];
      const existingAuthor = authors[1];
      const t2TxId = helper.randomT2TxId();
      const addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [prospectAuthor.t1PubKey, existingAuthor.t2PubKey]
      );
      const expiry = await helper.getValidExpiry();
      const confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .addAuthor(prospectAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'T2KeyInUse');
    });
  });

  context('removeAuthor()', async () => {
    it('an author can be added, activated and removed', async () => {
      let numActiveAuthorsBeforeAddition = await avnBridge.numActiveAuthors();
      expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
      const newAuthor = authors[nextAuthorId];
      let expiry = await helper.getValidExpiry();
      let t2TxId = helper.randomT2TxId();
      const addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [newAuthor.t1PubKey, newAuthor.t2PubKey]
      );
      let confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await avnBridge
        .connect(activeAuthor)
        .addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
      nextAuthorId++;
      expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
      expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

      // Publishing a root with a confirmation from the newly added author activates them
      expiry = await helper.getValidExpiry();
      t2TxId = helper.randomT2TxId();
      const rootHash = helper.randomBytes32();
      confirmations = await helper.getConfirmations(avnBridge, rootHash, expiry, t2TxId);
      const newAuthorConfirmation = await helper.getSingleConfirmation(avnBridge, rootHash, expiry, t2TxId, newAuthor);
      const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
      await avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);
      expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition.add(1));

      expiry = await helper.getValidExpiry();
      t2TxId = helper.randomT2TxId();
      const removeAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [newAuthor.t2PubKey, newAuthor.t1PubKey]
      );
      confirmations = await helper.getConfirmations(avnBridge, removeAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .removeAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
      )
        .to.emit(avnBridge, 'LogAuthorRemoved')
        .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

      expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
      expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);
    });

    it('an author can be added and removed without being activated', async () => {
      const numActiveAuthorsBeforeAddition = await avnBridge.numActiveAuthors();
      expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
      const newAuthor = authors[nextAuthorId];
      let t2TxId = helper.randomT2TxId();
      const addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [newAuthor.t1PubKey, newAuthor.t2PubKey]
      );
      let expiry = await helper.getValidExpiry();
      let confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await avnBridge
        .connect(activeAuthor)
        .addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
      nextAuthorId++;
      expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
      expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

      t2TxId = helper.randomT2TxId();
      const removeAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [newAuthor.t2PubKey, newAuthor.t1PubKey]
      );
      expiry = await helper.getValidExpiry();
      confirmations = await helper.getConfirmations(avnBridge, removeAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .removeAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
      )
        .to.emit(avnBridge, 'LogAuthorRemoved')
        .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

      expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
      expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);
    });

    it('cannot remove an author who has already been removed', async () => {
      const newAuthor = authors[nextAuthorId];
      let t2TxId = helper.randomT2TxId();
      const addAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes', 'bytes32'],
        [newAuthor.t1PubKey, newAuthor.t2PubKey]
      );
      let expiry = await helper.getValidExpiry();
      let confirmations = await helper.getConfirmations(avnBridge, addAuthorHash, expiry, t2TxId);
      await avnBridge
        .connect(activeAuthor)
        .addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
      nextAuthorId++;
      t2TxId = helper.randomT2TxId();
      expiry = await helper.getValidExpiry();
      let removeAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [newAuthor.t2PubKey, newAuthor.t1PubKey]
      );
      confirmations = await helper.getConfirmations(avnBridge, removeAuthorHash, expiry, t2TxId);
      await avnBridge
        .connect(activeAuthor)
        .removeAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
      numActiveAuthors--;
      t2TxId = helper.randomT2TxId();
      expiry = await helper.getValidExpiry();
      removeAuthorHash = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [newAuthor.t2PubKey, newAuthor.t1PubKey]);
      confirmations = await helper.getConfirmations(avnBridge, removeAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .removeAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'NotAnAuthor');
    });

    it('authors are disabled', async () => {
      await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
      const t2TxId = helper.randomT2TxId();
      const removeAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [authors[0].t2PubKey, authors[0].t1PubKey]
      );
      const expiry = await helper.getValidExpiry();
      const confirmations = await helper.getConfirmations(avnBridge, removeAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge
          .connect(activeAuthor)
          .removeAuthor(authors[0].t1PubKey, authors[0].t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
      await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
    });

    it('the expiry time for the call has passed', async () => {
      const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
      const t2TxId = helper.randomT2TxId();
      const removeAuthorHash = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [authors[0].t2PubKey, authors[0].t1PubKey]
      );
      const confirmations = await helper.getConfirmations(avnBridge, removeAuthorHash, expiry, t2TxId);
      await expect(
        avnBridge.removeAuthor(authors[0].t1PubKey, authors[0].t2PubKey, expiry, t2TxId, confirmations)
      ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
    });
  });
});
