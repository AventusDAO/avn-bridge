const testHelper = require('./helpers/testHelper');
const Token777 = artifacts.require('Token777');
const Token20 = artifacts.require('Token20');
const BN = web3.utils.BN;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const AVT_ADDRESS = '0x0d88eD6E74bbFD96B831231638b66C05571e824F';
const DIRECT_LOWER_NUM_BYTES = 2;
const PROXY_LOWER_NUM_BYTES = 133;
const ONE_AVT_IN_ATTO = new BN(10).pow(new BN(18));

let avnBridge, token777, token20;
let accounts, validators;
let owner, someOtherAccount, someT2PublicKey;

contract('AVNBridge', async () => {

  before(async () => {
    await testHelper.init();
    token777 = await Token777.deployed();
    token20 = await Token20.deployed();
    avnBridge = await testHelper.deployAVNBridge(token20.address);
    accounts = testHelper.accounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    someT2PublicKey = testHelper.someT2PublicKey();
    validators = testHelper.validators();
    await testHelper.loadValidators(avnBridge, validators, 10);
    await token20.transferOwnership(avnBridge.address);
  });

  context('transferOwnership', async () => {

    it('succeeds', async () => {
      await avnBridge.transferOwnership(someOtherAccount);
      assert.equal(someOtherAccount, await avnBridge.owner());
      const logArgs = await testHelper.getLogArgs(avnBridge, 'OwnershipTransferred');
      assert.equal(logArgs.previousOwner, owner);
      assert.equal(logArgs.newOwner, someOtherAccount);
      await avnBridge.transferOwnership(owner, {from: someOtherAccount});
      assert.equal(owner, await avnBridge.owner());
    });

    it('fails if the new owner has a zero address', async () => {
      await testHelper.expectRevert(() => avnBridge.transferOwnership(ZERO_ADDRESS), 'Ownable: new owner is the zero address');
    });

    it('fails if the sender is not owner', async () => {
      await testHelper.expectRevert(() => avnBridge.transferOwnership(owner, {from: someOtherAccount}), 'Ownable: caller is not the owner');
    });
  });

  context('update and check lower IDs', async () => {
    const newID = '0xff00';

    async function checkCanLower() {
      await avnBridge.liftETH(someT2PublicKey, {value: 1000});
      const tree = await testHelper.createTreeAndPublishRoot(avnBridge, testHelper.PSEUDO_ETH_ADDRESS, 1000, false, newID);
      try {
        await avnBridge.lower(tree.leafData, tree.merklePath);
      } catch (error) {
        return false;
      }
      return true;
    }

    it('owner can add a lower call', async () => {
      await avnBridge.updateLowerCall(newID, DIRECT_LOWER_NUM_BYTES);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowerCallUpdated');
      assert.equal(logArgs.callId, newID);
      assert.equal(logArgs.numBytes.toNumber(), DIRECT_LOWER_NUM_BYTES);
      assert.equal(await checkCanLower(), true);
    });

    it('owner can remove a lower call by setting numbytes to zero', async () => {
      await avnBridge.updateLowerCall(newID, 0);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowerCallUpdated');
      assert.equal(logArgs.callId, newID);
      assert.equal(logArgs.numBytes.toNumber(), 0);
      assert.equal(await checkCanLower(), false);
    });

    it('fails to update a lower call when not the owner', async () => {
      await testHelper.expectRevert(() => avnBridge.updateLowerCall(newID, DIRECT_LOWER_NUM_BYTES, {from: someOtherAccount}),
          'Ownable: caller is not the owner');
    });

    it('check an existing lower call', async () => {
      assert.equal(await avnBridge.numBytesToLowerData(testHelper.LOWER_ID), DIRECT_LOWER_NUM_BYTES);
    });

    it('check an existing proxy lower pointer', async () => {
      assert.equal(await avnBridge.numBytesToLowerData(testHelper.PROXY_LOWER_ID), PROXY_LOWER_NUM_BYTES);
    });

    it('check a non-existent pointer', async () => {
      assert.equal(await avnBridge.numBytesToLowerData(newID), 0);
    });
  });

  context('lift()', async () => {

    it('can lift ETH [ @skip-on-coverage ]', async () => {
      const avnEthBalanceBefore = new BN(await web3.eth.getBalance(avnBridge.address));
      const lifterEthBalanceBefore = new BN(await web3.eth.getBalance(owner));
      const liftAmount = new BN(123);

      const tx = await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
      const gasPrice = new BN(await web3.eth.getGasPrice());
      const txCost = new BN(tx.receipt.gasUsed).mul(gasPrice);

      const avnEthBalanceAfter = new BN(await web3.eth.getBalance(avnBridge.address));
      const lifterEthBalanceAfter = new BN(await web3.eth.getBalance(owner));

      assert.equal(avnEthBalanceBefore.add(liftAmount).toString(), avnEthBalanceAfter.toString());
      assert.equal(lifterEthBalanceBefore.sub(liftAmount).sub(txCost).toString(), lifterEthBalanceAfter.toString());

      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLifted');
      assert.equal(logArgs.token, testHelper.PSEUDO_ETH_ADDRESS);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC777 tokens', async () => {
      const liftAmount = new BN(100)
      await token777.send(avnBridge.address, liftAmount, someT2PublicKey);

      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLifted');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC777 tokens via operatorSend', async () => {
      const liftAmount = new BN(100)
      const otherOperatorData = '0x1234';
      await token777.operatorSend(owner, avnBridge.address, liftAmount, someT2PublicKey, otherOperatorData);
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLifted');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC20 tokens', async () => {
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const liftAmount = new BN(200);
      await token20.approve(avnBridge.address, liftAmount);
      await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);

      assert.equal(avnBalanceBefore.add(liftAmount).toString(), (await token20.balanceOf(avnBridge.address)).toString());

      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLifted');
      assert.equal(logArgs.token, token20.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    context('fails when', async () => {
      let massiveERC20, massiveERC777, maxLiftAmount;

      before(async () => {
        const massiveTotalSupply = new BN(2).pow(new BN(192));
        maxLiftAmount = new BN(2).pow(new BN(128)).sub(new BN(1));

        massiveERC777 = await Token777.new(massiveTotalSupply);
        await massiveERC777.send(avnBridge.address, maxLiftAmount, someT2PublicKey);

        massiveERC20 = await Token20.new(massiveTotalSupply);
        await massiveERC20.approve(avnBridge.address, maxLiftAmount);
        await avnBridge.lift(massiveERC20.address, someT2PublicKey, maxLiftAmount);
      });

      it('attempting to lift 0 ETH', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.liftETH(someT2PublicKey), 'AmountCannotBeZero()');
      });

      it('attempting to lift ETH without supplying a public key', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.liftETH('0x', {value: 100}), 'InvalidT2PublicKey()');
      });

      it('attempting to lift ETH with an incorrect T2 public key (too short)', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.liftETH(web3.utils.randomHex(16), {value: 100}), 'InvalidT2PublicKey()');
      });

      it('attempting to lift ETH with an incorrect T2 public key(too long)', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.liftETH(web3.utils.randomHex(48), {value: 100}), 'InvalidT2PublicKey()');
      });

      it('attempting to lift 0 ERC20 tokens', async () => {
        await token20.approve(avnBridge.address, 0);
        await testHelper.expectCustomRevert(() => avnBridge.lift(token20.address, someT2PublicKey, 0), 'AmountCannotBeZero()');
      });

      it('attempting to lift ERC-20 tokens without supplying a T2 public key', async () => {
        await token20.approve(avnBridge.address, 1);
        await testHelper.expectCustomRevert(() => avnBridge.lift(token20.address, '0x', 1), 'InvalidT2PublicKey()');
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key (too short)', async () => {
        await token20.approve(avnBridge.address, 1);
        await testHelper.expectCustomRevert(() => avnBridge.lift(token20.address, web3.utils.randomHex(16), 1), 'InvalidT2PublicKey()');
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key(too long)', async () => {
        await token20.approve(avnBridge.address, 1);
        await testHelper.expectCustomRevert(() => avnBridge.lift(token20.address, web3.utils.randomHex(48), 1), 'InvalidT2PublicKey()');
      });

      it('attempting to lift 0 ERC777 tokens', async () => {
        await testHelper.expectCustomRevert(() => token777.send(avnBridge.address, 0, someT2PublicKey), 'AmountCannotBeZero()');
      });

      it('attempting to lift ERC777 tokens without supplying a T2 public key', async () => {
        await testHelper.expectCustomRevert(() => token777.send(avnBridge.address, 1, '0x'), 'InvalidT2PublicKey()');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key (too short)', async () => {
        await testHelper.expectCustomRevert(() => token777.send(avnBridge.address, 1, web3.utils.randomHex(16)), 'InvalidT2PublicKey()');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key(too long)', async () => {
        await testHelper.expectCustomRevert(() => token777.send(avnBridge.address, 1, web3.utils.randomHex(48)), 'InvalidT2PublicKey()');
      });

      it('attempting to lift more ERC777 tokens to T2 than its supported limit', async () => {
        await testHelper.expectCustomRevert(() => massiveERC777.send(avnBridge.address, 1, someT2PublicKey), 'LiftLimitExceeded()');
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        await massiveERC20.approve(avnBridge.address, 1);
        await testHelper.expectCustomRevert(() => avnBridge.lift(massiveERC20.address, someT2PublicKey, 1), 'LiftLimitExceeded()');
      });

      it('attempting to lift ETH when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        let logArgs = await testHelper.getLogArgs(avnBridge, 'LogLiftingIsEnabled');
        assert.equal(logArgs.state, false);
        await testHelper.expectCustomRevert(() => avnBridge.liftETH(someT2PublicKey, {value:100}), 'LiftingIsDisabled()');
        await avnBridge.toggleLifting(true);
        logArgs = await testHelper.getLogArgs(avnBridge, 'LogLiftingIsEnabled');
        assert.equal(logArgs.state, true);
        await avnBridge.liftETH(someT2PublicKey, {value:100});
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await testHelper.expectCustomRevert(() => token777.send(avnBridge.address, 1, someT2PublicKey), 'LiftingIsDisabled()');
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1, someT2PublicKey);
      });

      it('attempting to lift ERC20 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await token20.approve(avnBridge.address, 1);
        await testHelper.expectCustomRevert(() => avnBridge.lift(token20.address, someT2PublicKey, 1), 'LiftingIsDisabled()');
        await avnBridge.toggleLifting(true);
        await avnBridge.lift(token20.address, someT2PublicKey, 1);
      });

      it('attempting to lift ERC777 tokens using ERC20 backwards compatability ', async () => {
        const amount = new BN(2);
        await token777.approve(avnBridge.address, amount);
        await testHelper.expectCustomRevert(() => avnBridge.lift(token777.address, someT2PublicKey, amount), 'ERC20LiftingOnly()');
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await testHelper.expectCustomRevert(() => token777.send(avnBridge.address, 1, someT2PublicKey), 'LiftingIsDisabled()');
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1, someT2PublicKey);
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await token20.approve(avnBridge.address, 100);
        await testHelper.expectRevert(() => avnBridge.lift(token20.address, someT2PublicKey, 200),
            'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await testHelper.expectRevert(() => avnBridge.lift(token20.address, someT2PublicKey, 1, {from: someOtherAccount}),
            'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC777 tokens than are available in sender balance', async () => {
        await testHelper.expectRevert(() => token777.send(avnBridge.address, 1, someT2PublicKey, {from: someOtherAccount}),
            'ERC777: transfer amount exceeds balance');
      });

      it('calling FTSM tokensReceived hook directly with tokens not destined for the FTSM', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.tokensReceived(owner, owner, someOtherAccount, 100, someT2PublicKey, '0x'),
            'TokensMustBeSentToThisAddress()');
      });

      it('calling FTSM tokensReceived hook directly and not a registered contract', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.tokensReceived(owner, owner, avnBridge.address, 100, someT2PublicKey, '0x'),
            'InvalidERC777Token()');
      });
    });
  });

  context('lower()', async () => {
    const liftAmount = new BN(100);
    const lowerAmount = new BN(50);

    it('lower ETH succeeds [ @skip-on-coverage ]', async () => {
      await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avnBridge, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount);

      const avnEthBalanceBefore = new BN(await web3.eth.getBalance(avnBridge.address));
      const lowererEthBalanceBefore = new BN(await web3.eth.getBalance(owner));

      const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
      const gasPrice = new BN(await web3.eth.getGasPrice());
      const txCost = new BN(tx.receipt.gasUsed).mul(gasPrice);

      const avnEthBalanceAfter = new BN(await web3.eth.getBalance(avnBridge.address));
      const lowererEthBalanceAfter = new BN(await web3.eth.getBalance(owner));

      assert.equal(avnEthBalanceBefore.sub(lowerAmount).toString(), avnEthBalanceAfter.toString());
      assert.equal(lowererEthBalanceBefore.add(lowerAmount).sub(txCost).toString(), lowererEthBalanceAfter.toString());

      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowered');
      assert.equal(logArgs.token, testHelper.PSEUDO_ETH_ADDRESS);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
    });

    it('proxy lower ETH succeeds [ @skip-on-coverage ]', async () => {
      await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avnBridge, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount, true);

      const avnEthBalanceBefore = new BN(await web3.eth.getBalance(avnBridge.address));
      const lowererEthBalanceBefore = new BN(await web3.eth.getBalance(owner));

      const tx = await avnBridge.lower(tree.leafData, tree.merklePath);
      const gasPrice = new BN(await web3.eth.getGasPrice());
      const txCost = new BN(tx.receipt.gasUsed).mul(gasPrice);

      const avnEthBalanceAfter = new BN(await web3.eth.getBalance(avnBridge.address));
      const lowererEthBalanceAfter = new BN(await web3.eth.getBalance(owner));

      assert.equal(avnEthBalanceBefore.sub(lowerAmount).toString(), avnEthBalanceAfter.toString());
      assert.equal(lowererEthBalanceBefore.add(lowerAmount).sub(txCost).toString(), lowererEthBalanceAfter.toString());

      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowered');
      assert.equal(logArgs.token, testHelper.PSEUDO_ETH_ADDRESS);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
    });

    it('lift and lower ETH for coverage', async () => {
      await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avnBridge, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount);
      await avnBridge.lower(tree.leafData, tree.merklePath);
    });

    it('proxy lift and lower ETH for coverage', async () => {
      await avnBridge.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avnBridge, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount, true);
      await avnBridge.lower(tree.leafData, tree.merklePath);
    });

    it('lower ERC20 succeeds', async () => {
      // lift
      await token20.approve(avnBridge.address, liftAmount);
      await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);
      // record pre-lower balances
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const senderBalBefore = await token20.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount);

      // lower and confirm values
      await avnBridge.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowered');
      assert.equal(logArgs.token, token20.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token20.balanceOf(avnBridge.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token20.balanceOf(owner)).toString());
    });

    it('proxy lower ERC20 succeeds', async () => {
      // lift
      await token20.approve(avnBridge.address, liftAmount);
      await avnBridge.lift(token20.address, someT2PublicKey, liftAmount);
      // record pre-lower balances
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const senderBalBefore = await token20.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount, true);

      // lower and confirm values
      await avnBridge.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowered');
      assert.equal(logArgs.token, token20.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token20.balanceOf(avnBridge.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token20.balanceOf(owner)).toString());
    });

    it('lower ERC777 succeeds', async () => {
      // lift
      await token777.send(avnBridge.address, liftAmount, someT2PublicKey);
      // record pre-lower balances
      const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
      const senderBalBefore = await token777.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount);

      // lower and confirm values
      await avnBridge.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowered');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token777.balanceOf(avnBridge.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token777.balanceOf(owner)).toString());
    });

    it('proxy lower ERC777 succeeds', async () => {
      // lift
      await token777.send(avnBridge.address, liftAmount, someT2PublicKey);
      // record pre-lower balances
      const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
      const senderBalBefore = await token777.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount, true);

      // lower and confirm values
      await avnBridge.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogLowered');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token777.balanceOf(avnBridge.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token777.balanceOf(owner)).toString());
    });

    context('lower fails when', async () => {
      let tree;

      beforeEach(async () => {
        tree = await testHelper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount);
      });

      it('lowering is disabled', async () => {
        await avnBridge.toggleLowering(false);
        let logArgs = await testHelper.getLogArgs(avnBridge, 'LogLoweringIsEnabled');
        assert.equal(logArgs.state, false);
        await testHelper.expectCustomRevert(() => avnBridge.lower(tree.leafData, tree.merklePath), 'LoweringIsDisabled()');
        await avnBridge.toggleLowering(true);
        logArgs = await testHelper.getLogArgs(avnBridge, 'LogLoweringIsEnabled');
        assert.equal(logArgs.state, true);
        await avnBridge.lower(tree.leafData, tree.merklePath);
      });

      it('the leaf has already been used for a lower', async () => {
        await avnBridge.lower(tree.leafData, tree.merklePath);
        await testHelper.expectCustomRevert(() => avnBridge.lower(tree.leafData, tree.merklePath), 'LowerAlreadyUsed()');
      });

      it('leaf is invalid', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.lower(testHelper.randomBytes32(), tree.merklePath), 'InvalidLowerData()');
      });

      it('path is invalid', async () => {
        await testHelper.expectCustomRevert(() => avnBridge.lower(tree.leafData, [testHelper.randomBytes32()]), 'InvalidLowerData()');
      });

      it('leaf is not recognised as a lower leaf', async () => {
        const  badId = '0xaaaa';
        tree = await testHelper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount, true, badId);
        await testHelper.expectCustomRevert(() => avnBridge.lower(tree.leafData, tree.merklePath), 'NotALowerTransaction()');
      });

      it('attempting to lower ETH to an address which cannot receive it', async () => {
        await avnBridge.liftETH(someT2PublicKey, {value: 100});
        const addressCannotReceiveETH = token20.address;
        tree = await testHelper.createTreeAndPublishRootWithLoweree(avnBridge, addressCannotReceiveETH, testHelper.PSEUDO_ETH_ADDRESS,
            lowerAmount);
        await testHelper.expectCustomRevert(() => avnBridge.lower(tree.leafData, tree.merklePath), 'PaymentFailed()');
      });
    });
  });

  context('confirmT2Transaction', async() =>{
    it('confirm a leaf exists in published tree', async () => {
      let tree = await testHelper.createTreeAndPublishRoot(avnBridge, token777.address, 0);
      assert.equal(await avnBridge.confirmAvnTransaction(tree.leafHash, tree.merklePath), true);
      assert.equal(await avnBridge.confirmAvnTransaction(testHelper.randomBytes32(), tree.merklePath), false);
    });
  });

  context('triggerGrowth - via owner', async () => {
    const growthAmount = ONE_AVT_IN_ATTO.mul(new BN(5));

    it('fails to trigger zero growth', async () => {
      await testHelper.expectCustomRevert(() => avnBridge.triggerGrowth(0, 1, 0, '0x'), 'AmountCannotBeZero()');
    });

    it('fails to trigger growth if called without validator confirmations by someone other than the owner', async () => {
      await testHelper.expectCustomRevert(() => avnBridge.triggerGrowth(growthAmount, 1, 0, '0x', { from: someOtherAccount }),
          'OwnerOnly()');
    });

    it('succeeds for growth period "2"', async () => {
      const period = 2;
      const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
      const avtSupplyBefore = await token20.totalSupply();

      await avnBridge.triggerGrowth(growthAmount, period, 0, '0x');
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogGrowth');

      testHelper.bnEquals(logArgs.amount, growthAmount);
      testHelper.bnEquals(logArgs.period, period);

      testHelper.bnEquals(avnBalanceBefore.add(growthAmount), await token20.balanceOf(avnBridge.address));
      testHelper.bnEquals(avtSupplyBefore.add(growthAmount), await token20.totalSupply());
    });

    it('succeeds for growth period "1"', async () => {
      const period = 1;
      await avnBridge.triggerGrowth(growthAmount, period, 0, '0x');
      const logArgs = await testHelper.getLogArgs(avnBridge, 'LogGrowth');
      testHelper.bnEquals(logArgs.amount, growthAmount);
      testHelper.bnEquals(logArgs.period, period);
    });

    it('fails to re-trigger growth for an existing period', async () => {
      await testHelper.expectCustomRevert(() => avnBridge.triggerGrowth(growthAmount, 1, 0, '0x'), 'GrowthPeriodAlreadyUsed()');
    });
  });
});