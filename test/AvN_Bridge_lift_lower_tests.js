const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token777, token20;
let accounts, authors;
let owner, someOtherAccount, someT2PubKey;

describe('Lifting and lowering', async () => {
  before(async () => {
    await helper.init();
    const Token777 = await ethers.getContractFactory('Token777');
    token777 = await Token777.deploy(10000000);
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000);
    const numAuthors = 10;
    avnBridge = await helper.deployAVNBridge(token20.address, numAuthors);
    accounts = helper.accounts();
    owner = helper.owner();
    someOtherAccount = accounts[1];
    someT2PubKey = helper.someT2PubKey();
    authors = helper.authors();
    await token20.transferOwnership(avnBridge.address);
  });

  context('Lifting', async () => {
    context('succeeds', async () => {
      it('in lifting ETH', async () => {
        const avnEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lifterEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(owner));
        const liftAmount = ethers.BigNumber.from(123);

        const txResponse = await avnBridge.liftETH(someT2PubKey, { value: liftAmount });
        const txReceipt = await txResponse.wait(1);
        const txCost = ethers.BigNumber.from(txReceipt.gasUsed).mul(txResponse.gasPrice);

        const avnEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lifterEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

        expect(avnEthBalanceBefore.add(liftAmount)).to.equal(avnEthBalanceAfter);
        expect(lifterEthBalanceBefore.sub(liftAmount).sub(txCost)).to.equal(lifterEthBalanceAfter);
      });

      it('in lifting ERC777 tokens', async () => {
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const liftAmount = ethers.BigNumber.from(100);
        await expect(token777.send(avnBridge.address, liftAmount, someT2PubKey))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore.add(liftAmount), await token777.balanceOf(avnBridge.address));
      });

      it('in lifting ERC777 tokens via operatorSend', async () => {
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const liftAmount = ethers.BigNumber.from(100);
        const otherOperatorData = '0x1234';
        await expect(token777.operatorSend(owner, avnBridge.address, liftAmount, someT2PubKey, otherOperatorData))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore.add(liftAmount), await token777.balanceOf(avnBridge.address));
      });

      it('in lifting ERC777 tokens via ERC20 backwards compatability', async () => {
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const liftAmount = ethers.BigNumber.from(100);
        await token777.approve(avnBridge.address, liftAmount);
        await expect(avnBridge.lift(token777.address, someT2PubKey, liftAmount))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore.add(liftAmount), await token777.balanceOf(avnBridge.address));
      });

      it('in lifting ERC20 tokens', async () => {
        const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
        const liftAmount = ethers.BigNumber.from(200);
        await token20.approve(avnBridge.address, liftAmount);
        await expect(avnBridge.lift(token20.address, someT2PubKey, liftAmount))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token20.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore.add(liftAmount), await token20.balanceOf(avnBridge.address));
      });
    });

    context('fails when', async () => {
      let massiveERC20, massiveERC777, maxLiftAmount;

      before(async () => {
        const massiveTotalSupply = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(192));
        maxLiftAmount = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(128)).sub(ethers.BigNumber.from(1));
        const Token777 = await ethers.getContractFactory('Token777');
        massiveERC777 = await Token777.deploy(massiveTotalSupply);
        await massiveERC777.send(avnBridge.address, maxLiftAmount, someT2PubKey);
        const Token20 = await ethers.getContractFactory('Token20');
        massiveERC20 = await Token20.deploy(massiveTotalSupply);
        await massiveERC20.approve(avnBridge.address, maxLiftAmount);
        await avnBridge.lift(massiveERC20.address, someT2PubKey, maxLiftAmount);
      });

      it('attempting to lift 0 ETH', async () => {
        await expect(avnBridge.liftETH(someT2PubKey)).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
      });

      it('attempting to lift ETH without supplying a public key', async () => {
        await expect(avnBridge.liftETH('0x', { value: 100 })).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift ETH with an incorrect T2 public key (too short)', async () => {
        await expect(avnBridge.liftETH(helper.randomHex(16), { value: 100 })).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT2Key'
        );
      });

      it('attempting to lift ETH with an incorrect T2 public key(too long)', async () => {
        await expect(avnBridge.liftETH(helper.randomHex(48), { value: 100 })).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT2Key'
        );
      });

      it('attempting to lift 0 ERC20 tokens', async () => {
        await token20.approve(avnBridge.address, 0);
        await expect(avnBridge.lift(token20.address, someT2PubKey, 0)).to.be.revertedWithCustomError(avnBridge, 'LiftFailed');
      });

      it('attempting to lift ERC-20 tokens without supplying a T2 public key', async () => {
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, '0x', 1)).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key (too short)', async () => {
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, helper.randomHex(16), 1)).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT2Key'
        );
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key(too long)', async () => {
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, helper.randomHex(48), 1)).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT2Key'
        );
      });

      it('attempting to lift 0 ERC777 tokens', async () => {
        await expect(token777.send(avnBridge.address, 0, someT2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'AmountIsZero'
        );
      });

      it('attempting to lift ERC777 tokens without supplying a T2 public key', async () => {
        await expect(token777.send(avnBridge.address, 1, '0x')).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key (too short)', async () => {
        await expect(token777.send(avnBridge.address, 1, helper.randomHex(16))).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT2Key'
        );
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key(too long)', async () => {
        await expect(token777.send(avnBridge.address, 1, helper.randomHex(48))).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidT2Key'
        );
      });

      it('attempting to lift more ERC777 tokens to T2 than its supported limit', async () => {
        await expect(massiveERC777.send(avnBridge.address, 1, someT2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'LiftLimitHit'
        );
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        await massiveERC20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(massiveERC20.address, someT2PubKey, 1)).to.be.revertedWithCustomError(
          avnBridge,
          'LiftLimitHit'
        );
      });

      it('attempting to lift ETH when lift is disabled', async () => {
        await expect(avnBridge.toggleLifting(false)).to.emit(avnBridge, 'LogLiftingEnabled').withArgs(false);
        await expect(avnBridge.liftETH(someT2PubKey, { value: 100 })).to.be.revertedWithCustomError(avnBridge, 'LiftDisabled');
        await expect(avnBridge.toggleLifting(true)).to.emit(avnBridge, 'LogLiftingEnabled').withArgs(true);
        await avnBridge.liftETH(someT2PubKey, { value: 100 });
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await expect(token777.send(avnBridge.address, 1, someT2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'LiftDisabled'
        );
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1, someT2PubKey);
      });

      it('attempting to lift ERC20 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await token20.approve(avnBridge.address, 1);
        await expect(avnBridge.lift(token20.address, someT2PubKey, 1)).to.be.revertedWithCustomError(avnBridge, 'LiftDisabled');
        await avnBridge.toggleLifting(true);
        await avnBridge.lift(token20.address, someT2PubKey, 1);
      });

      it('attempting to lift ERC777 tokens using ERC20 backwards compatibility without setting approval', async () => {
        const amount = ethers.BigNumber.from(2);
        await expect(avnBridge.lift(token777.address, someT2PubKey, amount)).to.be.revertedWith(
          'ERC777: insufficient allowance'
        );
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await expect(token777.send(avnBridge.address, 1, someT2PubKey)).to.be.revertedWithCustomError(
          avnBridge,
          'LiftDisabled'
        );
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1, someT2PubKey);
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await token20.approve(avnBridge.address, 100);
        await expect(avnBridge.lift(token20.address, someT2PubKey, 200)).to.be.rejectedWith(
          token20,
          'ERC20: insufficient allowance'
        );
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await expect(avnBridge.connect(someOtherAccount).lift(token20.address, someT2PubKey, 1)).to.be.rejectedWith(
          token20,
          'ERC20: insufficient allowance'
        );
      });

      it('attempting to lift more ERC777 tokens than are available in sender balance', async () => {
        await expect(token777.connect(someOtherAccount).send(avnBridge.address, 1, someT2PubKey)).to.be.rejectedWith(
          token777,
          'ERC777: transfer amount exceeds balance'
        );
      });

      it('calling FTSM tokensReceived hook directly with tokens not destined for the FTSM', async () => {
        await expect(
          avnBridge.tokensReceived(owner, owner, someOtherAccount.address, 100, someT2PubKey, '0x')
        ).to.be.revertedWithCustomError(avnBridge, 'InvalidRecipient');
      });

      it('calling FTSM tokensReceived hook directly and not a registered contract', async () => {
        await expect(
          avnBridge.tokensReceived(owner, owner, avnBridge.address, 100, someT2PubKey, '0x')
        ).to.be.revertedWithCustomError(avnBridge, 'InvalidERC777');
      });
    });
  });

  context('Legacy lowering', async () => {
    const liftAmount = ethers.BigNumber.from(100);
    const lowerAmount = ethers.BigNumber.from(50);

    context('succeeds', async () => {
      it('in lowering ETH', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: liftAmount });
        const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount);

        const avnEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lowererEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

        const txResponse = await avnBridge.legacyLower(tree.leafData, tree.merklePath);
        const txReceipt = await txResponse.wait(1);
        const gasPrice = ethers.BigNumber.from(await ethers.provider.getGasPrice());
        const txCost = ethers.BigNumber.from(txReceipt.gasUsed).mul(txResponse.gasPrice);

        const avnEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lowererEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

        expect(avnEthBalanceBefore.sub(lowerAmount)).to.equal(avnEthBalanceAfter);
        expect(lowererEthBalanceBefore.add(lowerAmount).sub(txCost)).to.equal(lowererEthBalanceAfter);

        await avnBridge.filters.LogLegacyLowered(helper.PSEUDO_ETH_ADDRESS, owner, someT2PubKey);
      });

      it('in proxy lowering ETH', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: liftAmount });
        const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount, true);

        const avnEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lowererEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

        const txResponse = await avnBridge.legacyLower(tree.leafData, tree.merklePath);
        const txReceipt = await txResponse.wait(1);
        const gasPrice = ethers.BigNumber.from(await ethers.provider.getGasPrice());
        const txCost = ethers.BigNumber.from(txReceipt.gasUsed).mul(txResponse.gasPrice);

        const avnEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lowererEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

        expect(avnEthBalanceBefore.sub(lowerAmount)).to.equal(avnEthBalanceAfter);
        expect(lowererEthBalanceBefore.add(lowerAmount).sub(txCost)).to.equal(lowererEthBalanceAfter);

        await avnBridge.filters.LogLegacyLowered(helper.PSEUDO_ETH_ADDRESS, owner, someT2PubKey);
      });

      it('in lifting and lowering ETH for coverage', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: 100 });
        const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount);
        await avnBridge.legacyLower(tree.leafData, tree.merklePath);
      });

      it('in proxy lifting and lowering ETH for coverage', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: 100 });
        const tree = await helper.createTreeAndPublishRoot(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount, true);
        await avnBridge.legacyLower(tree.leafData, tree.merklePath);
      });

      it('in lowering ERC20 tokens', async () => {
        // lift
        await token20.approve(avnBridge.address, liftAmount);
        await avnBridge.lift(token20.address, someT2PubKey, liftAmount);
        // record pre-lower balances
        const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
        const senderBalBefore = await token20.balanceOf(owner);

        let tree = await helper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).legacyLower(tree.leafData, tree.merklePath))
          .to.emit(avnBridge, 'LogLegacyLowered')
          .withArgs(token20.address, owner, someT2PubKey, lowerAmount);
        expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token20.balanceOf(avnBridge.address));
        expect(senderBalBefore.add(lowerAmount)).to.equal(await token20.balanceOf(owner));
      });

      it('in proxy lowering ERC20 tokens', async () => {
        // lift
        await token20.approve(avnBridge.address, liftAmount);
        await avnBridge.lift(token20.address, someT2PubKey, liftAmount);
        // record pre-lower balances
        const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
        const senderBalBefore = await token20.balanceOf(owner);

        let tree = await helper.createTreeAndPublishRoot(avnBridge, token20.address, lowerAmount, true);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).legacyLower(tree.leafData, tree.merklePath))
          .to.emit(avnBridge, 'LogLegacyLowered')
          .withArgs(token20.address, owner, someT2PubKey, lowerAmount);
        expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token20.balanceOf(avnBridge.address));
        expect(senderBalBefore.add(lowerAmount)).to.equal(await token20.balanceOf(owner));
      });

      it('in lowering ERC777 tokens', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        let tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).legacyLower(tree.leafData, tree.merklePath))
          .to.emit(avnBridge, 'LogLegacyLowered')
          .withArgs(token777.address, owner, someT2PubKey, lowerAmount);
        expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore.add(lowerAmount)).to.equal(await token777.balanceOf(owner));
      });

      it('in proxy lowering ERC777 tokens', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        let tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount, true);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).legacyLower(tree.leafData, tree.merklePath))
          .to.emit(avnBridge, 'LogLegacyLowered')
          .withArgs(token777.address, owner, someT2PubKey, lowerAmount);
        expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore.add(lowerAmount)).to.equal(await token777.balanceOf(owner));
      });

      it('in lowering ERC777 to the avn bridge itself without accidentally triggering a subsequent lift', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        let tree = await helper.createTreeAndPublishRootWithLoweree(
          avnBridge,
          avnBridge.address,
          token777.address,
          lowerAmount
        );

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).legacyLower(tree.leafData, tree.merklePath))
          .to.emit(avnBridge, 'LogLegacyLowered')
          .withArgs(token777.address, avnBridge.address, someT2PubKey, lowerAmount)
          .to.not.emit(avnBridge, 'LogLifted');
        expect(avnBalanceBefore).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore).to.equal(await token777.balanceOf(owner));
      });
    });

    context('fails when', async () => {
      let tree;
      let lowerAmount = 100;

      beforeEach(async () => {
        tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount);
      });

      it('lowering is disabled', async () => {
        await expect(avnBridge.toggleLowering(false)).to.emit(avnBridge, 'LogLoweringEnabled').withArgs(false);
        await expect(avnBridge.legacyLower(tree.leafData, tree.merklePath)).to.be.revertedWithCustomError(
          avnBridge,
          'LowerDisabled'
        );
        await expect(avnBridge.toggleLowering(true)).to.emit(avnBridge, 'LogLoweringEnabled').withArgs(true);
        await avnBridge.legacyLower(tree.leafData, tree.merklePath);
      });

      it('the leaf has already been used for a lower', async () => {
        await avnBridge.legacyLower(tree.leafData, tree.merklePath);
        await expect(avnBridge.legacyLower(tree.leafData, tree.merklePath)).to.be.revertedWithCustomError(
          avnBridge,
          'LowerIsUsed'
        );
      });

      it('the leaf is invalid', async () => {
        await expect(avnBridge.legacyLower(helper.randomBytes32(), tree.merklePath)).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidTxData'
        );
      });

      it('the path is invalid', async () => {
        await expect(avnBridge.legacyLower(tree.leafData, [helper.randomBytes32()])).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidTxData'
        );
      });

      it('the leaf is not recognised as a lower leaf', async () => {
        const badId = '0xaaaa';
        tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, lowerAmount, true, badId);
        await expect(avnBridge.legacyLower(tree.leafData, tree.merklePath)).to.be.revertedWithCustomError(
          avnBridge,
          'NotALowerTx'
        );
      });

      it('attempting to lower ETH to an address which cannot receive it', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: lowerAmount });
        const addressCannotReceiveETH = token20.address;
        tree = await helper.createTreeAndPublishRootWithLoweree(
          avnBridge,
          addressCannotReceiveETH,
          helper.PSEUDO_ETH_ADDRESS,
          lowerAmount
        );
        await expect(avnBridge.legacyLower(tree.leafData, tree.merklePath)).to.be.revertedWithCustomError(
          avnBridge,
          'PaymentFailed'
        );
      });
    });
  });

  context('Claiming lowers', async () => {
    const liftAmount = ethers.BigNumber.from(100);
    const lowerAmount = ethers.BigNumber.from(50);

    context('succeeds', async () => {
      it('in lowering ETH', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: liftAmount });

        const avnEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lowererEthBalanceBefore = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

        const [lowerProof, lowerHash] = await helper.createLowerProof(avnBridge, helper.PSEUDO_ETH_ADDRESS, lowerAmount, owner);
        const txResponse = await avnBridge.claimLower(lowerProof);
        const txReceipt = await txResponse.wait(1);
        const gasPrice = ethers.BigNumber.from(await ethers.provider.getGasPrice());
        const txCost = ethers.BigNumber.from(txReceipt.gasUsed).mul(txResponse.gasPrice);

        const avnEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(avnBridge.address));
        const lowererEthBalanceAfter = ethers.BigNumber.from(await ethers.provider.getBalance(owner));

        expect(avnEthBalanceBefore.sub(lowerAmount)).to.equal(avnEthBalanceAfter);
        expect(lowererEthBalanceBefore.add(lowerAmount).sub(txCost)).to.equal(lowererEthBalanceAfter);

        await avnBridge.filters.LogLowerClaimed(lowerHash);
      });

      it('in lowering ERC20 tokens', async () => {
        // lift
        await token20.approve(avnBridge.address, liftAmount);
        await avnBridge.lift(token20.address, someT2PubKey, liftAmount);
        // record pre-lower balances
        const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
        const senderBalBefore = await token20.balanceOf(owner);

        const [lowerProof, lowerHash] = await helper.createLowerProof(avnBridge, token20.address, lowerAmount, owner);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).claimLower(lowerProof))
          .to.emit(avnBridge, 'LogLowerClaimed')
          .withArgs(lowerHash);
        expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token20.balanceOf(avnBridge.address));
        expect(senderBalBefore.add(lowerAmount)).to.equal(await token20.balanceOf(owner));
      });

      it('in lowering ERC777 tokens', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        const [lowerProof, lowerHash] = await helper.createLowerProof(avnBridge, token777.address, lowerAmount, owner);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).claimLower(lowerProof))
          .to.emit(avnBridge, 'LogLowerClaimed')
          .withArgs(lowerHash);
        expect(avnBalanceBefore.sub(lowerAmount)).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore.add(lowerAmount)).to.equal(await token777.balanceOf(owner));
      });

      it('in lowering ERC777 to the avn bridge itself without accidentally triggering a subsequent lift', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        const [lowerProof, lowerHash] = await helper.createLowerProof(
          avnBridge,
          token777.address,
          lowerAmount,
          avnBridge.address
        );

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).claimLower(lowerProof))
          .to.emit(avnBridge, 'LogLowerClaimed')
          .withArgs(lowerHash)
          .to.not.emit(avnBridge, 'LogLifted');
        expect(avnBalanceBefore).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore).to.equal(await token777.balanceOf(owner));
      });
    });

    context('fails when', async () => {
      let lowerProof, lowerHash;
      let lowerAmount = 100;

      beforeEach(async () => {
        [lowerProof, lowerHash] = await helper.createLowerProof(avnBridge, token777.address, lowerAmount, owner);
      });

      it('lowering is disabled', async () => {
        await expect(avnBridge.toggleLowering(false)).to.emit(avnBridge, 'LogLoweringEnabled').withArgs(false);
        await expect(avnBridge.claimLower(lowerProof)).to.be.revertedWithCustomError(avnBridge, 'LowerDisabled');
        await expect(avnBridge.toggleLowering(true)).to.emit(avnBridge, 'LogLoweringEnabled').withArgs(true);
        await avnBridge.claimLower(lowerProof);
      });

      it('the proof has already been used', async () => {
        await avnBridge.claimLower(lowerProof);
        await expect(avnBridge.claimLower(lowerProof)).to.be.revertedWithCustomError(avnBridge, 'LowerIsUsed');
      });

      it('the proof is invalid', async () => {
        await expect(avnBridge.claimLower(helper.randomBytes32())).to.be.revertedWithCustomError(avnBridge, 'InvalidProof');
      });

      it('a non-standard ERC20 triggers the re-entrancy check', async () => {
        const ReentrantToken20 = await ethers.getContractFactory('ReentrantToken20');
        const reentrantERC20 = await ReentrantToken20.deploy(10000000, avnBridge.address);
        await reentrantERC20.approve(avnBridge.address, liftAmount);
        await avnBridge.lift(reentrantERC20.address, someT2PubKey, liftAmount);
        [lowerProof, lowerHash] = await helper.createLowerProof(avnBridge, reentrantERC20.address, lowerAmount, owner);
        await expect(avnBridge.claimLower(lowerProof)).to.be.revertedWithCustomError(avnBridge, 'Locked');
      });

      it('attempting to lower ETH to an address which cannot receive it', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: lowerAmount });
        const addressCannotReceiveETH = token20.address;
        [lowerProof, _] = await helper.createLowerProof(
          avnBridge,
          helper.PSEUDO_ETH_ADDRESS,
          lowerAmount,
          addressCannotReceiveETH
        );
        await expect(avnBridge.claimLower(lowerProof)).to.be.revertedWithCustomError(avnBridge, 'PaymentFailed');
      });
    });
  });

  context('Check lower', async () => {
    it('results are as expected for a valid, unused proof', async () => {
      const lowerAmount = 123;
      const [lowerProof] = await helper.createLowerProof(avnBridge, token20.address, lowerAmount, owner);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await avnBridge.checkLower(lowerProof);

      const numConfirmationsRequired = await helper.getNumRequiredConfirmations(avnBridge);
      const numConfirmationsSent = (await avnBridge.numActiveAuthors()) - numConfirmationsRequired;
      expect(token).to.equal(token20.address);
      expect(amount).to.equal(lowerAmount);
      expect(recipient).to.equal(owner);
      expect(lowerId).to.equal(helper.lowerId());
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsSent);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(false);
    });

    it('results are as expected for a valid, used proof', async () => {
      const lowerAmount = 456;
      await token777.send(avnBridge.address, lowerAmount, someT2PubKey);
      const [lowerProof] = await helper.createLowerProof(avnBridge, token777.address, lowerAmount, owner);
      await avnBridge.claimLower(lowerProof);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await avnBridge.checkLower(lowerProof);

      const numConfirmationsRequired = await helper.getNumRequiredConfirmations(avnBridge);
      const numConfirmationsSent = (await avnBridge.numActiveAuthors()) - numConfirmationsRequired;
      expect(token).to.equal(token777.address);
      expect(amount).to.equal(lowerAmount);
      expect(recipient).to.equal(owner);
      expect(lowerId).to.equal(helper.lowerId());
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsSent);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(true);
    });

    it('results are as expected for valid data with invalid confirmations', async () => {
      const lowerAmount = 789;
      await token777.send(avnBridge.address, lowerAmount, someT2PubKey);
      const [lowerProofA] = await helper.createLowerProof(avnBridge, token777.address, lowerAmount, owner);
      const [lowerProofB] = await helper.createLowerProof(avnBridge, token777.address, lowerAmount, owner);
      const splitPoint = 20 + 32 + 20 + 4; // token bytes + amount bytes + recipient bytes + lower ID bytes
      const dataFromProofA = lowerProofA.slice(0, splitPoint);
      const confirmationsFromProofB = lowerProofB.slice(splitPoint);
      const inproofIsValid = ethers.utils.concat([dataFromProofA, confirmationsFromProofB]);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await avnBridge.checkLower(inproofIsValid);
      const numConfirmationsRequired = await helper.getNumRequiredConfirmations(avnBridge);

      expect(token).to.equal(token);
      expect(amount).to.equal(amount);
      expect(recipient).to.equal(recipient);
      expect(lowerId).to.equal(helper.lowerId()-1);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(0);
      expect(proofIsValid).to.equal(false);
      expect(lowerIsClaimed).to.equal(false);
    });

    it('results are as expected for a completely invalid proof', async () => {
      const shortProof = helper.randomBytes32();
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await avnBridge.checkLower(shortProof);
      expect(token).to.equal(helper.ZERO_ADDRESS);
      expect(amount).to.equal(0);
      expect(recipient).to.equal(helper.ZERO_ADDRESS);
      expect(lowerId).to.equal(0);
      expect(confirmationsRequired).to.equal(0);
      expect(confirmationsProvided).to.equal(0);
      expect(proofIsValid).to.equal(false);
      expect(lowerIsClaimed).to.equal(false);
    });
  });

  context('Confirming T2 transactions on T1', async () => {
    context('succeeds', async () => {
      it('in confirming a T2 tx leaf exists in a published root', async () => {
        let tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, 0);
        expect(await avnBridge.confirmTransaction(tree.leafHash, tree.merklePath)).to.equal(true);
        expect(await avnBridge.confirmTransaction(helper.randomBytes32(), tree.merklePath)).to.equal(false);
      });
    });
  });
});
