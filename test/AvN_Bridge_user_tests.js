const {
  createLowerProof,
  createTreeAndPublishRoot,
  deployBridge,
  EMPTY_BYTES_32,
  expect,
  getAccounts,
  getNumRequiredConfirmations,
  init,
  randomBytes32,
  randomHex,
  ZERO_ADDRESS
} = require('./helpers/testHelper');

let accounts, bridge, token777, token20, owner, someOtherAccount, someT2PubKey;

describe('Lifting and lowering', () => {
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
    someT2PubKey = randomBytes32();
  });

  context('Lifting', () => {
    context('succeeds', () => {
      it('in lifting ERC777 tokens', async () => {
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const liftAmount = 100n;

        await expect(token777.send(bridge.address, liftAmount, someT2PubKey))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);

        expect(await token777.balanceOf(bridge.address)).to.equal(avnBalanceBefore + liftAmount);
      });

      it('in lifting ERC777 tokens via operatorSend', async () => {
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const liftAmount = 100n;
        const otherOperatorData = '0x1234';

        await expect(token777.operatorSend(owner.address, bridge.address, liftAmount, someT2PubKey, otherOperatorData))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);

        expect(await token777.balanceOf(bridge.address)).to.equal(avnBalanceBefore + liftAmount);
      });

      it('in lifting ERC777 tokens via ERC20 backwards compatibility', async () => {
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const liftAmount = 100n;

        await token777.approve(bridge.address, liftAmount);
        await expect(bridge.lift(token777.address, someT2PubKey, liftAmount))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);

        expect(await token777.balanceOf(bridge.address)).to.equal(avnBalanceBefore + liftAmount);
      });

      it('in lifting ERC20 tokens', async () => {
        const avnBalanceBefore = await token20.balanceOf(bridge.address);
        const liftAmount = 200n;

        await token20.approve(bridge.address, liftAmount);
        await expect(bridge.lift(token20.address, someT2PubKey, liftAmount))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token20.address, someT2PubKey, liftAmount);

        expect(await token20.balanceOf(bridge.address)).to.equal(avnBalanceBefore + liftAmount);
      });
    });

    context('fails when', () => {
      let massiveERC20, massiveERC777, maxLiftAmount;

      before(async () => {
        const massiveTotalSupply = 2n ** 192n;
        maxLiftAmount = 2n ** 128n - 1n;

        const Token777 = await ethers.getContractFactory('Token777');
        massiveERC777 = await Token777.deploy(massiveTotalSupply);
        massiveERC777.address = await massiveERC777.getAddress();
        await massiveERC777.send(bridge.address, maxLiftAmount, someT2PubKey);

        const Token20 = await ethers.getContractFactory('Token20');
        massiveERC20 = await Token20.deploy(massiveTotalSupply);
        massiveERC20.address = await massiveERC20.getAddress();
        await massiveERC20.approve(bridge.address, maxLiftAmount);
        await bridge.lift(massiveERC20.address, someT2PubKey, maxLiftAmount);
      });

      it('attempting to lift 0 ERC20 tokens', async () => {
        await token20.approve(bridge.address, 0n);
        await expect(bridge.lift(token20.address, someT2PubKey, 0n)).to.be.revertedWithCustomError(bridge, 'LiftFailed');
      });

      it('attempting to lift ERC-20 tokens without supplying a T2 public key', async () => {
        await token20.approve(bridge.address, 1n);
        await expect(bridge.lift(token20.address, EMPTY_BYTES_32, 1n)).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift 0 ERC777 tokens', async () => {
        await expect(token777.send(bridge.address, 0n, someT2PubKey)).to.be.revertedWithCustomError(bridge, 'AmountIsZero');
      });

      it('attempting to lift ERC777 tokens without supplying a T2 public key', async () => {
        await expect(token777.send(bridge.address, 1n, '0x')).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key (too short)', async () => {
        await expect(token777.send(bridge.address, 1n, randomHex(16))).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key (too long)', async () => {
        await expect(token777.send(bridge.address, 1n, randomHex(48))).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift more ERC777 tokens to T2 than its supported limit', async () => {
        await expect(massiveERC777.send(bridge.address, 1n, someT2PubKey)).to.be.revertedWithCustomError(bridge, 'LiftLimitHit');
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        await massiveERC20.approve(bridge.address, 1n);
        await expect(bridge.lift(massiveERC20.address, someT2PubKey, 1n)).to.be.revertedWithCustomError(bridge, 'LiftLimitHit');
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await bridge.toggleLifting(false);
        await expect(token777.send(bridge.address, 1n, someT2PubKey)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await bridge.toggleLifting(true);
        await token777.send(bridge.address, 1n, someT2PubKey);
      });

      it('attempting to lift ERC20 tokens when lift is disabled', async () => {
        await bridge.toggleLifting(false);
        await token20.approve(bridge.address, 1n);
        await expect(bridge.lift(token20.address, someT2PubKey, 1n)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await bridge.toggleLifting(true);
        await bridge.lift(token20.address, someT2PubKey, 1n);
      });

      it('attempting to lift ERC777 tokens using ERC20 backwards compatibility without setting approval', async () => {
        const amount = 2n;
        await expect(bridge.lift(token777.address, someT2PubKey, amount)).to.be.revertedWith('ERC777: insufficient allowance');
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await token20.approve(bridge.address, 100n);
        await expect(bridge.lift(token20.address, someT2PubKey, 200n)).to.be.revertedWith('ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await expect(bridge.connect(someOtherAccount).lift(token20.address, someT2PubKey, 1n)).to.be.revertedWith('ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC777 tokens than are available in sender balance', async () => {
        await expect(token777.connect(someOtherAccount).send(bridge.address, 1n, someT2PubKey)).to.be.revertedWith('ERC777: transfer amount exceeds balance');
      });

      it('calling bridge tokensReceived hook directly with tokens not destined for the bridge', async () => {
        await expect(bridge.tokensReceived(owner.address, owner.address, someOtherAccount.address, 100n, someT2PubKey, '0x')).to.be.revertedWithCustomError(
          bridge,
          'InvalidRecipient'
        );
      });

      it('calling bridge tokensReceived hook directly when not a registered contract', async () => {
        await expect(bridge.tokensReceived(owner.address, owner.address, bridge.address, 100n, someT2PubKey, '0x')).to.be.revertedWithCustomError(
          bridge,
          'InvalidERC777'
        );
      });
    });
  });

  context('Claiming lowers', () => {
    const liftAmount = 100n;
    const lowerAmount = 50n;

    context('succeeds', () => {
      it('in lowering ERC20 tokens', async () => {
        await token20.approve(bridge.address, liftAmount);
        await bridge.lift(token20.address, someT2PubKey, liftAmount);

        const avnBalanceBefore = await token20.balanceOf(bridge.address);
        const senderBalBefore = await token20.balanceOf(owner.address);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token20, lowerAmount, owner, someT2PubKey);

        await expect(bridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(await token20.balanceOf(bridge.address)).to.equal(avnBalanceBefore - lowerAmount);
        expect(await token20.balanceOf(owner.address)).to.equal(senderBalBefore + lowerAmount);
      });

      it('in lowering ERC777 tokens', async () => {
        await token777.send(bridge.address, liftAmount, someT2PubKey);

        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const senderBalBefore = await token777.balanceOf(owner.address);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, owner, someT2PubKey);

        await expect(bridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(await token777.balanceOf(bridge.address)).to.equal(avnBalanceBefore - lowerAmount);
        expect(await token777.balanceOf(owner.address)).to.equal(senderBalBefore + lowerAmount);
      });

      it('in lowering ERC777 tokens to a non-compliant contract via ERC20 transfer backwards compatibility', async () => {
        await token777.send(bridge.address, liftAmount, someT2PubKey);

        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const recipientBalBefore = await token777.balanceOf(token20.address);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, token20, someT2PubKey);

        await expect(bridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(await token777.balanceOf(bridge.address)).to.equal(avnBalanceBefore - lowerAmount);
        expect(await token777.balanceOf(token20.address)).to.equal(recipientBalBefore + lowerAmount);
      });

      it('in lowering ERC777 to the bridge itself without accidentally triggering a subsequent lift', async () => {
        await token777.send(bridge.address, liftAmount, someT2PubKey);

        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const senderBalBefore = await token777.balanceOf(owner.address);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, bridge, someT2PubKey);

        const tx = bridge.connect(someOtherAccount).claimLower(lowerProof);
        await expect(tx).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        await expect(tx).to.not.emit(bridge, 'LogLifted');
        expect(await token777.balanceOf(bridge.address)).to.equal(avnBalanceBefore);
        expect(await token777.balanceOf(owner.address)).to.equal(senderBalBefore);
      });
    });

    context('fails when', () => {
      let lowerProof;
      let lowerAmountLocal = 100n;

      beforeEach(async () => {
        [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmountLocal, owner, someT2PubKey);
      });

      it('lowering is disabled', async () => {
        await expect(bridge.toggleLowering(false)).to.emit(bridge, 'LogLoweringEnabled').withArgs(false);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerDisabled');
        await expect(bridge.toggleLowering(true)).to.emit(bridge, 'LogLoweringEnabled').withArgs(true);
        await bridge.claimLower(lowerProof);
      });

      it('the proof has already been used', async () => {
        await bridge.claimLower(lowerProof);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('the proof is invalid', async () => {
        await expect(bridge.claimLower(randomBytes32())).to.be.revertedWithCustomError(bridge, 'InvalidProof');
      });

      it('the recipient address is missing', async () => {
        [lowerProof] = await createLowerProof(bridge, token20, lowerAmountLocal, ZERO_ADDRESS, someT2PubKey);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'AddressIsZero');
      });
    });
  });

  context('Check lower', () => {
    it('results are as expected for a valid, unused proof', async () => {
      const amount = 123n;
      const timestamp = Math.floor(Date.now() / 1000);
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, token20, amount, owner, someT2PubKey, timestamp);
      const [token, checkedAmount, recipient, lowerId, t2Sender, t2Timestamp, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(lowerProof);

      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);
      expect(token).to.equal(token20.address);
      expect(checkedAmount).to.equal(amount);
      expect(recipient).to.equal(owner.address);
      expect(lowerId).to.equal(expectedLowerId);
      expect(t2Sender).to.equal(someT2PubKey);
      expect(t2Timestamp).to.equal(timestamp);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsRequired);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(false);
    });

    it('results are as expected for a valid, used proof', async () => {
      const amount = 456n;
      await token777.send(bridge.address, amount, someT2PubKey);
      const timestamp = Math.floor(Date.now() / 1000);
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, token777, amount, owner, someT2PubKey, timestamp);
      await bridge.claimLower(lowerProof);

      const [token, checkedAmount, recipient, lowerId, t2Sender, t2Timestamp, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(lowerProof);

      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);
      expect(token).to.equal(token777.address);
      expect(checkedAmount).to.equal(amount);
      expect(recipient).to.equal(owner.address);
      expect(lowerId).to.equal(expectedLowerId);
      expect(t2Sender).to.equal(someT2PubKey);
      expect(t2Timestamp).to.equal(timestamp);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsRequired);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(true);
    });

    it('the expected result is returned for a valid proof with invalid confirmations', async () => {
      const amount = 789n;
      await token20.approve(bridge.address, amount);
      await bridge.lift(token20.address, someT2PubKey, amount);
      const timestamp = Math.floor(Date.now() / 1000);
      const [proofA, lowerIdA] = await createLowerProof(bridge, token20, amount, owner, someT2PubKey, timestamp);
      const [proofB] = await createLowerProof(bridge, token20, amount, owner, someT2PubKey, timestamp);
      const confirmationsStart = 154;
      const invalidProof = ethers.concat([proofA.slice(0, confirmationsStart), '0x' + proofB.slice(confirmationsStart)]);
      const [token, checkedAmount, recipient, lowerId, t2Sender, t2Timestamp, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(invalidProof);
      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);

      expect(token).to.equal(token20.address);
      expect(checkedAmount).to.equal(amount);
      expect(recipient).to.equal(owner.address);
      expect(lowerId).to.equal(lowerIdA);
      expect(t2Sender).to.equal(someT2PubKey);
      expect(t2Timestamp).to.equal(timestamp);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(0);
      expect(proofIsValid).to.equal(false);
      expect(lowerIsClaimed).to.equal(false);
    });

    it('results are as expected for a completely invalid proof', async () => {
      const emptyAddress = ZERO_ADDRESS.address;
      const shortProof = randomBytes32();
      const [token, amount, recipient, lowerId, t2Sender, t2Timestamp, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(shortProof);

      expect(token).to.equal(emptyAddress);
      expect(amount).to.equal(0);
      expect(recipient).to.equal(emptyAddress);
      expect(lowerId).to.equal(0);
      expect(t2Sender).to.equal(EMPTY_BYTES_32);
      expect(t2Timestamp).to.equal(0);
      expect(confirmationsRequired).to.equal(0);
      expect(confirmationsProvided).to.equal(0);
      expect(proofIsValid).to.equal(false);
      expect(lowerIsClaimed).to.equal(false);
    });
  });

  context('Reverting lowers', () => {
    const liftAmount = 1_000n;
    const lowerAmount = 123n;
    const OWNER_DELAY = 72 * 60 * 60;

    context('succeeds', () => {
      it('lets the recipient revert the lower, leaving balances unchanged, emitting the correct lift event, and using up the lower proof', async () => {
        await token20.approve(bridge.address, liftAmount);
        await bridge.lift(token20.address, someT2PubKey, liftAmount);
        const recipient = someOtherAccount;

        const avnBalBefore = await token20.balanceOf(bridge.address);
        const recipBalBefore = await token20.balanceOf(recipient.address);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token20, lowerAmount, recipient, someT2PubKey);

        await expect(bridge.connect(recipient).revertLower(lowerProof))
          .to.emit(bridge, 'LogLowerReverted')
          .withArgs(lowerId, recipient.address, recipient.address)
          .and.to.emit(bridge, 'LogLifted')
          .withArgs(token20.address, someT2PubKey, lowerAmount);

        // Revert should not transfer tokens to the recipient on T1
        expect(await token20.balanceOf(bridge.address)).to.equal(avnBalBefore);
        expect(await token20.balanceOf(recipient.address)).to.equal(recipBalBefore);

        // Lower has been marked off
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('allows the owner to revert on behalf of the recipient after 72 hours have passed from the proof timestamp', async () => {
        await token777.send(bridge.address, liftAmount, someT2PubKey);

        const now = Math.floor(Date.now() / 1000);
        const oldT2Timestamp = now - OWNER_DELAY - 5;

        const avnBalBefore = await token777.balanceOf(bridge.address);
        const recipient = someOtherAccount;

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, recipient, someT2PubKey, oldT2Timestamp);

        await expect(bridge.connect(owner).revertLower(lowerProof))
          .to.emit(bridge, 'LogLowerReverted')
          .withArgs(lowerId, recipient.address, owner.address)
          .and.to.emit(bridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, lowerAmount);

        expect(await token777.balanceOf(bridge.address)).to.equal(avnBalBefore);

        await expect(bridge.connect(recipient).claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });
    });

    context('fails when', () => {
      it('a non-recipient, non-owner attempts to revert', async () => {
        await token20.approve(bridge.address, lowerAmount);
        await bridge.lift(token20.address, someT2PubKey, lowerAmount);
        const recipient = owner;
        const [lowerProof] = await createLowerProof(bridge, token20, lowerAmount, recipient, someT2PubKey);
        await expect(bridge.connect(someOtherAccount).revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'PermissionDenied');
      });

      it('the owner attempts to revert before 72 hours have passed', async () => {
        await token777.send(bridge.address, lowerAmount, someT2PubKey);
        const recipient = someOtherAccount;
        const [lowerProof] = await createLowerProof(bridge, token777, lowerAmount, recipient, someT2PubKey);

        await expect(bridge.connect(owner).revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'PermissionDenied');
      });

      it('lifting is disabled', async () => {
        await token20.approve(bridge.address, lowerAmount);
        await bridge.lift(token20.address, someT2PubKey, lowerAmount);

        const [lowerProof] = await createLowerProof(bridge, token20, lowerAmount, owner, someT2PubKey);

        await expect(bridge.toggleLifting(false)).to.emit(bridge, 'LogLiftingEnabled').withArgs(false);
        await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await expect(bridge.toggleLifting(true)).to.emit(bridge, 'LogLiftingEnabled').withArgs(true);

        await bridge.revertLower(lowerProof);
      });

      it('the lower has already been claimed', async () => {
        await token20.approve(bridge.address, lowerAmount);
        await bridge.lift(token20.address, someT2PubKey, lowerAmount);

        const [lowerProof] = await createLowerProof(bridge, token20, lowerAmount, owner, someT2PubKey);

        await bridge.claimLower(lowerProof);
        await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('the lower has already been reverted', async () => {
        await token20.approve(bridge.address, lowerAmount);
        await bridge.lift(token20.address, someT2PubKey, lowerAmount);

        const [lowerProof] = await createLowerProof(bridge, token20, lowerAmount, owner, someT2PubKey);

        await bridge.revertLower(lowerProof);
        await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('the lower is a legacy lower', async () => {
        await token20.approve(bridge.address, lowerAmount);
        await bridge.lift(token20.address, someT2PubKey, lowerAmount);
        const recipient = owner;
        const missingT2Recipient = EMPTY_BYTES_32;
        const [lowerProof] = await createLowerProof(bridge, token20, lowerAmount, recipient, missingT2Recipient);
        await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LegacyLower');
      });

      it('the proof is invalid', async () => {
        await expect(bridge.revertLower(randomBytes32())).to.be.revertedWithCustomError(bridge, 'InvalidProof');
      });
    });
  });

  context('Reentrancy prevention', () => {
    const reentryPoint = {
      ClaimLower: 0,
      RevertLower: 1,
      ERC20Lift: 2,
      ERC777Lift: 3
    };

    const amount = 100n;
    let reentrantToken;

    before(async () => {
      const Contract = await ethers.getContractFactory('ReentrantToken');
      reentrantToken = await Contract.deploy(bridge.address);
      reentrantToken.address = await reentrantToken.getAddress();
      await reentrantToken.approve(bridge.address, amount * 5n);
    });

    it('the claimLower re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ClaimLower);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });

    it('the revertLower re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.RevertLower);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });

    it('the ERC20 lift re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ERC20Lift);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });

    it('the ERC777 lift re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ERC777Lift);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });
  });

  context('Confirming T2 transactions on T1', () => {
    context('succeeds', () => {
      it('in confirming a T2 tx leaf exists in a published root', async () => {
        const tree = await createTreeAndPublishRoot(bridge, token777.address, 0n);
        expect(await bridge.confirmTransaction(tree.leafHash, tree.merklePath)).to.equal(true);
        expect(await bridge.confirmTransaction(randomBytes32(), tree.merklePath)).to.equal(false);
      });
    });
  });
});
