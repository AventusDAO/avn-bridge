const {
  createLowerProof,
  createTreeAndPublishRoot,
  deployBridge,
  EMPTY_BYTES_32,
  expect,
  getAccounts,
  getNumRequiredConfirmations,
  init,
  PSEUDO_ETH,
  randomBytes32,
  randomHex,
  ZERO_ADDRESS
} = require('./helpers/testHelper');

let accounts, bridge, token777, token20, owner, someOtherAccount, someT2PubKey;

describe('Lifting and lowering', async () => {
  before(async () => {
    await init();
    const Token777 = await ethers.getContractFactory('Token777');
    token777 = await Token777.deploy(10000000n);
    token777.address = await token777.getAddress();
    const Token20 = await ethers.getContractFactory('Token20');
    token20 = await Token20.deploy(10000000n);
    token20.address = await token20.getAddress();
    const numAuthors = 10n;
    bridge = await deployBridge(numAuthors);
    bridge.address = await bridge.getAddress();
    accounts = getAccounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    someT2PubKey = randomBytes32();
  });

  context('Lifting', async () => {
    context('succeeds', async () => {
      it('in lifting ETH', async () => {
        const avnEthBalanceBefore = await ethers.provider.getBalance(bridge.address);
        const lifterEthBalanceBefore = await ethers.provider.getBalance(owner);
        const liftAmount = 123n;

        const txResponse = await bridge.liftETH(someT2PubKey, { value: liftAmount });
        const txReceipt = await txResponse.wait(1);
        const txCost = txReceipt.gasUsed * txResponse.gasPrice;

        const avnEthBalanceAfter = await ethers.provider.getBalance(bridge.address);
        const lifterEthBalanceAfter = await ethers.provider.getBalance(owner);

        expect(avnEthBalanceBefore + liftAmount).to.equal(avnEthBalanceAfter);
        expect(lifterEthBalanceBefore - liftAmount - txCost).to.equal(lifterEthBalanceAfter);
      });

      it('in lifting ERC777 tokens', async () => {
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const liftAmount = 100n;
        await expect(token777.send(bridge.address, liftAmount, someT2PubKey))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token777.balanceOf(bridge.address));
      });

      it('in lifting ERC777 tokens via operatorSend', async () => {
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const liftAmount = 100n;
        const otherOperatorData = '0x1234';
        await expect(token777.operatorSend(owner, bridge.address, liftAmount, someT2PubKey, otherOperatorData))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token777.balanceOf(bridge.address));
      });

      it('in lifting ERC777 tokens via ERC20 backwards compatability', async () => {
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const liftAmount = 100n;
        await token777.approve(bridge.address, liftAmount);
        await expect(bridge.lift(token777.address, someT2PubKey, liftAmount))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token777.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token777.balanceOf(bridge.address));
      });

      it('in lifting ERC20 tokens', async () => {
        const avnBalanceBefore = await token20.balanceOf(bridge.address);
        const liftAmount = 200n;
        await token20.approve(bridge.address, liftAmount);
        await expect(bridge.lift(token20.address, someT2PubKey, liftAmount))
          .to.emit(bridge, 'LogLifted')
          .withArgs(token20.address, someT2PubKey, liftAmount);
        expect(avnBalanceBefore + liftAmount, await token20.balanceOf(bridge.address));
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
        await massiveERC777.send(bridge.address, maxLiftAmount, someT2PubKey);
        const Token20 = await ethers.getContractFactory('Token20');
        massiveERC20 = await Token20.deploy(massiveTotalSupply);
        massiveERC20.address = await massiveERC20.getAddress();
        await massiveERC20.approve(bridge.address, maxLiftAmount);
        await bridge.lift(massiveERC20.address, someT2PubKey, maxLiftAmount);
      });

      it('attempting to lift 0 ETH', async () => {
        await expect(bridge.liftETH(someT2PubKey)).to.be.revertedWithCustomError(bridge, 'AmountIsZero');
      });

      it('attempting to lift ETH without supplying a public key', async () => {
        await expect(bridge.liftETH(EMPTY_BYTES_32, { value: 100n })).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift 0 ERC20 tokens', async () => {
        await token20.approve(bridge.address, 0);
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

      it('attempting to lift ERC777 tokens with an incorrect T2 public key(too long)', async () => {
        await expect(token777.send(bridge.address, 1n, randomHex(48))).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift more ERC777 tokens to T2 than its supported limit', async () => {
        await expect(massiveERC777.send(bridge.address, 1n, someT2PubKey)).to.be.revertedWithCustomError(bridge, 'LiftLimitHit');
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        await massiveERC20.approve(bridge.address, 1n);
        await expect(bridge.lift(massiveERC20.address, someT2PubKey, 1n)).to.be.revertedWithCustomError(bridge, 'LiftLimitHit');
      });

      it('attempting to lift ETH when lift is disabled', async () => {
        await expect(bridge.toggleLifting(false)).to.emit(bridge, 'LogLiftingEnabled').withArgs(false);
        await expect(bridge.liftETH(someT2PubKey, { value: 100n })).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await expect(bridge.toggleLifting(true)).to.emit(bridge, 'LogLiftingEnabled').withArgs(true);
        await bridge.liftETH(someT2PubKey, { value: 100n });
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await bridge.toggleLifting(false);
        await expect(token777.send(bridge.address, 1, someT2PubKey)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
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

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await bridge.toggleLifting(false);
        await expect(token777.send(bridge.address, 1, someT2PubKey)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await bridge.toggleLifting(true);
        await token777.send(bridge.address, 1, someT2PubKey);
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await token20.approve(bridge.address, 100n);
        await expect(bridge.lift(token20.address, someT2PubKey, 200n)).to.be.rejectedWith(token20, 'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await expect(bridge.connect(someOtherAccount).lift(token20.address, someT2PubKey, 1)).to.be.rejectedWith(token20, 'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC777 tokens than are available in sender balance', async () => {
        await expect(token777.connect(someOtherAccount).send(bridge.address, 1, someT2PubKey)).to.be.rejectedWith(
          token777,
          'ERC777: transfer amount exceeds balance'
        );
      });

      it('calling FTSM tokensReceived hook directly with tokens not destined for the FTSM', async () => {
        await expect(bridge.tokensReceived(owner, owner, someOtherAccount.address, 100n, someT2PubKey, '0x')).to.be.revertedWithCustomError(
          bridge,
          'InvalidRecipient'
        );
      });

      it('calling FTSM tokensReceived hook directly and not a registered contract', async () => {
        await expect(bridge.tokensReceived(owner, owner, bridge.address, 100n, someT2PubKey, '0x')).to.be.revertedWithCustomError(bridge, 'InvalidERC777');
      });
    });
  });

  context('Claiming lowers', async () => {
    const liftAmount = 100n;
    const lowerAmount = 50n;

    context('succeeds', async () => {
      it('in lowering ETH', async () => {
        await bridge.liftETH(someT2PubKey, { value: liftAmount });

        const avnEthBalanceBefore = await ethers.provider.getBalance(bridge.address);
        const lowererEthBalanceBefore = await ethers.provider.getBalance(owner);

        const [lowerProof, lowerId] = await createLowerProof(bridge, PSEUDO_ETH, lowerAmount, owner);
        const txResponse = await bridge.claimLower(lowerProof);
        const txReceipt = await txResponse.wait(1);
        const txCost = txReceipt.gasUsed * txResponse.gasPrice;

        const avnEthBalanceAfter = await ethers.provider.getBalance(bridge.address);
        const lowererEthBalanceAfter = await ethers.provider.getBalance(owner);

        expect(avnEthBalanceBefore - lowerAmount).to.equal(avnEthBalanceAfter);
        expect(lowererEthBalanceBefore + lowerAmount - txCost).to.equal(lowererEthBalanceAfter);

        await bridge.filters.LogLowerClaimed(lowerId);
      });

      it('in lowering ERC20 tokens', async () => {
        // lift
        await token20.approve(bridge.address, liftAmount);
        await bridge.lift(token20.address, someT2PubKey, liftAmount);
        // record pre-lower balances
        const avnBalanceBefore = await token20.balanceOf(bridge.address);
        const senderBalBefore = await token20.balanceOf(owner);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token20, lowerAmount, owner);

        // lower and confirm values
        await expect(bridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(avnBalanceBefore - lowerAmount).to.equal(await token20.balanceOf(bridge.address));
        expect(senderBalBefore + lowerAmount).to.equal(await token20.balanceOf(owner));
      });

      it('in lowering ERC777 tokens', async () => {
        // lift
        await token777.send(bridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, owner);

        // lower and confirm values
        await expect(bridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(avnBalanceBefore - lowerAmount).to.equal(await token777.balanceOf(bridge.address));
        expect(senderBalBefore + lowerAmount).to.equal(await token777.balanceOf(owner));
      });

      it('in lowering ERC777 tokens to a non-compliant contract via ERC20 transfer backwards compatability', async () => {
        // lift
        await token777.send(bridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const senderBalBefore = await token777.balanceOf(token20.address);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, token20);

        // lower and confirm values
        await expect(bridge.connect(someOtherAccount).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(avnBalanceBefore - lowerAmount).to.equal(await token777.balanceOf(bridge.address));
        expect(senderBalBefore + lowerAmount).to.equal(await token777.balanceOf(token20.address));
      });

      it('in lowering ERC777 to the avn bridge itself without accidentally triggering a subsequent lift', async () => {
        // lift
        await token777.send(bridge.address, liftAmount, someT2PubKey);
        // record pre-lower balances
        const avnBalanceBefore = await token777.balanceOf(bridge.address);
        const senderBalBefore = await token777.balanceOf(owner);

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, bridge);

        // lower and confirm values
        await expect(bridge.connect(someOtherAccount).claimLower(lowerProof))
          .to.emit(bridge, 'LogLowerClaimed')
          .withArgs(lowerId)
          .to.not.emit(bridge, 'LogLifted');
        expect(avnBalanceBefore).to.equal(await token777.balanceOf(bridge.address));
        expect(senderBalBefore).to.equal(await token777.balanceOf(owner));
      });
    });

    context('fails when', async () => {
      let lowerProof;
      let lowerAmount = 100n;

      beforeEach(async () => {
        [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, owner);
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

      it('attempting to lower ETH to an address which cannot receive it', async () => {
        await bridge.liftETH(someT2PubKey, { value: lowerAmount });
        const addressCannotReceiveETH = token20;
        [lowerProof, _] = await createLowerProof(bridge, PSEUDO_ETH, lowerAmount, addressCannotReceiveETH);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'PaymentFailed');
      });

      it('the recipient address is missing', async () => {
        [lowerProof] = await createLowerProof(bridge, token20, lowerAmount, ZERO_ADDRESS);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'AddressIsZero');
      });
    });
  });

  context('Check lower', async () => {
    it('results are as expected for a valid, unused proof', async () => {
      const lowerAmount = 123n;
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, token20, lowerAmount, owner);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(lowerProof);

      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);
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
      await token777.send(bridge.address, lowerAmount, someT2PubKey);
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, token777, lowerAmount, owner);
      await bridge.claimLower(lowerProof);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(lowerProof);

      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);
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
      const emptyAddress = ZERO_ADDRESS.address;
      const shortProof = randomBytes32();
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(shortProof);
      expect(token).to.equal(emptyAddress);
      expect(amount).to.equal(0);
      expect(recipient).to.equal(emptyAddress);
      expect(lowerId).to.equal(0);
      expect(confirmationsRequired).to.equal(0);
      expect(confirmationsProvided).to.equal(0);
      expect(proofIsValid).to.equal(false);
      expect(lowerIsClaimed).to.equal(false);
    });
  });

  context('Reentrancy prevention', function () {
    const reentryPoint = {
      ClaimLower: 0,
      ETHLift: 1,
      ERC20Lift: 2,
      ERC777Lift: 3
    };

    const amount = 100n;
    let reentrantToken;

    before(async () => {
      const contract = await ethers.getContractFactory('ReentrantToken');
      reentrantToken = await contract.deploy(bridge.address);
      reentrantToken.address = await reentrantToken.getAddress();
      await reentrantToken.approve(bridge.address, amount * 5n);
    });

    it('the claimLower re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ClaimLower);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });

    it('the ETH lift re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ERC20Lift);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });

    it('the ERC20 lift re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ERC777Lift);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });

    it('the ERC777 lift re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ETHLift);
      await expect(bridge.lift(reentrantToken.address, someT2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'Locked');
    });
  });

  context('Confirming T2 transactions on T1', async () => {
    context('succeeds', async () => {
      it('in confirming a T2 tx leaf exists in a published root', async () => {
        const tree = await createTreeAndPublishRoot(bridge, token777.address, 0n);
        expect(await bridge.confirmTransaction(tree.leafHash, tree.merklePath)).to.equal(true);
        expect(await bridge.confirmTransaction(randomBytes32(), tree.merklePath)).to.equal(false);
      });
    });
  });
});
