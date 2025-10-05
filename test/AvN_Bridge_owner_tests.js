const { deployBridge, expect, generateInitArgs, getAccounts, getAuthors, init, MIN_AUTHORS, ZERO_ADDRESS, randomBytes32 } = require('./helpers/testHelper');

let accounts, authors, bridge, token777, token20, owner, someOtherAccount, unauthorizedAccount, newTokenOwner;

describe('Owner Functions', async () => {
  before(async () => {
    await init();
    const Token777 = await ethers.getContractFactory('Token777');
    token777 = await Token777.deploy(10000000n);
    token777.address = await token777.getAddress();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000n);
    token20.address = await token20.getAddress();
    const numAuthors = 10;
    bridge = await deployBridge(numAuthors);
    bridge.address = await bridge.getAddress();
    accounts = getAccounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    unauthorizedAccount = accounts[2];
    newTokenOwner = accounts[3];
    someT2PubKey = randomBytes32();
    authors = getAuthors();
    await token20.transferOwnership(bridge.address);
  });

  context('Transferring Ownership', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        await expect(bridge.transferOwnership(someOtherAccount.address)).to.emit(bridge, 'OwnershipTransferStarted').withArgs(owner, someOtherAccount.address);

        expect(someOtherAccount.address).to.equal(await bridge.pendingOwner());
        expect(owner).to.equal(await bridge.owner());

        await expect(bridge.connect(someOtherAccount).acceptOwnership()).to.emit(bridge, 'OwnershipTransferred').withArgs(owner, someOtherAccount.address);

        expect(ZERO_ADDRESS.address).to.equal(await bridge.pendingOwner());
        expect(someOtherAccount.address).to.equal(await bridge.owner());

        await bridge.connect(someOtherAccount).transferOwnership(owner);
        await bridge.acceptOwnership();
        expect(owner).to.equal(await bridge.owner());
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(someOtherAccount).transferOwnership(unauthorizedAccount.address)).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('when an unauthorised account attempts to accept ownership', async () => {
        bridge.transferOwnership(someOtherAccount.address);
        await expect(bridge.connect(unauthorizedAccount).acceptOwnership()).to.be.revertedWithCustomError(bridge, 'PendingOwnerOnly');
      });
    });
  });

  context('Renouncing Ownership', async () => {
    context('succeeds', async () => {
      it('does nothing when the caller is the owner', async () => {
        expect(owner).to.equal(await bridge.owner());
        await bridge.renounceOwnership();
        expect(owner).to.equal(await bridge.owner());
      });

      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(someOtherAccount).renounceOwnership()).to.be.revertedWith('Ownable: caller is not the owner');
        });
      });
    });
  });

  context('Initialization', async () => {
    let initVals = {};
    const numAuthors = MIN_AUTHORS + 1;

    async function deployAndCatchInitError(expectedError) {
      const initArgs = [initVals.t1Addresses, initVals.t1PubKeysLHS, initVals.t1PubKeysRHS, initVals.t2PubKeys];
      const AVNBridge = await ethers.getContractFactory('AVNBridge');
      await expect(upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' })).to.be.revertedWithCustomError(AVNBridge, expectedError);
    }

    beforeEach(async () => {
      initVals = { t1Addresses: [], t1PubKeysLHS: [], t1PubKeysRHS: [], t2PubKeys: [] };

      for (i = 0; i < numAuthors; i++) {
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

      for (i = 0; i < numAuthors; i++) {
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

    it('when addresses are missing', async () => {
      initVals.t1Addresses.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('when t1 key left halves are missing', async () => {
      initVals.t1PubKeysLHS.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('when t1 key right halves are missing', async () => {
      initVals.t1PubKeysRHS.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('when t2 keys are missing', async () => {
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
  });

  context('Switches', async () => {
    context('Toggle Authors', async () => {
      context('succeeds', async () => {
        it('when called by the owner', async () => {
          await expect(bridge.toggleAuthors(false)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(false);
        });
      });
      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(someOtherAccount).toggleAuthors(true)).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(bridge.toggleAuthors(true)).to.emit(bridge, 'LogAuthorsEnabled').withArgs(true);
        });
      });
    });

    context('Toggle Lifting', async () => {
      context('succeeds', async () => {
        it('when called by the owner', async () => {
          await expect(bridge.toggleLifting(false)).to.emit(bridge, 'LogLiftingEnabled').withArgs(false);
        });
      });
      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(someOtherAccount).toggleLifting(true)).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(bridge.toggleLifting(true)).to.emit(bridge, 'LogLiftingEnabled').withArgs(true);
        });
      });
    });

    context('Toggle Lowering', async () => {
      context('succeeds', async () => {
        it('when called by the owner', async () => {
          await expect(bridge.toggleLowering(false)).to.emit(bridge, 'LogLoweringEnabled').withArgs(false);
        });
      });
      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(someOtherAccount).toggleLowering(true)).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(bridge.toggleLowering(true)).to.emit(bridge, 'LogLoweringEnabled').withArgs(true);
        });
      });
    });
  });

  context('Initializer', async () => {
    it('Cannot reinitialize', async () => {
      const initArgs = generateInitArgs(MIN_AUTHORS);
      await expect(bridge.initialize(...initArgs)).to.be.reverted;
    });
  });

  context('Migrate', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        expect(await token20.owner()).to.equal(bridge.address);
        await expect(bridge.migrate(token20.address, newTokenOwner.address)).to.emit(token20, 'LogSetOwner').withArgs(newTokenOwner.address);
        expect(await token20.owner()).to.equal(newTokenOwner.address);
      });
    });
    context('fails', async () => {
      it('if the migration has already been run', async () => {
        await expect(bridge.migrate(token20.address, newTokenOwner.address)).to.be.reverted;
      });
      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(someOtherAccount).migrate(token20.address, someOtherAccount.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });

  context('Upgrade', function () {
    let upgradeContract;

    before(async () => {
      upgradeContract = await ethers.getContractFactory('AVNBridgeUpgrade');
    });

    context('succeeds', function () {
      it('via Openzeppelin upgrades', async () => {
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
});
