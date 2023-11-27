const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token777, token20;
let accounts, authors, numAuthors;
let owner, someOtherAccount, someT2PubKey;

describe('Owner Functions', async () => {
  before(async () => {
    await helper.init();
    const Token777 = await ethers.getContractFactory('Token777');
    token777 = await Token777.deploy(10000000);
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000);
    avnBridge = await helper.deployAVNBridge(token20.address);
    accounts = helper.accounts();
    owner = helper.owner();
    someOtherAccount = accounts[1];
    someT2PubKey = helper.someT2PubKey();
    authors = helper.authors();
    numAuthors = 10;
    await helper.loadAuthors(avnBridge, authors, numAuthors);
    await token20.transferOwnership(avnBridge.address);
  });

  context('Transferring Ownership', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        await expect(avnBridge.transferOwnership(someOtherAccount.address))
          .to.emit(avnBridge, 'OwnershipTransferred')
          .withArgs(owner, someOtherAccount.address);
        expect(someOtherAccount.address).to.equal(await avnBridge.owner());
        await avnBridge.connect(someOtherAccount).transferOwnership(owner);
        expect(owner.address, await avnBridge.owner());
      });
    });

    context('fails', async () => {
      it('when the new owner has a zero address', async () => {
        await expect(avnBridge.transferOwnership(helper.ZERO_ADDRESS)).to.be.revertedWith(
          'Ownable: new owner is the zero address'
        );
      });

      it('when the caller is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).transferOwnership(owner)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });

  context('Updating lower IDs', async () => {
    const newID = '0xff00';

    async function checkCanLower() {
      await avnBridge.liftETH(someT2PubKey, { value: ethers.utils.parseEther('1000', 'wei') });
      const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, 1000, false, newID);
      try {
        await avnBridge.lower(tree.leafData, tree.merklePath);
      } catch (error) {
        return false;
      }
      return true;
    }

    context('succeeds', async () => {
      it('when called by the owner', async () => {
        await expect(avnBridge.updateLowerCall(newID, helper.DIRECT_LOWER_NUM_BYTES))
          .to.emit(avnBridge, 'LogLowerCallUpdated')
          .withArgs(newID, helper.DIRECT_LOWER_NUM_BYTES);
        expect(await checkCanLower()).to.equal(true);
      });

      it('in removing a lower call by setting numbytes to zero', async () => {
        await expect(avnBridge.updateLowerCall(newID, 0)).to.emit(avnBridge, 'LogLowerCallUpdated').withArgs(newID, 0);
        expect(await checkCanLower()).to.equal(false);
      });

      it('checking an existing lower call', async () => {
        expect(await avnBridge.numBytesToLowerData(helper.LOWER_ID)).to.equal(helper.DIRECT_LOWER_NUM_BYTES);
      });

      it('checking an existing proxy lower pointer', async () => {
        expect(await avnBridge.numBytesToLowerData(helper.PROXY_LOWER_ID)).to.equal(helper.PROXY_LOWER_NUM_BYTES);
      });

      it('checking a non-existent pointer', async () => {
        expect(await avnBridge.numBytesToLowerData(newID)).to.equal(0);
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(
          avnBridge.connect(someOtherAccount).updateLowerCall(newID, helper.DIRECT_LOWER_NUM_BYTES)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  context('Setting the Core Owner', async () => {
    after(async () => {
      await token20.setOwner(avnBridge.address);
    });

    context('succeeds', async () => {
      it('in setting the core token owner via the avn bridge', async () => {
        expect(await token20.owner()).to.equal(avnBridge.address);
        await expect(avnBridge.setCoreOwner()).to.emit(token20, 'LogSetOwner').withArgs(owner);
        expect(await token20.owner()).to.equal(owner);
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).setCoreOwner()).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  context('Denying growth', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        await expect(avnBridge.denyGrowth(0)).to.emit(avnBridge, 'LogGrowthDenied').withArgs(0);
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).denyGrowth(0)).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  context('Setting the growth delay', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        const oldGrowthDelay = (await avnBridge.growthDelay()).toNumber();
        expect(60 * 60 * 24 * 7).to.equal(oldGrowthDelay);
        const newGrowthDelay = helper.GROWTH_DELAY;
        await expect(avnBridge.setGrowthDelay(newGrowthDelay))
          .to.emit(avnBridge, 'LogGrowthDelayUpdated')
          .withArgs(oldGrowthDelay, newGrowthDelay);
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).setGrowthDelay(5)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });

  context('Marking hashes spent', async () => {
    context('succeeds', async () => {
      it('when called by the owner', async () => {
        const leafHashes = Array.from({ length: 72 }, () => helper.randomBytes32());

        expect(await avnBridge.hasLowered(leafHashes[0])).to.equal(false);
        expect(await avnBridge.hasLowered(leafHashes[leafHashes.length - 1])).to.equal(false);

        expect(await avnBridge.markSpent(leafHashes)).to.emit(avnBridge, 'LogMarkSpent');

        expect(await avnBridge.hasLowered(leafHashes[0])).to.equal(true);
        expect(await avnBridge.hasLowered(leafHashes[leafHashes.length - 1])).to.equal(true);
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).markSpent([helper.randomBytes32()])).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });

  context('Loading Authors', async () => {
    let t1Address, t1PubKeyLHS, t1PubKeyRHS, t2PubKey;

    beforeEach(async () => {
      const newAuthor = authors[++numAuthors];
      t1Address = [newAuthor.t1Address];
      t1PubKeyLHS = [newAuthor.t1PubKeyLHS];
      t1PubKeyRHS = [newAuthor.t1PubKeyRHS];
      t2PubKey = [newAuthor.t2PubKey];
    });

    context('succeeds', async () => {
      it('when called by the owner', async () => {
        await expect(avnBridge.loadAuthors(t1Address, t1PubKeyLHS, t1PubKeyRHS, t2PubKey));
      });
    });
    context('fails', async () => {
      it('when a T1 address is already in use', async () => {
        t1Address = [authors[1].t1Address];
        await expect(avnBridge.loadAuthors(t1Address, t1PubKeyLHS, t1PubKeyRHS, t2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'AddressInUse'
        );
      });

      it('when a T2 key is already in use', async () => {
        t2PubKey = [authors[1].t2PubKey];
        await expect(avnBridge.loadAuthors(t1Address, t1PubKeyLHS, t1PubKeyRHS, t2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'T2KeyInUse'
        );
      });

      it('when a T1 address does not correspond to its public key', async () => {
        t1PubKeyLHS = [authors[++numAuthors].t1PubKeyLHS];
        await expect(avnBridge.loadAuthors(t1Address, t1PubKeyLHS, t1PubKeyRHS, t2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'AddressMismatch'
        );
      });

      it('when keys are missing', async () => {
        t1Address.push(authors[++numAuthors].t1Address);
        await expect(avnBridge.loadAuthors(t1Address, t1PubKeyLHS, t1PubKeyRHS, t2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'MissingKeys'
        );
      });

      it('when the caller is not the owner', async () => {
        await expect(
          avnBridge.connect(someOtherAccount).loadAuthors(t1Address, t1PubKeyLHS, t1PubKeyRHS, t2PubKey)
        ).to.be.revertedWith('Ownable: caller is not the owner');
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
          await expect(avnBridge.connect(someOtherAccount).toggleAuthors(true)).to.be.revertedWith(
            'Ownable: caller is not the owner'
          );
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
          await expect(avnBridge.connect(someOtherAccount).toggleLifting(true)).to.be.revertedWith(
            'Ownable: caller is not the owner'
          );
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
          await expect(avnBridge.connect(someOtherAccount).toggleLowering(true)).to.be.revertedWith(
            'Ownable: caller is not the owner'
          );
          await expect(avnBridge.toggleLowering(true)).to.emit(avnBridge, 'LogLoweringEnabled').withArgs(true);
        });
      });
    });
  });

  context('Core Token', async () => {
    let bridgeWithIncompatibleCore;

    before(async () => {
      bridgeWithIncompatibleCore = await helper.deployAVNBridge(token777.address);
    });

    it('Cannot deploy a new contract without a core token', async () => {
      const AVNBridge = await ethers.getContractFactory('AVNBridge');
      await expect(upgrades.deployProxy(AVNBridge, [helper.ZERO_ADDRESS], { kind: 'uups' })).to.be.reverted;
    });

    it('Cannot set the core owner on an incompatible token', async () => {
      await expect(bridgeWithIncompatibleCore.setCoreOwner()).to.be.revertedWithCustomError(
        bridgeWithIncompatibleCore,
        'SetCoreOwnerFailed'
      );
    });
  });
});
