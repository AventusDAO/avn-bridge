const helper = require('./helpers/testHelper');
const { expect } = require('chai');

const AVT_ADDRESS = '0x0d88eD6E74bbFD96B831231638b66C05571e824F';
const DIRECT_LOWER_NUM_BYTES = 2;
const PROXY_LOWER_NUM_BYTES = 133;

let avnBridge, token777, token20;
let accounts, validators;
let owner, someOtherAccount, someT2PublicKey;

describe('AVNBridge', async () => {

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
    someT2PublicKey = helper.someT2PublicKey();
    validators = helper.validators();
    await helper.loadValidators(avnBridge, validators, 10);
    await token20.transferOwnership(avnBridge.address);
  });

  context('transferOwnership', async () => {

    it('succeeds', async () => {
      await expect(avnBridge.transferOwnership(someOtherAccount.address)).to.emit(avnBridge, 'OwnershipTransferred')
          .withArgs(owner, someOtherAccount.address);
      expect(someOtherAccount.address).to.equal(await avnBridge.owner());
      await avnBridge.connect(someOtherAccount).transferOwnership(owner);
      expect(owner.address, await avnBridge.owner());
    });

    it('fails if the new owner has a zero address', async () => {
      await expect(avnBridge.transferOwnership(helper.ZERO_ADDRESS))
          .to.be.revertedWith('Ownable: new owner is the zero address');
    });

    it('fails if the sender is not owner', async () => {
      await expect(avnBridge.connect(someOtherAccount).transferOwnership(owner))
          .to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  context('update and check lower IDs', async () => {
    const newID = '0xff00';

    async function checkCanLower() {
      await avnBridge.liftETH(someT2PublicKey, { value: ethers.utils.parseEther('1000', 'wei') });
      const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, 1000, false, newID);
      try {
        await avnBridge.lower(tree.leafData, tree.merklePath);
      } catch (error) {
        return false;
      }
      return true;
    }

    it('owner can add a lower call', async () => {
      await expect(avnBridge.updateLowerCall(newID, DIRECT_LOWER_NUM_BYTES)).to.emit(avnBridge, 'LogLowerCallUpdated')
          .withArgs(newID, DIRECT_LOWER_NUM_BYTES);
      expect(await checkCanLower()).to.equal(true);
    });

    it('owner can remove a lower call by setting numbytes to zero', async () => {
      await expect(avnBridge.updateLowerCall(newID, 0)).to.emit(avnBridge, 'LogLowerCallUpdated').withArgs(newID, 0);
      expect(await checkCanLower()).to.equal(false);
    });

    it('fails to update a lower call when not the owner', async () => {
      await expect(avnBridge.connect(someOtherAccount).updateLowerCall(newID, DIRECT_LOWER_NUM_BYTES))
          .to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('check an existing lower call', async () => {
      expect(await avnBridge.numBytesToLowerData(helper.LOWER_ID)).to.equal(DIRECT_LOWER_NUM_BYTES);
    });

    it('check an existing proxy lower pointer', async () => {
      expect(await avnBridge.numBytesToLowerData(helper.PROXY_LOWER_ID)).to.equal(PROXY_LOWER_NUM_BYTES);
    });

    it('check a non-existent pointer', async () => {
      expect(await avnBridge.numBytesToLowerData(newID)).to.equal(0);
    });
  });

  context('lift()', async () => {

    it('can lift ETH [ @skip-on-coverage ]', async () => {
      const avnEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
      const lifterEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(owner));
      const liftAmount = ethers.BigNumber.from(123);

      const txResponse = await avnBridge.liftETH(someT2PublicKey, { value: liftAmount });
      const txReceipt = await txResponse.wait(1);
      const txCost = ethers.BigNumber.from(txReceipt.gasUsed).mul(txResponse.gasPrice);

      const avnEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
      const lifterEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

      expect(avnEthBalanceBefore.add(liftAmount)).to.equal(avnEthBalanceAfter);
      expect(lifterEthBalanceBefore.sub(liftAmount).sub(txCost)).to.equal(lifterEthBalanceAfter);
    });

    it('can lift ERC777 tokens', async () => {
      const liftAmount = ethers.BigNumber.from(100)
      await expect(token777.send(avnBridge.address, liftAmount, someT2PublicKey)).to.emit(avnBridge, 'LogLifted')
          .withArgs(token777.address, owner, someT2PublicKey, liftAmount);
    });

    it('can lift ERC777 tokens via operatorSend', async () => {
      const liftAmount = ethers.BigNumber.from(100)
      const otherOperatorData = '0x1234';
      await expect(token777.operatorSend(owner, avnBridge.address, liftAmount, someT2PublicKey, otherOperatorData))
          .to.emit(avnBridge, 'LogLifted').withArgs(token777.address, owner, someT2PublicKey, liftAmount);

    });

    it('can lift ERC20 tokens', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const liftAmount = ethers.BigNumber.from(200);
      await token20.approve(avnBridge.address, liftAmount);
      await expect(avnBridge.lift(token20.address, someT2PublicKey, liftAmount)).to.emit(avnBridge, 'LogLifted')
          .withArgs(token20.address, owner, someT2PublicKey, liftAmount);
      expect(avnBalanceBefore.add(liftAmount), (await token20.balanceOf(avnBridge.address)));
    });

    context('fails when', async () => {
      let massiveERC20, massiveERC777, maxLiftAmount;

      before(async () => {
        const massiveTotalSupply = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(192));
        maxLiftAmount = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(128)).sub(ethers.BigNumber.from(1));
        const Token777 = await ethers.getContractFactory('Token777');
        massiveERC777 = await Token777.deploy(massiveTotalSupply);
        await massiveERC777.send(avnBridge.address, maxLiftAmount, someT2PublicKey);
        const Token20 = await ethers.getContractFactory('Token20');
        massiveERC20 = await Token20.deploy(massiveTotalSupply);
        await massiveERC20.approve(avnBridge.address, maxLiftAmount);
        await avnBridge.lift(massiveERC20.address, someT2PublicKey, maxLiftAmount);
      });

      it('attempting to lift 0 ETH', async () => {
        await expect(avnBridge.liftETH(someT2PublicKey)).to.be.revertedWithCustomError(avnBridge, 'AmountCannotBeZero');
      });

      it('attempting to lift ETH without supplying a public key', async () => {
        await expect(avnBridge.liftETH('0x', { value: 100 })).to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift ETH with an incorrect T2 public key (too short)', async () => {
        await expect(avnBridge.liftETH(helper.randomHex(16), { value: 100 }))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift ETH with an incorrect T2 public key(too long)', async () => {
        await expect(avnBridge.liftETH(helper.randomHex(48), { value: 100 }))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift 0 ERC20 tokens', async () => {
        await token20.approve(avnBridge.address, 0);
        await expect(avnBridge.lift(token20.address, someT2PublicKey, 0))
            .to.be.revertedWithCustomError(avnBridge, 'AmountCannotBeZero');
      });

      it('attempting to lift ERC-20 tokens without supplying a T2 public key', async () => {
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, '0x', 1)).to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key (too short)', async () => {
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, helper.randomHex(16), 1))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key(too long)', async () => {
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, helper.randomHex(48), 1))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift 0 ERC777 tokens', async () => {
        await expect(token777.send(avnBridge.address, 0, someT2PublicKey))
            .to.be.revertedWithCustomError(avnBridge, 'AmountCannotBeZero');
      });

      it('attempting to lift ERC777 tokens without supplying a T2 public key', async () => {
        await expect(token777.send(avnBridge.address, 1, '0x')).to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key (too short)', async () => {
        await expect(token777.send(avnBridge.address, 1, helper.randomHex(16)))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key(too long)', async () => {
        await expect(token777.send(avnBridge.address, 1, helper.randomHex(48)))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidT2PublicKey');
      });

      it('attempting to lift more ERC777 tokens to T2 than its supported limit', async () => {
        await expect(massiveERC777.send(avnBridge.address, 1, someT2PublicKey))
            .to.be.revertedWithCustomError(avnBridge, 'LiftLimitExceeded');
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        await massiveERC20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(massiveERC20.address, someT2PublicKey, 1))
            .to.be.revertedWithCustomError(avnBridge, 'LiftLimitExceeded');
      });

      it('attempting to lift ETH when lift is disabled', async () => {
        await expect(avnBridge.toggleLifting(false)).to.emit(avnBridge, 'LogLiftingIsEnabled').withArgs(false);
        await expect(avnBridge.liftETH(someT2PublicKey, {value:100}))
            .to.be.revertedWithCustomError(avnBridge, 'LiftingIsDisabled');
        await expect(avnBridge.toggleLifting(true)).to.emit(avnBridge, 'LogLiftingIsEnabled').withArgs(true);
        await avnBridge.liftETH(someT2PublicKey, {value:100});
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await expect(token777.send(avnBridge.address, 1, someT2PublicKey))
            .to.be.revertedWithCustomError(avnBridge, 'LiftingIsDisabled');
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1, someT2PublicKey);
      });

      it('attempting to lift ERC20 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, someT2PublicKey, 1))
            .to.be.revertedWithCustomError(avnBridge, 'LiftingIsDisabled');
        await avnBridge.toggleLifting(true);
        await avnBridge.lift(token20.address, someT2PublicKey, 1);
      });

      it('attempting to lift ERC777 tokens using ERC20 backwards compatability ', async () => {
        const amount = ethers.BigNumber.from(2);
        await token777.approve(avnBridge.address, amount);
        await expect(avnBridge.lift(token777.address, someT2PublicKey, amount))
            .to.be.revertedWithCustomError(avnBridge, 'ERC20LiftingOnly');
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await expect(token777.send(avnBridge.address, 1, someT2PublicKey))
            .to.be.revertedWithCustomError(avnBridge, 'LiftingIsDisabled');
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1, someT2PublicKey);
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await token20.approve(avnBridge.address, 100);
        await expect(avnBridge.lift(token20.address, someT2PublicKey, 200))
            .to.be.rejectedWith(token20, 'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await expect(avnBridge.connect(someOtherAccount).lift(token20.address, someT2PublicKey, 1))
            .to.be.rejectedWith(token20, 'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC777 tokens than are available in sender balance', async () => {
        await expect(token777.connect(someOtherAccount).send(avnBridge.address, 1, someT2PublicKey))
            .to.be.rejectedWith(token777, 'ERC777: transfer amount exceeds balance');
      });

      it('calling FTSM tokensReceived hook directly with tokens not destined for the FTSM', async () => {
        await expect(avnBridge.tokensReceived(owner, owner, someOtherAccount.address, 100, someT2PublicKey, '0x'))
            .to.be.revertedWithCustomError(avnBridge, 'TokensMustBeSentToThisAddress');
      });

      it('calling FTSM tokensReceived hook directly and not a registered contract', async () => {
        await expect(avnBridge.tokensReceived(owner, owner, avnBridge.address, 100, someT2PublicKey, '0x'))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidERC777Token');
      });
    });
  });

  context('lower()', async () => {
    const liftAmount = ethers.BigNumber.from(100);
    const lowerAmount = ethers.BigNumber.from(50);

    it('lower ETH succeeds [ @skip-on-coverage ]', async () => {
      await avnBridge.liftETH(someT2PublicKey, { value: liftAmount });
      const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount);

      const avnEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
      const lowererEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

      const txResponse = await avnBridge.lower(tree.leafData, tree.merklePath);
      const txReceipt = await txResponse.wait(1);
      const gasPrice = ethers.BigNumber.from(await ethers.provider.getGasPrice());
      const txCost = ethers.BigNumber.from(txReceipt.gasUsed).mul(txResponse.gasPrice);


      const avnEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
      const lowererEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

      expect(avnEthBalanceBefore.sub(lowerAmount)).to.equal(avnEthBalanceAfter);
      expect(lowererEthBalanceBefore.add(lowerAmount).sub(txCost)).to.equal(lowererEthBalanceAfter);

      await avnBridge.filters.LogLowered(helper.PSEUDO_ETH_ADDRESS, owner, someT2PublicKey);
    });

    it('proxy lower ETH succeeds [ @skip-on-coverage ]', async () => {
      await avnBridge.liftETH(someT2PublicKey, { value: liftAmount });
      const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount, true);

      const avnEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
      const lowererEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

      const txResponse = await avnBridge.lower(tree.leafData, tree.merklePath);
      const txReceipt = await txResponse.wait(1);
      const gasPrice = ethers.BigNumber.from(await ethers.provider.getGasPrice());
      const txCost = ethers.BigNumber.from(txReceipt.gasUsed).mul(txResponse.gasPrice);

      const avnEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
      const lowererEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

      expect(avnEthBalanceBefore.sub(lowerAmount)).to.equal(avnEthBalanceAfter);
      expect(lowererEthBalanceBefore.add(lowerAmount).sub(txCost)).to.equal(lowererEthBalanceAfter);

      await avnBridge.filters.LogLowered(helper.PSEUDO_ETH_ADDRESS, owner, someT2PublicKey);
    });

    it('lift and lower ETH for coverage', async () => {
      await avnBridge.liftETH(someT2PublicKey, { value: 100 });
      const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount);
      await avnBridge.lower(tree.leafData, tree.merklePath);
    });

    it('proxy lift and lower ETH for coverage', async () => {
      await avnBridge.liftETH(someT2PublicKey, { value: 100 });
      const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount, true);
      await avnBridge.lower(tree.leafData, tree.merklePath);
    });

    it('lower ERC20 succeeds', async () => {
      // lift
      await token20.approve(avnBridge.address, liftAmount);
      await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);
      // record pre-lower balances
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const senderBalBefore = await token20.balanceOf(owner);

      let tree = await helper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount);

      // lower and confirm values
      await expect(avnBridge.connect(someOtherAccount).lower(tree.leafData, tree.merklePath)).to.emit(avnBridge, 'LogLowered')
          .withArgs(token20.address, owner, someT2PublicKey, lowerAmount);
      expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token20.balanceOf(avnBridge.address));
      expect(senderBalBefore.add(lowerAmount)).to.equal(await token20.balanceOf(owner));
    });

    it('proxy lower ERC20 succeeds', async () => {
      // lift
      await token20.approve(avnBridge.address, liftAmount);
      await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);
      // record pre-lower balances
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const senderBalBefore = await token20.balanceOf(owner);

      let tree = await helper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount, true);

      // lower and confirm values
      await expect(avnBridge.connect(someOtherAccount).lower(tree.leafData, tree.merklePath))
          .to.emit(avnBridge, 'LogLowered').withArgs(token20.address, owner, someT2PublicKey, lowerAmount);
      expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token20.balanceOf(avnBridge.address));
      expect(senderBalBefore.add(lowerAmount)).to.equal(await token20.balanceOf(owner));
    });

    it('lower ERC777 succeeds', async () => {
      // lift
      await token777.send(avnBridge.address, liftAmount, someT2PublicKey);
      // record pre-lower balances
      const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
      const senderBalBefore = await token777.balanceOf(owner);

      let tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount);

      // lower and confirm values
      await expect(avnBridge.connect(someOtherAccount).lower(tree.leafData, tree.merklePath)).to.emit(avnBridge, 'LogLowered')
          .withArgs(token777.address, owner, someT2PublicKey, lowerAmount);
      expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token777.balanceOf(avnBridge.address));
      expect(senderBalBefore.add(lowerAmount)).to.equal(await token777.balanceOf(owner));
    });

    it('proxy lower ERC777 succeeds', async () => {
      // lift
      await token777.send(avnBridge.address, liftAmount, someT2PublicKey);
      // record pre-lower balances
      const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
      const senderBalBefore = await token777.balanceOf(owner);

      let tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount, true);

      // lower and confirm values
      await expect(avnBridge.connect(someOtherAccount).lower(tree.leafData, tree.merklePath)).to.emit(avnBridge, 'LogLowered')
          .withArgs(token777.address, owner, someT2PublicKey, lowerAmount);
      expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token777.balanceOf(avnBridge.address));
      expect(senderBalBefore.add(lowerAmount)).to.equal(await token777.balanceOf(owner));
    });

    context('lower fails when', async () => {
      let tree;
      let lowerAmount = 100;

      beforeEach(async () => {
        tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount);
      });

      it('lowering is disabled', async () => {
        await expect(avnBridge.toggleLowering(false)).to.emit(avnBridge, 'LogLoweringIsEnabled').withArgs(false);
        await expect(avnBridge.lower(tree.leafData, tree.merklePath))
            .to.be.revertedWithCustomError(avnBridge, 'LoweringIsDisabled');
        await expect(avnBridge.toggleLowering(true)).to.emit(avnBridge, 'LogLoweringIsEnabled').withArgs(true);
        await avnBridge.lower(tree.leafData, tree.merklePath);
      });

      it('the leaf has already been used for a lower', async () => {
        await avnBridge.lower(tree.leafData, tree.merklePath);
        await expect(avnBridge.lower(tree.leafData, tree.merklePath))
            .to.be.revertedWithCustomError(avnBridge, 'LowerAlreadyUsed');
      });

      it('leaf is invalid', async () => {
        await expect(avnBridge.lower(helper.randomBytes32(), tree.merklePath))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidLowerData');
      });

      it('path is invalid', async () => {
        await expect(avnBridge.lower(tree.leafData, [helper.randomBytes32()]))
            .to.be.revertedWithCustomError(avnBridge, 'InvalidLowerData');
      });

      it('leaf is not recognised as a lower leaf', async () => {
        const  badId = '0xaaaa';
        tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount, true, badId);
        await expect(avnBridge.lower(tree.leafData, tree.merklePath))
            .to.be.revertedWithCustomError(avnBridge, 'NotALowerTransaction');
      });

      it('attempting to lower ETH to an address which cannot receive it', async () => {
        await avnBridge.liftETH(someT2PublicKey, { value: lowerAmount });
        const addressCannotReceiveETH = token20.address;
        tree = await helper.createTreeAndPublishRootWithLoweree(avnBridge, addressCannotReceiveETH, helper.PSEUDO_ETH_ADDRESS,
            lowerAmount);
        await expect(avnBridge.lower(tree.leafData, tree.merklePath)).to.be.revertedWithCustomError(avnBridge, 'PaymentFailed');
      });
    });
  });

  context('confirmT2Transaction', async() =>{
    it('confirm a leaf exists in published tree', async () => {
      let tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, 0);
      expect(await avnBridge.confirmAvnTransaction(tree.leafHash, tree.merklePath)).to.equal(true);
      expect(await avnBridge.confirmAvnTransaction(helper.randomBytes32(), tree.merklePath)).to.equal(false);
    });
  });

  context('triggerGrowth - via owner', async () => {
    const growthAmount = helper.ONE_AVT_IN_ATTO.mul(ethers.BigNumber.from(5));

    it('fails to trigger zero growth', async () => {
      const expiry = await helper.getValidExpiry();
      await expect(avnBridge.triggerGrowth(0, 1, expiry, 0, '0x')).to.be.revertedWithCustomError(avnBridge, 'AmountCannotBeZero');
    });

    it('fails to trigger growth if called without validator confirmations by someone other than the owner', async () => {
      const expiry = await helper.getValidExpiry();
      await expect(avnBridge.connect(someOtherAccount).triggerGrowth(growthAmount, 1, expiry, 0, '0x'))
          .to.be.revertedWithCustomError(avnBridge, 'OwnerOnly');
    });

    it('succeeds for growth period "2"', async () => {
      const period = 2;
      const expiry = await helper.getValidExpiry();
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      await expect(avnBridge.triggerGrowth(growthAmount, period, expiry, 0, '0x')).to.emit(avnBridge, 'LogGrowth')
          .withArgs(growthAmount, period);

      expect(avnBalanceBefore.add(growthAmount)).to.equal(await token20.balanceOf(avnBridge.address));
      expect(avtSupplyBefore.add(growthAmount)).to.equal(await token20.totalSupply());
    });

    it('succeeds for growth period "1"', async () => {
      const period = 1;
      const expiry = await helper.getValidExpiry();
      await expect(avnBridge.triggerGrowth(growthAmount, period, expiry, 0, '0x')).to.emit(avnBridge, 'LogGrowth')
          .withArgs(growthAmount, period);
    });

    it('fails to re-trigger growth for an existing period', async () => {
      const expiry = await helper.getValidExpiry();
      await expect(avnBridge.triggerGrowth(growthAmount, 1, expiry, 0, '0x'))
          .to.be.revertedWithCustomError(avnBridge, 'GrowthPeriodAlreadyUsed');
    });
  });
});