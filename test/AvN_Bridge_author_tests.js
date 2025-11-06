const {
  deployBridge,
  EMPTY_BYTES_32,
  expect,
  EXPIRY_WINDOW,
  getAuthors,
  getConfirmations,
  getCurrentBlockTimestamp,
  getSingleConfirmation,
  getValidExpiry,
  increaseBlockTimestamp,
  init,
  MIN_AUTHORS,
  randomBytes32,
  randomHex,
  randomT2TxId,
  strip_0x
} = require('./helpers/testHelper');

let bridge, token20, authors, activeAuthor, numActiveAuthors, nextAuthorId;

describe('Author Functions', () => {
  before(async () => {
    await init();

    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10_000_000n);
    token20.address = await token20.getAddress();

    const numAuthors = 6;
    bridge = await deployBridge(numAuthors);
    bridge.address = await bridge.getAddress();

    authors = getAuthors();
    activeAuthor = authors[0].account;
    numActiveAuthors = numAuthors;
    nextAuthorId = numAuthors + 1;
  });

  context('Publishing Roots', () => {
    let rootHash, t2TxId;

    before(async () => {
      rootHash = randomBytes32();
      t2TxId = randomT2TxId();
    });

    context('succeeds', () => {
      it('via authors', async () => {
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogRootPublished')
          .withArgs(rootHash, t2TxId);
      });
    });

    context('fails when', () => {
      it('author functions are disabled', async () => {
        await expect(bridge.toggleAuthors(false)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(false);

        const newt2TxId = randomT2TxId();
        const newRootHash = randomBytes32();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', [newRootHash, expiry, newt2TxId]);

        await expect(bridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'AuthorsDisabled');

        await expect(bridge.toggleAuthors(true)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the expiry time has passed', async () => {
        const newt2TxId = randomT2TxId();
        const newRootHash = randomBytes32();
        const expiry = (await getCurrentBlockTimestamp()) - 1;
        const confirmations = await getConfirmations(bridge, 'publishRoot', [newRootHash, expiry, newt2TxId]);
        await expect(bridge.connect(activeAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'WindowExpired');
      });

      it('the T2 transaction ID is not unique', async () => {
        const newRootHash = randomBytes32();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', [newRootHash, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).publishRoot(newRootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'TxIdIsUsed');
      });

      it('the root has already been published', async () => {
        const newt2TxId = randomT2TxId();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, newt2TxId]);
        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'RootHashIsUsed');
      });

      it('the confirmations are invalid', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();

        let confirmations = '0xbadd' + strip_0x(await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId]));

        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'BadConfirmations');
      });

      it('there are no confirmations', async () => {
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();
        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, '0x')).to.be.revertedWithCustomError(bridge, 'BadConfirmations');
      });

      it('there are not enough confirmations', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId], -1);
        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'BadConfirmations');
      });

      it('the confirmations are corrupted', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();

        let confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId]);
        confirmations = confirmations.replace(/1/g, '2');

        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'BadConfirmations');
      });

      it('the confirmations are not signed by active authors', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const startFromNonAuthor = nextAuthorId;
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId], 0, startFromNonAuthor);
        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'BadConfirmations');
      });

      it('the confirmations are not unique', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const halfSet = Math.round(numActiveAuthors / 2);
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId], -halfSet);
        const duplicateConfirmations = confirmations + strip_0x(confirmations);
        await expect(bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, duplicateConfirmations)).to.be.revertedWithCustomError(
          bridge,
          'BadConfirmations'
        );
      });
    });
  });

  context('Adding Authors', () => {
    context('succeeds', () => {
      it('via the authors', async () => {
        const numActiveAuthorsBefore = await bridge.numActiveAuthors();
        const newAuthor = authors[nextAuthorId];

        let t2TxId = randomT2TxId();
        let expiry = await getValidExpiry();
        let confirmations = await getConfirmations(bridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);

        await expect(bridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogAuthorAdded')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

        expect(await bridge.idToT1Address(nextAuthorId)).to.equal(newAuthor.t1Address);
        // The author has been added but is not active
        expect(await bridge.numActiveAuthors()).to.equal(numActiveAuthorsBefore);
        expect(await bridge.authorIsActive(nextAuthorId)).to.equal(false);

        // Publishing a root containing a confirmation from the new author activates the author
        const rootHash = randomBytes32();
        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId]);
        const newAuthorConfirmation = await getSingleConfirmation(bridge, newAuthor, 'publishRoot', [rootHash, expiry, t2TxId]);
        const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
        await bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);

        expect(await bridge.numActiveAuthors()).to.equal(numActiveAuthorsBefore + 1n);
        expect(await bridge.authorIsActive(nextAuthorId)).to.equal(true);

        nextAuthorId++;
        numActiveAuthors++;
      });
    });

    context('fails when', () => {
      it('author functions are disabled', async () => {
        await expect(bridge.toggleAuthors(false)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(false);

        const prospectAuthor = authors[nextAuthorId];
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId]);

        await expect(
          bridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'AuthorsDisabled');

        await expect(bridge.toggleAuthors(true)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('the T1 public key is empty', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const emptyKey = '0x';
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [emptyKey, prospectAuthor.t2PubKey, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).addAuthor(emptyKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'InvalidT1Key'
        );
      });

      it('the T2 public key is empty', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const emptyKey = EMPTY_BYTES_32;
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [prospectAuthor.t1PubKey, emptyKey, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, emptyKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'InvalidT2Key'
        );
      });

      it('the expiry time has passed', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const expiry = (await getCurrentBlockTimestamp()) - 1;
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          bridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, prospectAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'WindowExpired');
      });

      it('the author is already active', async () => {
        const existingAuthor = authors[1];
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          bridge.connect(activeAuthor).addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'AlreadyAdded');
      });

      it('trying to re-add a removed author with a different public key', async () => {
        const existingAuthor = authors[numActiveAuthors];

        // remove existingAuthor
        let expiry = await getValidExpiry();
        let t2TxId = randomT2TxId();
        let confirmations = await getConfirmations(bridge, 'removeAuthor', [existingAuthor.t2PubKey, existingAuthor.t1PubKey, expiry, t2TxId]);
        await bridge.connect(activeAuthor).removeAuthor(existingAuthor.t2PubKey, existingAuthor.t1PubKey, expiry, t2TxId, confirmations);
        numActiveAuthors--;

        // try to add with different t2 key
        const newAuthor = authors[nextAuthorId];
        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'addAuthor', [existingAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).addAuthor(existingAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'CannotChangeT2Key'
        );

        // add back with original t2 key
        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'addAuthor', [existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId]);
        await bridge.connect(activeAuthor).addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations);
      });

      it('passing a T2 public key which is already in use', async () => {
        const prospectAuthor = authors[nextAuthorId];
        const existingAuthor = authors[1];
        const t2TxId = randomT2TxId();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [prospectAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId]);
        await expect(
          bridge.connect(activeAuthor).addAuthor(prospectAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'T2KeyInUse');
      });
    });
  });

  context('Removing Authors', () => {
    context('succeeds', () => {
      it('via the authors (an author can be added, activated and removed)', async () => {
        const numActiveAuthorsBeforeAddition = await bridge.numActiveAuthors();
        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);

        const newAuthor = authors[nextAuthorId];

        // add
        let expiry = await getValidExpiry();
        let t2TxId = randomT2TxId();
        let confirmations = await getConfirmations(bridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await bridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);

        nextAuthorId++;
        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await bridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

        // activate by publishing root including new author's confirmation
        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        const rootHash = randomBytes32();
        confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId]);
        const newAuthorConfirmation = await getSingleConfirmation(bridge, newAuthor, 'publishRoot', [rootHash, expiry, t2TxId]);
        const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
        await bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);

        expect(await bridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition + 1n);

        // remove
        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogAuthorRemoved')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await bridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);
      });

      it('via the authors (an author can be added and removed without ever being activated)', async () => {
        const numActiveAuthorsBeforeAddition = await bridge.numActiveAuthors();
        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);

        const newAuthor = authors[nextAuthorId];

        // add (no activation)
        let t2TxId = randomT2TxId();
        let expiry = await getValidExpiry();
        let confirmations = await getConfirmations(bridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await bridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);

        nextAuthorId++;
        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await bridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);

        // remove (still inactive)
        t2TxId = randomT2TxId();
        expiry = await getValidExpiry();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogAuthorRemoved')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await bridge.numActiveAuthors()).to.equal(numActiveAuthorsBeforeAddition);
      });
    });

    context('fails when', () => {
      it('attempting to remove an author who has already been removed', async () => {
        const newAuthor = authors[nextAuthorId];

        // add
        let t2TxId = randomT2TxId();
        let expiry = await getValidExpiry();
        let confirmations = await getConfirmations(bridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId]);
        await bridge.connect(activeAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);

        nextAuthorId++;

        // remove
        t2TxId = randomT2TxId();
        expiry = await getValidExpiry();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await bridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations);

        numActiveAuthors--;

        // remove again -> NotAnAuthor
        t2TxId = randomT2TxId();
        expiry = await getValidExpiry();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId]);
        await expect(bridge.connect(activeAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'NotAnAuthor'
        );
      });

      it('author functions are disabled', async () => {
        await expect(bridge.toggleAuthors(false)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(false);

        const t2TxId = randomT2TxId();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'removeAuthor', [authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId]);

        await expect(bridge.connect(activeAuthor).removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'AuthorsDisabled'
        );

        await expect(bridge.toggleAuthors(true)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(true);
      });

      it('an invalid t1PublicKey is passed', async () => {
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const badT1PublicKey = randomHex(17);
        const confirmations = await getConfirmations(bridge, 'removeAuthor', [authors[0].t2PubKey, badT1PublicKey, expiry, t2TxId]);
        await expect(bridge.removeAuthor(authors[0].t2PubKey, badT1PublicKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'InvalidT1Key');
      });

      it('the expiry time for the call has passed', async () => {
        const expiry = (await getCurrentBlockTimestamp()) - 1;
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'removeAuthor', [authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId]);
        await expect(bridge.removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'WindowExpired');
      });

      it('if it takes the number of authors below the minimum threshold', async () => {
        // Walk down from the last author until just above the minimum, removing each.
        let authorIndexBig = (await bridge.numActiveAuthors()) - 1n;

        for (; authorIndexBig >= BigInt(MIN_AUTHORS); authorIndexBig--) {
          const idx = Number(authorIndexBig);
          const expiry = await getValidExpiry();
          const t2TxId = randomT2TxId();
          const t1Key = authors[idx].t1PubKey;
          const t2Key = authors[idx].t2PubKey;
          const confirmations = await getConfirmations(bridge, 'removeAuthor', [t2Key, t1Key, expiry, t2TxId]);
          await bridge.connect(activeAuthor).removeAuthor(t2Key, t1Key, expiry, t2TxId, confirmations);
        }

        // Now removing one more should revert with NotEnoughAuthors
        const idx = Number(authorIndexBig);
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const t1Key = authors[idx].t1PubKey;
        const t2Key = authors[idx].t2PubKey;
        const confirmations = await getConfirmations(bridge, 'removeAuthor', [t2Key, t1Key, expiry, t2TxId]);

        await expect(bridge.connect(activeAuthor).removeAuthor(t2Key, t1Key, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'NotEnoughAuthors');
      });
    });
  });

  context('Corroborate T2 tx', () => {
    let t2TxId, expiry;

    beforeEach(async () => {
      t2TxId = randomT2TxId();
      expiry = await getValidExpiry();
    });

    async function publishRoot() {
      const rootHash = randomBytes32();
      const confirmations = await getConfirmations(bridge, 'publishRoot', [rootHash, expiry, t2TxId]);
      await bridge.connect(activeAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations);
    }

    it('The correct state is returned for an unsent tx', async () => {
      expect(await bridge.corroborate(t2TxId, expiry)).to.equal(0);
    });

    it('The correct state is returned for a failed tx', async () => {
      await bridge.toggleAuthors(false);
      await expect(publishRoot()).to.be.revertedWithCustomError(bridge, 'AuthorsDisabled');
      await increaseBlockTimestamp(EXPIRY_WINDOW);
      await bridge.toggleAuthors(true);
      expect(await bridge.corroborate(t2TxId, expiry)).to.equal(-1);
    });

    it('The correct state is returned for a successful tx', async () => {
      await publishRoot();
      expect(await bridge.corroborate(t2TxId, expiry)).to.equal(1);
    });
  });
});
