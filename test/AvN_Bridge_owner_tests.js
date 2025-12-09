const {
  deployBridge,
  expect,
  generateInitArgs,
  getAccounts,
  getAuthors,
  getConfirmations,
  getValidExpiry,
  init,
  MIN_AUTHORS,
  ZERO_ADDRESS,
  randomT2TxId
} = require('./helpers/testHelper');

let accounts, authors, bridge, token777, token20, owner, someOtherAccount, unauthorizedAccount, newTokenOwner;

describe('Owner Functions', () => {
  before(async () => {
    await init();

    const Token777 = await ethers.getContractFactory('Token777');
    token777 = await Token777.deploy(10_000_000n);
    token777.address = await token777.getAddress();

    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10_000_000n);
    token20.address = await token20.getAddress();

    const numAuthors = 10;
    bridge = await deployBridge(numAuthors);
    bridge.address = await bridge.getAddress();

    accounts = getAccounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    unauthorizedAccount = accounts[2];
    newTokenOwner = accounts[3];

    authors = getAuthors();
    await token20.transferOwnership(bridge.address);
  });

  context('Transferring Ownership', () => {
    context('succeeds', () => {
      it('when called by the owner', async () => {
        await expect(bridge.transferOwnership(someOtherAccount.address))
          .to.emit(bridge, 'OwnershipTransferStarted')
          .withArgs(owner.address, someOtherAccount.address);

        expect(await bridge.pendingOwner()).to.equal(someOtherAccount.address);
        expect(await bridge.owner()).to.equal(owner.address);

        await expect(bridge.connect(someOtherAccount).acceptOwnership())
          .to.emit(bridge, 'OwnershipTransferred')
          .withArgs(owner.address, someOtherAccount.address);

        expect(await bridge.pendingOwner()).to.equal(ZERO_ADDRESS.address);
        expect(await bridge.owner()).to.equal(someOtherAccount.address);

        await expect(bridge.connect(someOtherAccount).transferOwnership(owner.address))
          .to.emit(bridge, 'OwnershipTransferStarted')
          .withArgs(someOtherAccount.address, owner.address);

        await expect(bridge.acceptOwnership()).to.emit(bridge, 'OwnershipTransferred').withArgs(someOtherAccount.address, owner.address);

        expect(await bridge.owner()).to.equal(owner.address);
      });
    });

    context('fails', () => {
      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(someOtherAccount).transferOwnership(unauthorizedAccount.address)).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('when an unauthorised account attempts to accept ownership', async () => {
        await bridge.transferOwnership(someOtherAccount.address);
        await expect(bridge.connect(unauthorizedAccount).acceptOwnership()).to.be.revertedWithCustomError(bridge, 'PendingOwnerOnly');
      });
    });
  });

  context('Renouncing Ownership', () => {
    context('succeeds', () => {
      it('does nothing when the caller is the owner', async () => {
        expect(await bridge.owner()).to.equal(owner.address);
        await bridge.renounceOwnership();
        expect(await bridge.owner()).to.equal(owner.address);
      });
    });

    context('fails', () => {
      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(someOtherAccount).renounceOwnership()).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  context('Initialization', () => {
    let initVals = {};
    const numAuthors = MIN_AUTHORS + 1;

    async function deployAndCatchInitError(expectedError) {
      const initArgs = [initVals.t1Addresses, initVals.t1PubKeysLHS, initVals.t1PubKeysRHS, initVals.t2PubKeys];
      const AVNBridge = await ethers.getContractFactory('AVNBridge');
      await expect(upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' })).to.be.revertedWithCustomError(AVNBridge, expectedError);
    }

    beforeEach(async () => {
      initVals = { t1Addresses: [], t1PubKeysLHS: [], t1PubKeysRHS: [], t2PubKeys: [] };

      for (let i = 0; i < numAuthors; i++) {
        initVals.t1Addresses.push(authors[i].t1Address);
        initVals.t1PubKeysLHS.push(authors[i].t1PubKeyLHS);
        initVals.t1PubKeysRHS.push(authors[i].t1PubKeyRHS);
        initVals.t2PubKeys.push(authors[i].t2PubKey);
      }
    });

    it('succeeds', async () => {
      const initArgs = [initVals.t1Addresses, initVals.t1PubKeysLHS, initVals.t1PubKeysRHS, initVals.t2PubKeys];
      const AVNBridge = await ethers.getContractFactory('AVNBridge');
      const newBridge = await upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' });

      for (let i = 0; i < numAuthors; i++) {
        const authorId = i + 1;
        expect(await newBridge.t1AddressToId(initVals.t1Addresses[i])).to.equal(authorId);
        expect(await newBridge.t2PubKeyToId(initVals.t2PubKeys[i])).to.equal(authorId);
        expect(await newBridge.isAuthor(authorId)).to.equal(true);
        expect(await newBridge.authorIsActive(authorId)).to.equal(true);
        expect(await newBridge.idToT1Address(authorId)).to.equal(initVals.t1Addresses[i]);
        expect(await newBridge.idToT2PubKey(authorId)).to.equal(initVals.t2PubKeys[i]);
      }

      expect(await newBridge.numActiveAuthors()).to.equal(numAuthors);
      expect(await newBridge.nextAuthorId()).to.equal(numAuthors + 1);
    });

    it('fails when a T1 address does not correspond to its public key', async () => {
      initVals.t1PubKeysLHS[0] = authors[numAuthors].t1PubKeyLHS;
      await deployAndCatchInitError('AddressMismatch');
    });

    it('fails when addresses are missing', async () => {
      initVals.t1Addresses.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails when t1 key left halves are missing', async () => {
      initVals.t1PubKeysLHS.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails when t1 key right halves are missing', async () => {
      initVals.t1PubKeysRHS.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails when t2 keys are missing', async () => {
      initVals.t2PubKeys.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails if any t1 addresses are duplicated', async () => {
      initVals.t1Addresses[0] = initVals.t1Addresses[2];
      initVals.t1PubKeysLHS[0] = initVals.t1PubKeysLHS[2];
      initVals.t1PubKeysRHS[0] = initVals.t1PubKeysRHS[2];
      await deployAndCatchInitError('T1AddressInUse');
    });

    it('fails if any t2 addresses are duplicated', async () => {
      initVals.t2PubKeys[1] = initVals.t2PubKeys[3];
      await deployAndCatchInitError('T2KeyInUse');
    });

    it('fails when there are too few authors', async () => {
      initVals.t1Addresses.splice(MIN_AUTHORS - 1);
      initVals.t1PubKeysLHS.splice(MIN_AUTHORS - 1);
      initVals.t1PubKeysRHS.splice(MIN_AUTHORS - 1);
      initVals.t2PubKeys.splice(MIN_AUTHORS - 1);
      await deployAndCatchInitError('NotEnoughAuthors');
    });

    it('fails when addresses are missing', async () => {
      initVals.t1Addresses[0] = ZERO_ADDRESS.address;
      await deployAndCatchInitError('AddressIsZero');
    });
  });

  context('Switches', () => {
    context('Toggle Authors', () => {
      context('succeeds', () => {
        it('when called by the owner', async () => {
          await expect(bridge.enableAuthors(false)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(false);
        });
      });
      context('fails', () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(someOtherAccount).enableAuthors(true)).to.be.revertedWith('Ownable: caller is not the owner');

          await expect(bridge.enableAuthors(true)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(true);
        });
      });
    });

    context('Toggle Lifting', () => {
      context('succeeds', () => {
        it('when called by the owner', async () => {
          await expect(bridge.enableLifting(false)).to.emit(bridge, 'LogLiftingEnabled').withArgs(false);
        });
      });
      context('fails', () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(someOtherAccount).enableLifting(true)).to.be.revertedWith('Ownable: caller is not the owner');

          await expect(bridge.enableLifting(true)).to.emit(bridge, 'LogLiftingEnabled').withArgs(true);
        });
      });
    });

    context('Toggle Lowering', () => {
      context('succeeds', () => {
        it('when called by the owner', async () => {
          await expect(bridge.enableLowering(false)).to.emit(bridge, 'LogLoweringEnabled').withArgs(false);
        });
      });
      context('fails', () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(someOtherAccount).enableLowering(true)).to.be.revertedWith('Ownable: caller is not the owner');

          await expect(bridge.enableLowering(true)).to.emit(bridge, 'LogLoweringEnabled').withArgs(true);
        });
      });
    });
  });

  context('Initializer', () => {
    it('cannot reinitialize', async () => {
      const initArgs = generateInitArgs(MIN_AUTHORS);
      await expect(bridge.initialize(...initArgs)).to.be.reverted;
    });
  });

  context('Upgrade', function () {
    let upgradeContract;

    before(async () => {
      upgradeContract = await ethers.getContractFactory('AVNBridgeUpgrade');
    });

    context('succeeds', function () {
      it('via OpenZeppelin upgrades', async () => {
        const upgradedBridge = await upgrades.upgradeProxy(bridge.address, upgradeContract);
        expect(await upgradedBridge.newFunction()).to.equal('AVNBridge upgraded');
      });
    });

    context('fails', function () {
      it('when the caller is not the owner', async () => {
        const newBridge = await upgradeContract.deploy();
        await expect(bridge.connect(someOtherAccount).upgradeToAndCall(await newBridge.getAddress(), '0x')).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });

  context('Rotation', () => {
    const NUM_AUTHORS = 10;
    let rotBridge;

    before(async () => {
      rotBridge = await deployBridge(NUM_AUTHORS);
      rotBridge.address = await rotBridge.getAddress();
    });

    context('succeeds', () => {
      async function removeAuthor(id) {
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(rotBridge, 'removeAuthor', [authors[id - 1].t2PubKey, authors[id - 1].t1PubKey, expiry, t2TxId]);
        await rotBridge.connect(authors[0].account).removeAuthor(authors[id - 1].t2PubKey, authors[id - 1].t1PubKey, expiry, t2TxId, confirmations);
      }

      it('when called by the owner to rotate all the T1 addresses', async () => {
        expect(await rotBridge.numActiveAuthors()).to.equal(NUM_AUTHORS);

        await removeAuthor(6);
        await removeAuthor(8);

        expect(await rotBridge.numActiveAuthors()).to.equal(NUM_AUTHORS - 2);
        expect(await rotBridge.authorIsActive(5)).to.equal(true);
        expect(await rotBridge.authorIsActive(6)).to.equal(false);
        expect(await rotBridge.authorIsActive(7)).to.equal(true);
        expect(await rotBridge.authorIsActive(8)).to.equal(false);

        const ids = [];
        const oldT1Addresses = [];
        for (let i = 1; i <= NUM_AUTHORS; i++) {
          ids.push(i);
          oldT1Addresses.push(await rotBridge.idToT1Address(i));
        }

        const newT1Addresses = Array.from({ length: NUM_AUTHORS }, () => ethers.Wallet.createRandom().address);
        await rotBridge.rotateT1(ids, newT1Addresses);

        for (const oldAddress of oldT1Addresses) {
          const mappedId = await rotBridge.t1AddressToId(oldAddress);
          expect(mappedId).to.equal(0);
        }

        for (let i = 0; i < newT1Addresses.length; i++) {
          const id = ids[i];
          const expectedNewAddress = newT1Addresses[i];
          const actualT1Address = await rotBridge.idToT1Address(id);
          const mappedId = await rotBridge.t1AddressToId(expectedNewAddress);

          expect(actualT1Address).to.equal(expectedNewAddress);
          expect(mappedId).to.equal(id);
          expect(actualT1Address).to.not.equal(oldT1Addresses[i]);
        }

        expect(await rotBridge.numActiveAuthors()).to.equal(NUM_AUTHORS - 2);
        expect(await rotBridge.authorIsActive(5)).to.equal(true);
        expect(await rotBridge.authorIsActive(6)).to.equal(false);
        expect(await rotBridge.authorIsActive(7)).to.equal(true);
        expect(await rotBridge.authorIsActive(8)).to.equal(false);
      });

      it('when rotating a single T1 address', async () => {
        const id = 7;

        const oldAddress = await rotBridge.idToT1Address(id);
        expect(oldAddress).to.not.equal(ethers.ZeroAddress);
        const oldMappedId = await rotBridge.t1AddressToId(oldAddress);
        expect(oldMappedId).to.equal(id);

        const newAddress = ethers.Wallet.createRandom().address;
        await rotBridge.rotateT1([id], [newAddress]);

        expect(await rotBridge.t1AddressToId(oldAddress)).to.equal(0);
        expect(await rotBridge.idToT1Address(id)).to.equal(newAddress);
        expect(await rotBridge.t1AddressToId(newAddress)).to.equal(id);
      });
    });

    context('fails', () => {
      it('when the caller is not the owner', async () => {
        const ids = Array.from({ length: NUM_AUTHORS }, (_, i) => i + 1);
        const newT1Addresses = Array.from({ length: NUM_AUTHORS }, () => ethers.Wallet.createRandom().address);
        await expect(rotBridge.connect(unauthorizedAccount).rotateT1(ids, newT1Addresses)).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('with the wrong number of addresses', async () => {
        const ids = [1, 2, 3];
        const newT1Addresses = [ethers.Wallet.createRandom().address];
        await expect(rotBridge.rotateT1(ids, newT1Addresses)).to.be.revertedWithCustomError(rotBridge, 'MissingKeys');
      });

      it('when any new address is zero', async () => {
        const id = 3;
        await expect(rotBridge.rotateT1([id], [ZERO_ADDRESS.address])).to.be.revertedWithCustomError(rotBridge, 'AddressIsZero');
      });

      it('when any id is not an author', async () => {
        const badId = NUM_AUTHORS + 5;
        const addr = ethers.Wallet.createRandom().address;
        await expect(rotBridge.rotateT1([badId], [addr])).to.be.revertedWithCustomError(rotBridge, 'NotAnAuthor');
      });

      it('with a duplicate address', async () => {
        const ids = Array.from({ length: NUM_AUTHORS }, (_, i) => i + 1);
        let newT1Addresses = Array.from({ length: NUM_AUTHORS }, () => ethers.Wallet.createRandom().address);
        newT1Addresses[1] = newT1Addresses[0];
        await expect(rotBridge.rotateT1(ids, newT1Addresses)).to.be.revertedWithCustomError(rotBridge, 'T1AddressInUse');
      });
    });
  });
});
