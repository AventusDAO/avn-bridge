const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token20;
let accounts, authors;
let someOtherAccount, activeAuthor;
let numActiveAuthors, nextAuthorId;

describe('Author Functions', async () => {
  before(async () => {
    await helper.init();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000);
    avnBridge = await helper.deployAVNBridge(token20.address);
    accounts = helper.accounts();
    someOtherAccount = accounts[1];
    authors = helper.authors();
    activeAuthor = authors[0].account;
    let numInitialAuthors = 6;
    numActiveAuthors = numInitialAuthors;
    nextAuthorId = numInitialAuthors + 1;
    await helper.loadAuthors(avnBridge, authors, numInitialAuthors);
    await token20.setOwner(avnBridge.address);
  });

  context('Growth', async () => {
    let rewards, avgStaked, period, expiry, t2TxId;
    let usedGrowthPeriod, usedTxId;

    before(async () => {
      await avnBridge.setGrowthDelay(helper.GROWTH_DELAY);
      period = 0;
      t2TxId = 0;
    });

    beforeEach(async () => {
      const randomRewards =  Math. floor((Math. random() * 1000000) + 1);
      const randomAvgStaked =  Math. floor((Math. random() * 1000000) + 1);
      rewards = helper.ONE_AVT_IN_ATTO.mul(ethers.BigNumber.from(randomRewards));
      avgStaked = helper.ONE_AVT_IN_ATTO.mul(ethers.BigNumber.from(randomAvgStaked));
      period++;
      t2TxId++;
      expiry = await helper.getValidExpiry();
    });

    async function getGrowthConfirmations(rewards, avgStaked, period, expiry, t2TxId) {
      return await helper.getConfirmations(avnBridge, 'triggerGrowth', [rewards, avgStaked, period], expiry, t2TxId);
    }

    context('(via owner)', async () => {
      const ZERO_TXID = 0; // Owner can pass zero for T2 TX ID
      const NO_CONFIRMATIONS = '0x'; // Owner can pass empty bytes for confirmations

      context('succeeds', async () => {
        it('in triggering and releasing growth', async () => {
          const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
          const avtSupplyBefore = await token20.totalSupply();
          const expectedGrowthAmount = rewards.mul(avtSupplyBefore).div(avgStaked);

          await expect(avnBridge.triggerGrowth(rewards, avgStaked, period, expiry, ZERO_TXID, NO_CONFIRMATIONS))
            .to.emit(avnBridge, 'LogGrowth')
            .withArgs(expectedGrowthAmount, period);

          expect(avnBalanceBefore.add(expectedGrowthAmount)).to.equal(await token20.balanceOf(avnBridge.address));
          expect(avtSupplyBefore.add(expectedGrowthAmount)).to.equal(await token20.totalSupply());
          usedGrowthPeriod = period;
        });

        it('if the t2TxId is passed it gets ignored', async () => {
          await expect(avnBridge.triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, NO_CONFIRMATIONS));
          expect(await avnBridge.isUsedT2TxId(t2TxId), false);
        });
      });

      context('fails', async () => {
        it('to trigger and release growth when rewards are zero', async () => {
          await expect(
            avnBridge.triggerGrowth(0, avgStaked, period, expiry, ZERO_TXID, NO_CONFIRMATIONS)
          ).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
        });

        it('to trigger and release growth when average staked is zero', async () => {
          await expect(
            avnBridge.triggerGrowth(rewards, 0, period, expiry, ZERO_TXID, NO_CONFIRMATIONS)
          ).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
        });

        it('to trigger and release growth if called without confirmations by someone other than the owner', async () => {
          await expect(
            avnBridge.connect(someOtherAccount).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, NO_CONFIRMATIONS)
          ).to.be.revertedWithCustomError(avnBridge, 'OwnerOnly');

          await expect(
            avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, NO_CONFIRMATIONS)
          ).to.be.revertedWithCustomError(avnBridge, 'OwnerOnly');
        });

        it('to re-trigger growth for an existing period', async () => {
          const expiry = await helper.getValidExpiry();
          await expect(
            avnBridge.triggerGrowth(rewards, avgStaked, usedGrowthPeriod, expiry, ZERO_TXID, NO_CONFIRMATIONS)
          ).to.be.revertedWithCustomError(avnBridge, 'PeriodIsUsed');
        });
      });
    });

    context('(via authors)', async () => {
      context('succeeds', async () => {
        it('in triggering growth', async () => {
          const avtSupplyBefore = await token20.totalSupply();
          const confirmations = await getGrowthConfirmations(rewards, avgStaked, period, expiry, t2TxId);
          const expectedGrowthAmount = rewards.mul(avtSupplyBefore).div(avgStaked);
          await expect(avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, confirmations))
            .to.emit(avnBridge, 'LogGrowthTriggered')
            .withArgs(expectedGrowthAmount, period, (await helper.getCurrentBlockTimestamp()) + helper.GROWTH_DELAY + 1, t2TxId);
          expect(await avnBridge.isUsedT2TxId(t2TxId), true);
          usedGrowthPeriod = period;
          usedTxId = t2TxId;
        });
      });

      context('fails', async () => {
        it('when author functions are disabled', async () => {
          await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
          const confirmations = await getGrowthConfirmations(rewards, avgStaked, period, expiry, t2TxId);
          await expect(
            avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, confirmations)
          ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
          await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
        });

        it('to trigger growth when rewards are zero', async () => {
          const confirmations = await getGrowthConfirmations(0, avgStaked, period, expiry, t2TxId);
          await expect(
            avnBridge.connect(activeAuthor).triggerGrowth(0, avgStaked, period, expiry, t2TxId, confirmations)
          ).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
        });

        it('to trigger growth when average staked is zero', async () => {
          const confirmations = await getGrowthConfirmations(rewards, 0, period, expiry, t2TxId);
          await expect(
            avnBridge.connect(activeAuthor).triggerGrowth(rewards, 0, period, expiry, t2TxId, confirmations)
          ).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
        });

        it('to trigger growth with an invalid T2 transaction ID', async () => {
          const confirmations = await getGrowthConfirmations(rewards, avgStaked, period, expiry, usedTxId);
          await expect(
            avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, usedTxId, confirmations)
          ).to.be.revertedWithCustomError(avnBridge, 'TxIdIsUsed');
        });

        it('to trigger growth when the expiry has has passed', async () => {
          expiry = (await helper.getCurrentBlockTimestamp()) - 1;
          const confirmations = await getGrowthConfirmations(rewards, avgStaked, period, expiry, t2TxId);
          await expect(
            avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, confirmations)
          ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
        });

        it('to trigger growth with invalid confirmations', async () => {
          const confirmations = '0xbadd';
          await expect(
            avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, confirmations)
          ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
        });
      });

      context('succeeds', async () => {
        it('in releasing growth for an existing period', async () => {
          const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
          const avtSupplyBefore = await token20.totalSupply();
          const growthAmountForPeriod = await avnBridge.growthAmount(usedGrowthPeriod);

          await helper.increaseBlockTimestamp(helper.GROWTH_DELAY);
          await expect(avnBridge.connect(someOtherAccount).releaseGrowth(usedGrowthPeriod))
            .to.emit(avnBridge, 'LogGrowth')
            .withArgs(growthAmountForPeriod, usedGrowthPeriod);

          expect(avnBalanceBefore.add(growthAmountForPeriod), await token20.balanceOf(avnBridge.address));
          expect(avtSupplyBefore.add(growthAmountForPeriod), await token20.totalSupply());
        });
      });

      context('fails', async () => {
        it('to release growth that has already been released', async () => {
          await helper.increaseBlockTimestamp(helper.GROWTH_DELAY);
          await expect(avnBridge.releaseGrowth(usedGrowthPeriod)).to.be.revertedWithCustomError(avnBridge, 'GrowthUnavailable');
        });

        it('to release growth for a period that has since been denied by the owner', async () => {
          const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
          const avtSupplyBefore = await token20.totalSupply();
          const expectedGrowthAmount = rewards.mul(avtSupplyBefore).div(avgStaked); // recalculate this as it will have changed
          const confirmations = await getGrowthConfirmations(rewards, avgStaked, period, expiry, t2TxId);

          await expect(avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, confirmations))
            .to.emit(avnBridge, 'LogGrowthTriggered')
            .withArgs(expectedGrowthAmount, period, (await helper.getCurrentBlockTimestamp()) + helper.GROWTH_DELAY + 1, t2TxId);

          await avnBridge.denyGrowth(period);

          await helper.increaseBlockTimestamp(helper.GROWTH_DELAY);
          await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'GrowthUnavailable');

          expect(avnBalanceBefore).to.equal(await token20.balanceOf(avnBridge.address));
          expect(avtSupplyBefore).to.equal(await token20.totalSupply());
        });

        it('to release growth before its release time', async () => {
          const avtSupplyBefore = await token20.totalSupply();
          const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
          const expectedGrowthAmount = rewards.mul(avtSupplyBefore).div(avgStaked);
          const confirmations = await getGrowthConfirmations(rewards, avgStaked, period, expiry, t2TxId);

          await avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, confirmations);
          await expect(avnBridge.releaseGrowth(period)).to.be.revertedWithCustomError(avnBridge, 'NotReady');
          expect(avnBalanceBefore).to.equal(await token20.balanceOf(avnBridge.address));
          expect(avtSupplyBefore).to.equal(await token20.totalSupply());

          await helper.increaseBlockTimestamp(helper.GROWTH_DELAY);
          await avnBridge.releaseGrowth(period);

          expect(avnBalanceBefore.add(expectedGrowthAmount), await token20.balanceOf(avnBridge.address));
          expect(avtSupplyBefore.add(expectedGrowthAmount), await token20.totalSupply());
        });

        it('in triggering and releasing immediate growth', async () => {
          const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
          const avtSupplyBefore = await token20.totalSupply();
          const expectedGrowthAmount = rewards.mul(avtSupplyBefore).div(avgStaked);
          const confirmations = await getGrowthConfirmations(rewards, avgStaked, period, expiry, t2TxId);

          await avnBridge.setGrowthDelay(0);

          const nextBlockTimestamp = (await helper.getCurrentBlockTimestamp()) + 1;
          await expect(avnBridge.connect(activeAuthor).triggerGrowth(rewards, avgStaked, period, expiry, t2TxId, confirmations))
            .to.emit(avnBridge, 'LogGrowthTriggered')
            .withArgs(expectedGrowthAmount, period, nextBlockTimestamp, t2TxId)
            .to.emit(avnBridge, 'LogGrowth')
            .withArgs(expectedGrowthAmount, period);

          expect(avnBalanceBefore.add(expectedGrowthAmount)).to.equal(await token20.balanceOf(avnBridge.address));
          expect(avtSupplyBefore.add(expectedGrowthAmount)).to.equal(await token20.totalSupply());
        });
      });
    });
  });

  context('Publishing Roots', async () => {
    let rootHash, t2TxId;

    before(async () => {
      rootHash = helper.randomBytes32();
      t2TxId = helper.randomT2TxId();
    });

    context('succeeds', async () => {
      it('via authors', async () => {
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, t2TxId);
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations))
          .to.emit(avnBridge, 'LogRootPublished')
          .withArgs(rootHash, t2TxId);
      });
    });

    context('fails when', async () => {
      it('author functions are disabled', async () => {
        await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
        const newt2TxId = helper.randomT2TxId();
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', newRootHash, expiry, newt2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
        await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the expiry time has passed', async () => {
        const newt2TxId = helper.randomT2TxId();
        const newRootHash = helper.randomBytes32();
        const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', newRootHash, expiry, newt2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
      });

      it('the T2 transaction ID is not unique', async () => {
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', newRootHash, expiry, t2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'TxIdIsUsed');
      });

      it('the root has already been published', async () => {
        const newt2TxId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, newt2TxId);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, newt2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'RootHashIsUsed');
      });

      it('the confirmations are invalid', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations =
          '0xbadd' + helper.strip_0x(await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, t2TxId));
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('there are no confirmations', async () => {
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, '0x')).to.be.revertedWithCustomError(
          avnBridge,
          'BadConfirmations'
        );
      });

      it('there are not enough confirmations', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const numRequiredConfirmations = await helper.getNumRequiredConfirmations(avnBridge);
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, t2TxId, -1);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('the confirmations are corrupted', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, t2TxId);
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
          'publishRoot',
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
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, t2TxId, -halfSet);
        const duplicateConfirmations = confirmations + helper.strip_0x(confirmations);
        await expect(
          avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, duplicateConfirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });
    });
  });

  context('Adding Authors', async () => {
    context('succeeds', async () => {
      it('via the authors', async () => {
        const numActiveAuthorsBefore = await avnBridge.numActiveAuthors();
        const newAuthor = authors[nextAuthorId];
        let t2TxId = helper.randomT2TxId();
        let expiry = await helper.getValidExpiry();
        let confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [newAuthor.t1PubKey, newAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
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
        confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, t2TxId);
        newAuthorConfirmation = await helper.getSingleConfirmation(
          avnBridge,
          'publishRoot',
          rootHash,
          expiry,
          t2TxId,
          newAuthor
        );
        const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
        await avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);

        expect(numActiveAuthorsBefore.add(ethers.BigNumber.from(1))).to.equal(await avnBridge.numActiveAuthors());
        expect(await avnBridge.authorIsActive(nextAuthorId)).to.equal(true);
        nextAuthorId++;
        numActiveAuthors++;
      });
    });

    context('fails when', async () => {
      it('author functions are disabled', async () => {
        await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
        const prospectAuthor = authors[nextAuthorId];
        const expiry = await helper.getValidExpiry();
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [prospectAuthor.t1PubKey, prospectAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge
            .connect(activeAuthor)
            .addAuthor(prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
        await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the T1 public key is empty', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const emptyKey = '0x';
        const expiry = await helper.getValidExpiry();
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [emptyKey, prospectAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(emptyKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'InvalidT1Key');
      });

      it('the expiry time has passed', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [prospectAuthor.t1PubKey, prospectAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge
            .connect(activeAuthor)
            .addAuthor(prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
      });

      it('the author is already active', async () => {
        const existingAuthor = authors[1];
        const expiry = await helper.getValidExpiry();
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [existingAuthor.t1PubKey, existingAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge
            .connect(activeAuthor)
            .addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AlreadyAdded');
      });

      it('trying to re-add a removed author with a different public key', async () => {
        const existingAuthor = authors[numActiveAuthors];
        let expiry = await helper.getValidExpiry();
        let t2TxId = helper.randomT2TxId();
        let confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [existingAuthor.t2PubKey, existingAuthor.t1PubKey],
          expiry,
          t2TxId
        );
        await avnBridge
          .connect(activeAuthor)
          .removeAuthor(existingAuthor.t2PubKey, existingAuthor.t1PubKey, expiry, t2TxId, confirmations);
        numActiveAuthors--;

        const newAuthor = authors[nextAuthorId];
        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [existingAuthor.t1PubKey, newAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(existingAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'CannotChangeT2Key');

        t2TxId = helper.randomT2TxId();
        confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [existingAuthor.t1PubKey, existingAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await avnBridge
          .connect(activeAuthor)
          .addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations);
      });

      it('passing a T2 public key which is already in use', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const existingAuthor = authors[1];
        const t2TxId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [prospectAuthor.t1PubKey, existingAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge
            .connect(activeAuthor)
            .addAuthor(prospectAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'T2KeyInUse');
      });
    });
  });

  context('Removing Authors', async () => {
    context('succeeds', async () => {
      it('via the authors (an author can be added, activated and removed)', async () => {
        let numActiveAuthorsBeforeAddition = await avnBridge.numActiveAuthors();
        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        const newAuthor = authors[nextAuthorId];
        let expiry = await helper.getValidExpiry();
        let t2TxId = helper.randomT2TxId();
        let confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [newAuthor.t1PubKey, newAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

        // Publishing a root with a confirmation from the newly added author activates them
        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        const rootHash = helper.randomBytes32();
        confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', rootHash, expiry, t2TxId);
        const newAuthorConfirmation = await helper.getSingleConfirmation(
          avnBridge,
          'publishRoot',
          rootHash,
          expiry,
          t2TxId,
          newAuthor
        );
        const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
        await avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition.add(1));

        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [newAuthor.t2PubKey, newAuthor.t1PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations)
        )
          .to.emit(avnBridge, 'LogAuthorRemoved')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);
      });

      it('via the authors (an author can be added and removed without ever being activated)', async () => {
        const numActiveAuthorsBeforeAddition = await avnBridge.numActiveAuthors();
        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        const newAuthor = authors[nextAuthorId];
        let t2TxId = helper.randomT2TxId();
        let expiry = await helper.getValidExpiry();
        let confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [newAuthor.t1PubKey, newAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

        t2TxId = helper.randomT2TxId();
        expiry = await helper.getValidExpiry();
        confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [newAuthor.t2PubKey, newAuthor.t1PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations)
        )
          .to.emit(avnBridge, 'LogAuthorRemoved')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);
      });
    });

    context('fails when', async () => {
      it('attempting to remove an author who has already been removed', async () => {
        const newAuthor = authors[nextAuthorId];
        let t2TxId = helper.randomT2TxId();
        let expiry = await helper.getValidExpiry();
        let confirmations = await helper.getConfirmations(
          avnBridge,
          'addAuthor',
          [newAuthor.t1PubKey, newAuthor.t2PubKey],
          expiry,
          t2TxId
        );
        await avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
        t2TxId = helper.randomT2TxId();
        expiry = await helper.getValidExpiry();
        confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [newAuthor.t2PubKey, newAuthor.t1PubKey],
          expiry,
          t2TxId
        );
        await avnBridge
          .connect(activeAuthor)
          .removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations);
        numActiveAuthors--;
        t2TxId = helper.randomT2TxId();
        expiry = await helper.getValidExpiry();
        confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [newAuthor.t2PubKey, newAuthor.t1PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'NotAnAuthor');
      });

      it('author functions are disabled', async () => {
        await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
        const t2TxId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [authors[0].t2PubKey, authors[0].t1PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.connect(activeAuthor).removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
        await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the expiry time for the call has passed', async () => {
        const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [authors[0].t2PubKey, authors[0].t1PubKey],
          expiry,
          t2TxId
        );
        await expect(
          avnBridge.removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
      });
    });
  });
});
