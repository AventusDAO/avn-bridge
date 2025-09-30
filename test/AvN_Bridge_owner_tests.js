const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token777, token20;
let accounts, authors, numAuthors;
let owner, someOtherAccount, someT2PubKey, unauthorizedAccount;
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
    avnBridge = await helper.deployAVNBridge(token20.address, numAuthors);
    avnBridge.address = await avnBridge.getAddress();
    accounts = helper.accounts();
    owner = helper.owner();
    someOtherAccount = accounts[1];
    unauthorizedAccount = accounts[2];
    someT2PubKey = helper.someT2PubKey();
    authors = helper.authors();
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

        expect(helper.ZERO_ADDRESS).to.equal(await avnBridge.pendingOwner());
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

  context('Initialization', async () => {
    let initVals = {};

    async function deployAndCatchInitError(expectedError) {
      const initArgs = [initVals.token, initVals.t1Addresses, initVals.t1PubKeysLHS, initVals.t1PubKeysRHS, initVals.t2PubKeys];
      const AVNBridge = await ethers.getContractFactory('AVNBridge');
      await expect(upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' })).to.be.revertedWithCustomError(AVNBridge, expectedError);
    }

    beforeEach(async () => {
      initVals = { token: token20.address, t1Addresses: [], t1PubKeysLHS: [], t1PubKeysRHS: [], t2PubKeys: [] };

      for (i = 0; i < helper.MIN_AUTHORS; i++) {
        initVals.t1Addresses.push(authors[i].t1Address);
        initVals.t1PubKeysLHS.push(authors[i].t1PubKeyLHS);
        initVals.t1PubKeysRHS.push(authors[i].t1PubKeyRHS);
        initVals.t2PubKeys.push(authors[i].t2PubKey);
      }
    });

    it('succeeds', async () => {
      const initArgs = [initVals.token, initVals.t1Addresses, initVals.t1PubKeysLHS, initVals.t1PubKeysRHS, initVals.t2PubKeys];
      const newBridge = await upgrades.deployProxy(AVNBridge, initArgs, { kind: 'uups' });

      for (i = 0; i < helper.MIN_AUTHORS; i++) {
        const authorId = i + 1;
        expect(await newBridge.t1AddressToId(initVals.t1Addresses[i])).to.equal(authorId);
        expect(await newBridge.t2PubKeyToId(initVals.t2PubKeys[i])).to.equal(authorId);
        expect(await newBridge.isAuthor(authorId)).to.equal(true);
        expect(await newBridge.authorIsActive(authorId)).to.equal(true);
        expect(await newBridge.idToT1Address(authorId)).to.equal(initVals.t1Addresses[i]);
        expect(await newBridge.idToT2PubKey(authorId)).to.equal(initVals.t2PubKeys[i]);
      }

      expect(await newBridge.numActiveAuthors()).to.equal(helper.MIN_AUTHORS);
      expect(await newBridge.nextAuthorId()).to.equal(helper.MIN_AUTHORS + 1);
    });

    it('fails without a core token', async () => {
      initVals.token = helper.ZERO_ADDRESS;
      await deployAndCatchInitError('MissingCore');
    });

    it('fails when a T1 address does not correspond to its public key', async () => {
      initVals.t1PubKeysLHS[0] = authors[helper.MIN_AUTHORS].t1PubKeyLHS;
      await deployAndCatchInitError('AddressMismatch');
    });

    it('fails when keys are missing', async () => {
      initVals.t1Addresses.push(authors[helper.MIN_AUTHORS].t1Address);
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
      initVals.t1Addresses.pop();
      initVals.t1PubKeysLHS.pop();
      initVals.t1PubKeysRHS.pop();
      initVals.t2PubKeys.pop();
      await deployAndCatchInitError('NotEnoughAuthors');
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
      const initArgs = helper.generateInitArgs(token20.address, helper.MIN_AUTHORS);
      await expect(avnBridge.initialize(...initArgs)).to.be.reverted;
    });
  });
});
