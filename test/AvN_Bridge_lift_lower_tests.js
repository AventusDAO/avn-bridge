const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, token777, token20;
let accounts;
let owner, someOtherAccount, someT2PubKey;

describe('Lifting and lowering', async () => {
  before(async () => {
    await helper.init();
    const Token777 = await ethers.getContractFactory('Token777');
    token777 = await Token777.deploy(10000000n);
    token777.address = await token777.getAddress();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000n);
    token20.address = await token20.getAddress();
    const numAuthors = 10n;
    avnBridge = await helper.deployAVNBridge(numAuthors);
    avnBridge.address = await avnBridge.getAddress();
    accounts = helper.accounts();
    owner = helper.owner();
    someOtherAccount = accounts[1];
    someT2PubKey = helper.someT2PubKey();
    authors = helper.authors();
  });

  context('Lifting', async () => {
    context('succeeds', async () => {
      it('in lifting ETH', async () => {
        const avnEthBalanceBefore = await ethers.provider.getBalance(avnBridge.address);
        const lifterEthBalanceBefore = await ethers.provider.getBalance(owner);
        const liftAmount = 123n;

        const txResponse = await avnBridge.liftETH(someT2PubKey, { value: liftAmount });
        const txReceipt = await txResponse.wait(1);
        const txCost = txReceipt.gasUsed * txResponse.gasPrice;

        const avnEthBalanceAfter = await ethers.provider.getBalance(avnBridge.address);
        const lifterEthBalanceAfter = await ethers.provider.getBalance(owner);

        expect(avnEthBalanceBefore + liftAmount).to.equal(avnEthBalanceAfter);
        expect(lifterEthBalanceBefore - liftAmount - txCost).to.equal(lifterEthBalanceAfter);
      });

      it('in lifting ERC777 tokens', async () => {
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const liftAmount = 100n;
        await expect(token777.send(avnBridge.address, liftAmount, someT2PubKey))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token777.balanceOf(avnBridge.address));
      });

      it('in lifting ERC777 tokens via operatorSend', async () => {
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const liftAmount = 100n;
        const otherOperatorData = '0x1234';
        await expect(token777.operatorSend(owner, avnBridge.address, liftAmount, someT2PubKey, otherOperatorData))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token777.balanceOf(avnBridge.address));
      });

      it('in lifting ERC777 tokens via ERC20 backwards compatability', async () => {
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const liftAmount = 100n;
        await token777.approve(avnBridge.address, liftAmount);
        await expect(avnBridge.lift(token777.address, someT2PubKey, liftAmount))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token777.balanceOf(avnBridge.address));
      });

      it('in lifting ERC20 tokens', async () => {
        const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
        const liftAmount = 200n;
        await token20.approve(avnBridge.address, liftAmount);
        await expect(avnBridge.lift(token20.address, someT2PubKey, liftAmount))
          .to.emit(avnBridge, 'LogLifted')
          .withArgs(token20.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token20.balanceOf(avnBridge.address));
      });
    });

    context('fails when', async () => {
      let massiveERC20, massiveERC777, maxLiftAmount;

      before(async () => {
        const massiveTotalSupply = 2n ** 192n;
        maxLiftAmount = 2n ** 128n - 1n;
        const Token777 = await ethers.getContractFactory('Token777');
        massiveERC777 = await Token777.deploy(massiveTotalSupply);
        massiveERC777.address = await massiveERC777.getAddress();
        await massiveERC777.send(avnBridge.address, maxLiftAmount, someT2PubKey);
        const Token20 = await ethers.getContractFactory('Token20');
        massiveERC20 = await Token20.deploy(massiveTotalSupply);
        massiveERC20.address = await massiveERC20.getAddress();
        await massiveERC20.approve(avnBridge.address, maxLiftAmount);
        await avnBridge.lift(massiveERC20.address, someT2PubKey, maxLiftAmount);
      });

      it('attempting to lift 0 ETH', async () => {
        await expect(avnBridge.liftETH(someT2PubKey)).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
      });

      it('attempting to lift ETH without supplying a public key', async () => {
        await expect(avnBridge.liftETH(helper.EMPTY_BYTES_32, { value: 100n })).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift 0 ERC20 tokens', async () => {
        await token20.approve(avnBridge.address, 0);
        await expect(avnBridge.lift(token20.address, someT2PubKey, 0n)).to.be.revertedWithCustomError(avnBridge, 'LiftFailed');
      });

      it('attempting to lift ERC-20 tokens without supplying a T2 public key', async () => {
        await token20.approve(avnBridge.address, 1n);
        await expect(avnBridge.lift(token20.address, helper.EMPTY_BYTES_32, 1n)).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift 0 ERC777 tokens', async () => {
        await expect(token777.send(avnBridge.address, 0n, someT2PubKey)).to.be.revertedWithCustomError(avnBridge, 'AmountIsZero');
      });

      it('attempting to lift ERC777 tokens without supplying a T2 public key', async () => {
        await expect(token777.send(avnBridge.address, 1n, '0x')).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key (too short)', async () => {
        await expect(token777.send(avnBridge.address, 1n, helper.randomHex(16))).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key(too long)', async () => {
        await expect(token777.send(avnBridge.address, 1n, helper.randomHex(48))).to.be.revertedWithCustomError(avnBridge, 'InvalidT2Key');
      });

      it('attempting to lift more ERC777 tokens to T2 than its supported limit', async () => {
        await expect(massiveERC777.send(avnBridge.address, 1n, someT2PubKey)).to.be.revertedWithCustomError(avnBridge, 'LiftLimitHit');
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        await massiveERC20.approve(avnBridge.address, 1n);
        await expect(avnBridge.lift(massiveERC20.address, someT2PubKey, 1n)).to.be.revertedWithCustomError(avnBridge, 'LiftLimitHit');
      });

      it('attempting to lift ETH when lift is disabled', async () => {
        await expect(avnBridge.toggleLifting(false)).to.emit(avnBridge, 'LogLiftingEnabled').withArgs(false);
        await expect(avnBridge.liftETH(someT2PubKey, { value: 100n })).to.be.revertedWithCustomError(avnBridge, 'LiftDisabled');
        await expect(avnBridge.toggleLifting(true)).to.emit(avnBridge, 'LogLiftingEnabled').withArgs(true);
        await avnBridge.liftETH(someT2PubKey, { value: 100n });
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await expect(token777.send(avnBridge.address, 1, someT2PubKey)).to.be.revertedWithCustomError(avnBridge, 'LiftDisabled');
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1n, someT2PubKey);
      });

      it('attempting to lift ERC20 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await token20.approve(avnBridge.address, 1n);
        await expect(avnBridge.lift(token20.address, someT2PubKey, 1n)).to.be.revertedWithCustomError(avnBridge, 'LiftDisabled');
        await avnBridge.toggleLifting(true);
        await avnBridge.lift(token20.address, someT2PubKey, 1n);
      });

      it('attempting to lift ERC777 tokens using ERC20 backwards compatibility without setting approval', async () => {
        const amount = 2n;
        await expect(avnBridge.lift(token777.address, someT2PubKey, amount)).to.be.revertedWith('ERC777: insufficient allowance');
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avnBridge.toggleLifting(false);
        await expect(token777.send(avnBridge.address, 1, someT2PubKey)).to.be.revertedWithCustomError(avnBridge, 'LiftDisabled');
        await avnBridge.toggleLifting(true);
        await token777.send(avnBridge.address, 1, someT2PubKey);
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await token20.approve(avnBridge.address, 100n);
        await expect(avnBridge.lift(token20.address, someT2PubKey, 200n)).to.be.rejectedWith(token20, 'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await expect(avnBridge.connect(someOtherAccount).lift(token20.address, someT2PubKey, 1)).to.be.rejectedWith(token20, 'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC777 tokens than are available in sender balance', async () => {
        await expect(token777.connect(someOtherAccount).send(avnBridge.address, 1, someT2PubKey)).to.be.rejectedWith(
          token777,
          'ERC777: transfer amount exceeds balance'
        );
      });

      it('calling FTSM tokensReceived hook directly with tokens not destined for the FTSM', async () => {
        await expect(avnBridge.tokensReceived(owner, owner, someOtherAccount.address, 100n, someT2PubKey, '0x')).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidRecipient'
        );
      });

      it('calling FTSM tokensReceived hook directly and not a registered contract', async () => {
        await expect(avnBridge.tokensReceived(owner, owner, avnBridge.address, 100n, someT2PubKey, '0x')).to.be.revertedWithCustomError(
          avnBridge,
          'InvalidERC777'
        );
      });
    });
  });

  context('Claiming lowers', async () => {
    const liftAmount = 100n;
    const lowerAmount = 50n;

    context('succeeds', async () => {
      it('in lowering ETH', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: liftAmount });

        const avnEthBalanceBefore = await ethers.provider.getBalance(avnBridge.address);
        const lowererEthBalanceBefore = await ethers.provider.getBalance(owner);

        const [lowerProof, lowerId] = await helper.createLowerProof(avnBridge, helper.PSEUDO_ETH, lowerAmount, owner);
        const txResponse = await avnBridge.claimLower(lowerProof);
        const txReceipt = await txResponse.wait(1);
        const txCost = txReceipt.gasUsed * txResponse.gasPrice;

        const avnEthBalanceAfter = await ethers.provider.getBalance(avnBridge.address);
        const lowererEthBalanceAfter = await ethers.provider.getBalance(owner);

        expect(avnEthBalanceBefore - lowerAmount).to.equal(avnEthBalanceAfter);
        expect(lowererEthBalanceBefore + lowerAmount - txCost).to.equal(lowererEthBalanceAfter);

        await avnBridge.filters.LogLowerClaimed(lowerId);
      });

      it('in lowering ERC20 tokens', async () => {
        // lift
        await token20.approve(avnBridge.address, liftAmount);
        await avnBridge.lift(token20.address, someT2PubKey, liftAmount);
        // record pre-lower balances
        const avnBalanceBefore = await token20.balanceOf(avnBridge.address);
        const senderBalBefore = await token20.balanceOf(owner);

        const [lowerProof, lowerId] = await helper.createLowerProof(avnBridge, token20, lowerAmount, owner);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(avnBridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(avnBalanceBefore - lowerAmount).to.equal(await token20.balanceOf(avnBridge.address));
        expect(senderBalBefore + lowerAmount).to.equal(await token20.balanceOf(owner));
      });

      it('in lowering ERC777 tokens', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        const [lowerProof, lowerId] = await helper.createLowerProof(avnBridge, token777, lowerAmount, owner);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(avnBridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(avnBalanceBefore - lowerAmount).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore + lowerAmount).to.equal(await token777.balanceOf(owner));
      });

      it('in lowering ERC777 tokens to a non-compliant contract via ERC20 transfer backwards compatability', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(token20.address);

        const [lowerProof, lowerId] = await helper.createLowerProof(avnBridge, token777, lowerAmount, token20);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(avnBridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(avnBalanceBefore - lowerAmount).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore + lowerAmount).to.equal(await token777.balanceOf(token20.address));
      });

      it('in lowering ERC777 to the avn bridge itself without accidentally triggering a subsequent lift', async () => {
        // lift
        await token777.send(avnBridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(avnBridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        const [lowerProof, lowerId] = await helper.createLowerProof(avnBridge, token777, lowerAmount, avnBridge);

        // lower and confirm values
        await expect(avnBridge.connect(someOtherAccount).claimLower(lowerProof))
          .to.emit(avnBridge, 'LogLowerClaimed')
          .withArgs(lowerId)
          .to.not.emit(avnBridge, 'LogLifted');
        expect(avnBalanceBefore).to.equal(await token777.balanceOf(avnBridge.address));
        expect(senderBalBefore).to.equal(await token777.balanceOf(owner));
      });
    });

    context('fails when', async () => {
      let lowerProof, lowerId;
      let lowerAmount = 100n;

      beforeEach(async () => {
        [lowerProof, lowerId] = await helper.createLowerProof(avnBridge, token777, lowerAmount, owner);
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
        const reentrantERC20 = await ReentrantToken20.deploy(10000000n, avnBridge.address);
        reentrantERC20.address = await reentrantERC20.getAddress();
        await reentrantERC20.approve(avnBridge.address, liftAmount);
        await avnBridge.lift(reentrantERC20.address, someT2PubKey, liftAmount);
        [lowerProof, lowerId] = await helper.createLowerProof(avnBridge, reentrantERC20, lowerAmount, owner);
        await expect(avnBridge.claimLower(lowerProof)).to.be.revertedWithCustomError(avnBridge, 'Locked');
      });

      it('attempting to lower ETH to an address which cannot receive it', async () => {
        await avnBridge.liftETH(someT2PubKey, { value: lowerAmount });
        const addressCannotReceiveETH = token20;
        [lowerProof, _] = await helper.createLowerProof(avnBridge, helper.PSEUDO_ETH, lowerAmount, addressCannotReceiveETH);
        await expect(avnBridge.claimLower(lowerProof)).to.be.revertedWithCustomError(avnBridge, 'PaymentFailed');
      });
    });
  });

  context('Check lower', async () => {
    it('results are as expected for a valid, unused proof', async () => {
      const lowerAmount = 123n;
      const [lowerProof, expectedLowerId] = await helper.createLowerProof(avnBridge, token20, lowerAmount, owner);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await avnBridge.checkLower(lowerProof);

      const numConfirmationsRequired = await helper.getNumRequiredConfirmations(avnBridge);
      expect(token).to.equal(token20.address);
      expect(amount).to.equal(lowerAmount);
      expect(recipient).to.equal(owner);
      expect(lowerId).to.equal(expectedLowerId);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsRequired);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(false);
    });

    it('results are as expected for a valid, used proof', async () => {
      const lowerAmount = 456n;
      await token777.send(avnBridge.address, lowerAmount, someT2PubKey);
      const [lowerProof, expectedLowerId] = await helper.createLowerProof(avnBridge, token777, lowerAmount, owner);
      await avnBridge.claimLower(lowerProof);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await avnBridge.checkLower(lowerProof);

      const numConfirmationsRequired = await helper.getNumRequiredConfirmations(avnBridge);
      expect(token).to.equal(token777.address);
      expect(amount).to.equal(lowerAmount);
      expect(recipient).to.equal(owner);
      expect(lowerId).to.equal(expectedLowerId);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsRequired);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(true);
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
        const tree = await helper.createTreeAndPublishRoot(avnBridge, token777.address, 0n);
        expect(await avnBridge.confirmTransaction(tree.leafHash, tree.merklePath)).to.equal(true);
        expect(await avnBridge.confirmTransaction(helper.randomBytes32(), tree.merklePath)).to.equal(false);
      });
    });
  });
});
