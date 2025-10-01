const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token20;
let accounts, authors;
let activeAuthor;
let numActiveAuthors, nextAuthorId;

describe('Author Functions', async () => {
  before(async () => {
    await helper.init();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000n);
    token20.address = await token20.getAddress();
    const numAuthors = 6;
    avnBridge = await helper.deployAVNBridge(numAuthors);
    avnBridge.address = await avnBridge.getAddress();
    accounts = helper.accounts();
    someOtherAccount = accounts[1];
    authors = helper.authors();
    activeAuthor = authors[0].account;
    numActiveAuthors = numAuthors;
    nextAuthorId = numAuthors + 1;
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
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId]);
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
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [newRootHash, expiry, newt2TxId]);
        await expect(avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'AuthorsDisabled'
        );
        await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the expiry time has passed', async () => {
        const newt2TxId = helper.randomT2TxId();
        const newRootHash = helper.randomBytes32();
        const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [newRootHash, expiry, newt2TxId]);
        await expect(avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'WindowExpired'
        );
      });

      it('the T2 transaction ID is not unique', async () => {
        const newRootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [newRootHash, expiry, t2TxId]);
        await expect(avnBridge.connect(activeAuthor).publishRoot(newRootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'TxIdIsUsed'
        );
      });

      it('the root has already been published', async () => {
        const newt2TxId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, newt2TxId]);
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'RootHashIsUsed'
        );
      });

      it('the confirmations are invalid', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations = '0xbadd' + helper.strip_0x(await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId]));
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'BadConfirmations'
        );
      });

      it('there are no confirmations', async () => {
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, '0x')).to.be.revertedWithCustomError(avnBridge, 'BadConfirmations');
      });

      it('there are not enough confirmations', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId], -1);
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'BadConfirmations'
        );
      });

      it('the confirmations are corrupted', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const expiry = await helper.getValidExpiry();
        let confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId]);
        confirmations = confirmations.replace(/1/g, '2');
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'BadConfirmations'
        );
      });

      it('the confirmations are not signed by active authors', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const startFromNonAuthor = nextAuthorId;
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId], 0, startFromNonAuthor);
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'BadConfirmations'
        );
      });

      it('the confirmations are not unique', async () => {
        t2TxId = helper.randomT2TxId();
        rootHash = helper.randomBytes32();
        const halfSet = Math.round(numActiveAuthors / 2);
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId], -halfSet);
        const duplicateConfirmations = confirmations + helper.strip_0x(confirmations);
        await expect(avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, duplicateConfirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'BadConfirmations'
        );
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
        let confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await expect(avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations))
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
        confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId]);
        newAuthorConfirmation = await helper.getSingleConfirmation(avnBridge, newAuthor, 'publishRoot', [rootHash, expiry, t2TxId]);
        const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
        await avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);

        expect(numActiveAuthorsBefore + ethers.toBigInt(1)).to.equal(await avnBridge.numActiveAuthors());
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
        const confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
        await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the T1 public key is empty', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const emptyKey = '0x';
        const expiry = await helper.getValidExpiry();
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [emptyKey, prospectAuthor.t2PubKey, expiry, t2TxId]);
        await expect(avnBridge.connect(activeAuthor).addAuthor(emptyKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT1Key'
        );
      });

      it('the T2 public key is empty', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const emptyKey = helper.EMPTY_BYTES_32;
        const expiry = await helper.getValidExpiry();
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [prospectAuthor.t1PubKey, emptyKey, expiry, t2TxId]);
        await expect(avnBridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, emptyKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT2Key'
        );
      });

      it('the expiry time has passed', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'WindowExpired');
      });

      it('the author is already active', async () => {
        const existingAuthor = authors[1];
        const expiry = await helper.getValidExpiry();
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AlreadyAdded');
      });

      it('trying to re-add a removed author with a different public key', async () => {
        const existingAuthor = authors[numActiveAuthors];
        let expiry = await helper.getValidExpiry();
        let t2TxId = helper.randomT2TxId();
        let confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [existingAuthor.t2PubKey, existingAuthor.t1PubKey, expiry, t2TxId]);
        await avnBridge.connect(activeAuthor).removeAuthor(existingAuthor.t2PubKey, existingAuthor.t1PubKey, expiry, t2TxId, confirmations);
        numActiveAuthors--;

        const newAuthor = authors[nextAuthorId];
        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [existingAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(existingAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'CannotChangeT2Key');

        t2TxId = helper.randomT2TxId();
        confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId]);
        await avnBridge.connect(activeAuthor).addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations);
      });

      it('passing a T2 public key which is already in use', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const existingAuthor = authors[1];
        const t2TxId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [prospectAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          avnBridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
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
        let confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

        // Publishing a root with a confirmation from the newly added author activates them
        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        const rootHash = helper.randomBytes32();
        confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId]);
        const newAuthorConfirmation = await helper.getSingleConfirmation(avnBridge, newAuthor, 'publishRoot', [rootHash, expiry, t2TxId]);
        const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
        await avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition + 1n);

        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await expect(avnBridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations))
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
        let confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
        expect(await avnBridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await avnBridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

        t2TxId = helper.randomT2TxId();
        expiry = await helper.getValidExpiry();
        confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await expect(avnBridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations))
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
        let confirmations = await helper.getConfirmations(avnBridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await avnBridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
        t2TxId = helper.randomT2TxId();
        expiry = await helper.getValidExpiry();
        confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await avnBridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations);
        numActiveAuthors--;
        t2TxId = helper.randomT2TxId();
        expiry = await helper.getValidExpiry();
        confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await expect(
          avnBridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'NotAnAuthor');
      });

      it('author functions are disabled', async () => {
        await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
        const t2TxId = helper.randomT2TxId();
        const expiry = await helper.getValidExpiry();
        const confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId]);
        await expect(
          avnBridge.connect(activeAuthor).removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
        await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('an invalid t1PublicKey is passed', async () => {
        const expiry = await helper.getValidExpiry();
        const t2TxId = helper.randomT2TxId();
        const badT1PublicKey = helper.randomHex(17);
        const confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [authors[0].t2PubKey, badT1PublicKey, expiry, t2TxId]);
        await expect(avnBridge.removeAuthor(authors[0].t2PubKey, badT1PublicKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT1Key'
        );
      });

      it('the expiry time for the call has passed', async () => {
        const expiry = (await helper.getCurrentBlockTimestamp()) - 1;
        const t2TxId = helper.randomT2TxId();
        const confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId]);
        await expect(avnBridge.removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'WindowExpired'
        );
      });

      it('if it takes the number of authors below the minimum threshold', async () => {
        let authorIndex = (await avnBridge.numActiveAuthors()) - 1n;

        for (authorIndex; authorIndex >= helper.MIN_AUTHORS; authorIndex--) {
          let expiry = await helper.getValidExpiry();
          let t2TxId = helper.randomT2TxId();
          let t1Key = authors[authorIndex].t1PubKey;
          let t2Key = authors[authorIndex].t2PubKey;
          let confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [t2Key, t1Key, expiry, t2TxId]);
          await avnBridge.connect(activeAuthor).removeAuthor(t2Key, t1Key, expiry, t2TxId, confirmations);
        }

        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        t1Key = authors[authorIndex].t1PubKey;
        t2Key = authors[authorIndex].t2PubKey;
        confirmations = await helper.getConfirmations(avnBridge, 'removeAuthor', [t2Key, t1Key, expiry, t2TxId]);
        await expect(avnBridge.connect(activeAuthor).removeAuthor(t2Key, t1Key, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          avnBridge,
          'NotEnoughAuthors'
        );
      });
    });
  });

  context('Corroborate T2 tx', async () => {
    let t2TxId, expiry;

    beforeEach(async () => {
      t2TxId = helper.randomT2TxId();
      expiry = await helper.getValidExpiry();
    });

    async function publishRoot() {
      const rootHash = helper.randomBytes32();
      const confirmations = await helper.getConfirmations(avnBridge, 'publishRoot', [rootHash, expiry, t2TxId]);
      await avnBridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations);
    }

    it('The correct state is returned for an unsent tx', async () => {
      expect(await avnBridge.corroborate(t2TxId, expiry)).to.equal(0);
    });

    it('The correct state is returned for a failed tx', async () => {
      await avnBridge.toggleAuthors(false);
      await expect(publishRoot()).to.be.revertedWithCustomError(avnBridge, 'AuthorsDisabled');
      await helper.increaseBlockTimestamp(helper.EXPIRY_WINDOW);
      await avnBridge.toggleAuthors(true);
      expect(await avnBridge.corroborate(t2TxId, expiry)).to.equal(-1);
    });

    it('The correct state is returned for a successful tx', async () => {
      await publishRoot();
      expect(await avnBridge.corroborate(t2TxId, expiry)).to.equal(1);
    });
  });
});
