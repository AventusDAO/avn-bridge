const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token777, token20;
let accounts, authors;
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
    await helper.loadAuthors(avnBridge, authors, 10);
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

    context('fails if', async () => {
      it('the new owner has a zero address', async () => {
        await expect(avnBridge.transferOwnership(helper.ZERO_ADDRESS)).to.be.revertedWith(
          'Ownable: new owner is the zero address'
        );
      });

      it('the sender is not the owner', async () => {
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
      it('if the sender is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).updateLowerCall(newID, helper.DIRECT_LOWER_NUM_BYTES)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
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
      it('if not called by the owner', async () => {
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
      it('if the sender is not the owner', async () => {
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

    context('fails when', async () => {
      it('the sender is not the owner', async () => {
        await expect(avnBridge.connect(someOtherAccount).setGrowthDelay(5)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });
});
