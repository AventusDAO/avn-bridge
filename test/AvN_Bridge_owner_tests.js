const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token777, token20;
let accounts, authors;
let owner, someOtherAccount, unauthorizedAccount, newTokenOwner;
let AVNBridge;

describe('Owner Functions', async () => {
  before(async () => {
    await helper.init();
    AVNBridge = await ethers.getContractFactory('AVNBridge');
    const Token777 = await ethers.getContractFactory('Token777');
    token777 = await Token777.deploy(10000000n);
    token777.address = await token777.getAddress();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000n);
    token20.address = await token20.getAddress();
    const numAuthors = 10;
    avnBridge = await helper.deployAVNBridge(numAuthors);
    avnBridge.address = await avnBridge.getAddress();
    accounts = helper.accounts();
    owner = helper.owner();
    someOtherAccount = accounts[1];
    unauthorizedAccount = accounts[2];
    newTokenOwner = accounts[3];
    someT2PubKey = helper.someT2PubKey();
    authors = helper.authors();
    await token20.transferOwnership(avnBridge.address);
  });

  context('Transferring Ownership', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        await expect(avnBridge.transferOwnership(someOtherAccount.address))
          .to.emit(avnBridge, 'OwnershipTransferStarted')
          .withArgs(owner, someOtherAccount.address);

        expect(someOtherAccount.address).to.equal(await avnBridge.pendingOwner());
        expect(owner).to.equal(await avnBridge.owner());

        await expect(avnBridge.connect(someOtherAccount).acceptOwnership())
          .to.emit(avnBridge, 'OwnershipTransferred')
          .withArgs(owner, someOtherAccount.address);

        expect(helper.ZERO_ADDRESS.address).to.equal(await avnBridge.pendingOwner());
        expect(someOtherAccount.address).to.equal(await avnBridge.owner());

        await avnBridge.connect(someOtherAccount).transferOwnership(owner);
        await avnBridge.acceptOwnership();
        expect(owner).to.equal(await avnBridge.owner());
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).transferOwnership(unauthorizedAccount.address)).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('when an unauthorised account attempts to accept ownership', async () => {
        avnBridge.transferOwnership(someOtherAccount.address);
        await expect(avnBridge.connect(unauthorizedAccount).acceptOwnership()).to.be.revertedWithCustomError(avnBridge, 'PendingOwnerOnly');
      });
    });
  });

  context('Renouncing Ownership', async () => {
    context('succeeds', async () => {
      it('does nothing when the caller is the owner', async () => {
        expect(owner).to.equal(await avnBridge.owner());
        await avnBridge.renounceOwnership();
        expect(owner).to.equal(await avnBridge.owner());
      });

      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(avnBridge.connect(someOtherAccount).renounceOwnership()).to.be.revertedWith('Ownable: caller is not the owner');
        });
      });
    });
  });

  context('Initialization', function () {
    const numAuthors = 6;
    let initVals = generateInitVals(numAuthors);

    function generateInitVals(n) {
      const initArgs = helper.generateInitArgs(n);
      initVals = { t1Addresses: initArgs[0], t1PubKeysLHS: initArgs[1], t1PubKeysRHS: initArgs[2], t2PubKeys: initArgs[3] };
    }

    context('succeeds', function () {
      it('with the correct arguments', async () => {
        const newBridge = await helper.deployAVNBridge(numAuthors);
        
        for (i = 0; i < numAuthors; i++) {
          const authorId = i + 1;
          expect(await newBridge.t1AddressToId(initVals.t1Addresses[i])).to.equal(authorId);
          expect(await newBridge.t2PubKeyToId(initVals.t2PubKeys[i])).to.equal(authorId);
          expect(await newBridge.isAuthor(authorId)).to.be.true;
          expect(await newBridge.authorIsActive(authorId)).to.be.true;
          expect(await newBridge.idToT1Address(authorId)).to.equal(initVals.t1Addresses[i]);
          expect(await newBridge.idToT2PubKey(authorId)).to.equal(initVals.t2PubKeys[i]);
        }

        expect(await newBridge.numActiveAuthors()).to.equal(numAuthors);
        expect(await newBridge.nextAuthorId()).to.equal(numAuthors + 1);
      });
    });

    context('fails', function () {
      async function deployAndCatchInitError(expectedError) {
        const initArgs = [initVals.t1Addresses, initVals.t1PubKeysLHS, initVals.t1PubKeysRHS, initVals.t2PubKeys];
        const AVNBridge = await ethers.getContractFactory('AVNBridge');
        await expect(upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' })).to.be.revertedWithCustomError(AVNBridge, expectedError);
      }

      beforeEach(async () => {
        generateInitVals(numAuthors);
      });

      it('when a T1 address does not correspond to its public key', async () => {
        initVals.t1PubKeysLHS[0] = authors[1].t1PubKeyLHS;
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

      it('if any t1 addresses are duplicated', async () => {
        initVals.t1Addresses[0] = initVals.t1Addresses[2];
        initVals.t1PubKeysLHS[0] = initVals.t1PubKeysLHS[2];
        initVals.t1PubKeysRHS[0] = initVals.t1PubKeysRHS[2];
        await deployAndCatchInitError('T1AddressInUse');
      });

      it('if any t2 addresses are duplicated', async () => {
        initVals.t2PubKeys[1] = initVals.t2PubKeys[3];
        await deployAndCatchInitError('T2KeyInUse');
      });

      it('when not enough authors are provided', async () => {
        generateInitVals(2);
        await deployAndCatchInitError('NotEnoughAuthors');
      });
    });
  });

  context('Switches', async () => {
    context('Toggle Authors', async () => {
      context('succeeds', async () => {
        it('when called by the owner', async () => {
          await expect(avnBridge.toggleAuthors(false)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(false);
        });
      });
      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(avnBridge.connect(someOtherAccount).toggleAuthors(true)).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(avnBridge.toggleAuthors(true)).to.emit(avnBridge, 'LogAuthorsEnabled').withArgs(true);
        });
      });
    });

    context('Toggle Lifting', async () => {
      context('succeeds', async () => {
        it('when called by the owner', async () => {
          await expect(avnBridge.toggleLifting(false)).to.emit(avnBridge, 'LogLiftingEnabled').withArgs(false);
        });
      });
      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(avnBridge.connect(someOtherAccount).toggleLifting(true)).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(avnBridge.toggleLifting(true)).to.emit(avnBridge, 'LogLiftingEnabled').withArgs(true);
        });
      });
    });

    context('Toggle Lowering', async () => {
      context('succeeds', async () => {
        it('when called by the owner', async () => {
          await expect(avnBridge.toggleLowering(false)).to.emit(avnBridge, 'LogLoweringEnabled').withArgs(false);
        });
      });
      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(avnBridge.connect(someOtherAccount).toggleLowering(true)).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(avnBridge.toggleLowering(true)).to.emit(avnBridge, 'LogLoweringEnabled').withArgs(true);
        });
      });
    });
  });

  context('Initializer', async () => {
    it('Cannot reinitialize', async () => {
      const initArgs = helper.generateInitArgs(helper.MIN_AUTHORS);
      await expect(avnBridge.initialize(...initArgs)).to.be.reverted;
    });
  });

  context('Migrate', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        expect(await token20.owner()).to.equal(avnBridge.address);
        await expect(avnBridge.migrate(token20.address, newTokenOwner.address)).to.emit(token20, 'LogSetOwner').withArgs(newTokenOwner.address);
        expect(await token20.owner()).to.equal(newTokenOwner.address);
      });
    });
    context('fails', async () => {
      it('if the migration has already been run', async () => {
        await expect(avnBridge.migrate(token20.address, newTokenOwner.address)).to.be.reverted;
      });
      it('when the caller is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).migrate(token20.address, someOtherAccount.address)).to.be.revertedWith(
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
        const upgradedBridge = await upgrades.upgradeProxy(avnBridge.address, upgradeContract);
        expect(await upgradedBridge.newFunction()).to.equal('AVNBridge upgraded');
      });
    });

    context('fails', function () {
      it('when the caller is not the owner', async () => {
        const newBridge = await upgradeContract.deploy();
        await expect(avnBridge.connect(someOtherAccount).upgradeToAndCall(await newBridge.getAddress(), '0x')).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });
});
