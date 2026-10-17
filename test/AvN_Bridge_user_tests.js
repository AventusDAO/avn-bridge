const {
  createLowerProof,
  createTreeAndPublishRoot,
  deployAuthority,
  deployAVT,
  deployBridge,
  deployERC20,
  deployERC777,
  EMPTY_BYTES_32,
  expect,
  getAccounts,
  getCurrentBlockTimestamp,
  getNumRequiredConfirmations,
  increaseBlockTimestamp,
  init,
  randomBytes32,
  randomHex,
  strip_0x,
  ZERO_ADDRESS
} = require('./helpers/testHelper');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const LOWER_STATE = { None: 0n, Locked: 1n, Frozen: 2n, Used: 3n };

let accounts, avt, bridge, token777, token20, owner, someOtherAccount, someT2PubKey, authority;

describe('Lifting and lowering', () => {
  before(async () => {
    await init();

    avt = await deployAVT(10_000_000n);
    authority = await deployAuthority(avt);
    await avt.setAuthority(authority);

    const numAuthors = 6;
    bridge = await deployBridge(avt, numAuthors);
    bridge.address = await bridge.getAddress();
    await authority.allowBurning(bridge.address);
    await authority.allowMinting(bridge.address);

    token20 = await deployERC20(10_000_000n);
    token777 = await deployERC777(10_000_000n);

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
        await bridge.enableLifting(false);
        await expect(token777.send(bridge.address, 1n, someT2PubKey)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await bridge.enableLifting(true);
        await token777.send(bridge.address, 1n, someT2PubKey);
      });

      it('attempting to lift ERC20 tokens when lift is disabled', async () => {
        await bridge.enableLifting(false);
        await token20.approve(bridge.address, 1n);
        await expect(bridge.lift(token20.address, someT2PubKey, 1n)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await bridge.enableLifting(true);
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
        await expect(bridge.enableLowering(false)).to.emit(bridge, 'LogLoweringEnabled').withArgs(false);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerDisabled');
        await expect(bridge.enableLowering(true)).to.emit(bridge, 'LogLoweringEnabled').withArgs(true);
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

  context('Replenishing AVT shortfalls', () => {
    async function setReplenishAllowance(amount) {
      await bridge.setReplenishAllowance(await bridge.replenishAllowance(), amount);
    }

    beforeEach(async () => {
      await setReplenishAllowance(0n);
      expect(await avt.balanceOf(bridge.address)).to.equal(0n);
    });

    context('succeeds', () => {
      it('in minting exactly the shortfall when an AVT claim exceeds the held funds', async () => {
        const liftAmount = 70n;
        const lowerAmount = 100n;
        const allowance = 1000n;
        const shortfall = lowerAmount - liftAmount;

        await avt.approve(bridge.address, liftAmount);
        await bridge.lift(avt.address, someT2PubKey, liftAmount);
        await setReplenishAllowance(allowance);

        const supplyBefore = await avt.totalSupply();
        const recipientBalanceBefore = await avt.balanceOf(someOtherAccount.address);
        const [lowerProof, lowerId] = await createLowerProof(bridge, avt, lowerAmount, someOtherAccount, someT2PubKey);

        const tx = bridge.claimLower(lowerProof);
        await expect(tx)
          .to.emit(bridge, 'LogReplenishmentMinted')
          .withArgs(shortfall, allowance - shortfall, lowerId);
        await expect(tx).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(await bridge.replenishAllowance()).to.equal(allowance - shortfall);
        expect(await avt.totalSupply()).to.equal(supplyBefore + shortfall);
        expect(await avt.balanceOf(someOtherAccount.address)).to.equal(recipientBalanceBefore + lowerAmount);
        expect(await avt.balanceOf(bridge.address)).to.equal(0n);
      });

      it('in leaving the allowance untouched when the held funds cover an AVT claim', async () => {
        const liftAmount = 100n;
        const lowerAmount = 50n;
        const allowance = 1000n;

        await avt.approve(bridge.address, liftAmount);
        await bridge.lift(avt.address, someT2PubKey, liftAmount);
        await setReplenishAllowance(allowance);

        const supplyBefore = await avt.totalSupply();
        const [lowerProof, lowerId] = await createLowerProof(bridge, avt, lowerAmount, someOtherAccount, someT2PubKey);

        const tx = bridge.claimLower(lowerProof);
        await expect(tx).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        await expect(tx).to.not.emit(bridge, 'LogReplenishmentMinted');
        expect(await bridge.replenishAllowance()).to.equal(allowance);
        expect(await avt.totalSupply()).to.equal(supplyBefore);

        // return the remaining lifted funds to keep the bridge AVT balance empty for other tests
        const [drainProof] = await createLowerProof(bridge, avt, liftAmount - lowerAmount, owner, someT2PubKey);
        await bridge.claimLower(drainProof);
      });

      it('in consuming the allowance down to exactly zero across multiple claims', async () => {
        const allowance = 100n;
        await setReplenishAllowance(allowance);

        const [firstProof, firstLowerId] = await createLowerProof(bridge, avt, 60n, someOtherAccount, someT2PubKey);
        await expect(bridge.claimLower(firstProof)).to.emit(bridge, 'LogReplenishmentMinted').withArgs(60n, 40n, firstLowerId);

        const [secondProof, secondLowerId] = await createLowerProof(bridge, avt, 40n, someOtherAccount, someT2PubKey);
        await expect(bridge.claimLower(secondProof)).to.emit(bridge, 'LogReplenishmentMinted').withArgs(40n, 0n, secondLowerId);

        expect(await bridge.replenishAllowance()).to.equal(0n);

        const [thirdProof] = await createLowerProof(bridge, avt, 1n, someOtherAccount, someT2PubKey);
        await expect(bridge.claimLower(thirdProof)).to.be.revertedWith('SafeERC20: low-level call failed');
      });
    });

    context('does not mint when', () => {
      it('the shortfall exceeds the allowance', async () => {
        const allowance = 10n;
        await setReplenishAllowance(allowance);

        const [lowerProof] = await createLowerProof(bridge, avt, 50n, someOtherAccount, someT2PubKey);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWith('SafeERC20: low-level call failed');
        expect(await bridge.replenishAllowance()).to.equal(allowance);
      });

      it('the shortfall exceeds the maximum mintable amount', async () => {
        const lowerAmount = 2n ** 128n;
        await setReplenishAllowance(lowerAmount);

        const [lowerProof] = await createLowerProof(bridge, avt, lowerAmount, someOtherAccount, someT2PubKey);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWith('SafeERC20: low-level call failed');
        expect(await bridge.replenishAllowance()).to.equal(lowerAmount);
      });

      it('the claimed token is not AVT', async () => {
        await setReplenishAllowance(1000n);

        const bridgeBalance = await token20.balanceOf(bridge.address);
        const [lowerProof] = await createLowerProof(bridge, token20, bridgeBalance + 10n, someOtherAccount, someT2PubKey);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        expect(await bridge.replenishAllowance()).to.equal(1000n);
      });
    });

    context('fails when', () => {
      it('the bridge is no longer allowed to mint AVT', async () => {
        const allowance = 1000n;
        await setReplenishAllowance(allowance);
        await authority.revokeMinting(bridge.address);

        const [lowerProof] = await createLowerProof(bridge, avt, 50n, someOtherAccount, someT2PubKey);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithoutReason();
        expect(await bridge.replenishAllowance()).to.equal(allowance);

        await authority.allowMinting(bridge.address);
        await expect(bridge.claimLower(lowerProof)).to.emit(bridge, 'LogReplenishmentMinted');
      });
    });
  });

  context('Locked lowers', () => {
    const LOCK_PERIOD = 24 * 60 * 60;
    const OWNER_DELAY = 72 * 60 * 60;
    const liftAmount = 1_000n;
    const lowerAmount = 123n;

    async function claimLockedLower(token, recipient = someOtherAccount, t2Sender = someT2PubKey, t2Timestamp) {
      const [lowerProof, lowerId] = await createLowerProof(bridge, token, lowerAmount, recipient, t2Sender, t2Timestamp);
      await bridge.claimLower(lowerProof);
      return [lowerProof, lowerId, BigInt(await getCurrentBlockTimestamp()) + BigInt(LOCK_PERIOD)];
    }

    async function claimFrozenLower(token, recipient, t2Sender) {
      const [lowerProof, lowerId, unlockTime] = await claimLockedLower(token, recipient, t2Sender);
      await bridge.freezeLowers([lowerId]);
      return [lowerProof, lowerId, unlockTime];
    }

    function overwriteProof(proof, byteOffset, hex) {
      const start = 2 + byteOffset * 2;
      const data = strip_0x(hex);
      return proof.slice(0, start) + data + proof.slice(start + data.length);
    }

    before(async () => {
      await token20.approve(bridge.address, liftAmount * 10n);
      await bridge.lift(token20.address, someT2PubKey, liftAmount * 10n);
    });

    beforeEach(async () => {
      await bridge.setLowerLockPeriod(LOCK_PERIOD);
    });

    after(async () => {
      await bridge.setLowerLockPeriod(0n);
    });

    context('Claiming and releasing', () => {
      context('succeeds', () => {
        it('in holding the funds of a claimed lower until its lock period has passed', async () => {
          const bridgeBalBefore = await token20.balanceOf(bridge.address);
          const recipientBalBefore = await token20.balanceOf(someOtherAccount.address);
          const [lowerProof, lowerId] = await createLowerProof(bridge, token20, lowerAmount, someOtherAccount, someT2PubKey);
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.None);

          const tx = await bridge.claimLower(lowerProof);
          const unlockTime = BigInt(await getCurrentBlockTimestamp()) + BigInt(LOCK_PERIOD);
          await expect(tx).to.emit(bridge, 'LogLowerLocked').withArgs(lowerId, unlockTime);
          await expect(tx).to.not.emit(bridge, 'LogLowerClaimed');

          const pending = await bridge.pendingLowers(lowerId);
          expect(pending.token).to.equal(token20.address);
          expect(pending.unlockTime).to.equal(unlockTime);
          expect(pending.frozen).to.equal(false);
          expect(pending.recipient).to.equal(someOtherAccount.address);
          expect(pending.t2Sender).to.equal(someT2PubKey);
          expect(pending.amount).to.equal(lowerAmount);

          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Locked);
          expect(await bridge.isLowerUsed(lowerId)).to.equal(false);
          expect(await token20.balanceOf(bridge.address)).to.equal(bridgeBalBefore);
          expect(await token20.balanceOf(someOtherAccount.address)).to.equal(recipientBalBefore);
        });

        it('in letting anyone release the funds to the recipient once the lock period has passed', async () => {
          const bridgeBalBefore = await token20.balanceOf(bridge.address);
          const recipientBalBefore = await token20.balanceOf(someOtherAccount.address);
          const [lowerProof, lowerId] = await claimLockedLower(token20);

          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.connect(accounts[2]).releaseLower(lowerId)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);

          expect((await bridge.pendingLowers(lowerId)).unlockTime).to.equal(0n);
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Used);
          expect(await bridge.isLowerUsed(lowerId)).to.equal(true);
          expect(await token20.balanceOf(bridge.address)).to.equal(bridgeBalBefore - lowerAmount);
          expect(await token20.balanceOf(someOtherAccount.address)).to.equal(recipientBalBefore + lowerAmount);
          await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
        });

        it('in releasing ERC777 tokens', async () => {
          await token777.send(bridge.address, lowerAmount, someT2PubKey);
          const recipientBalBefore = await token777.balanceOf(someOtherAccount.address);
          const [, lowerId] = await claimLockedLower(token777);

          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
          expect(await token777.balanceOf(someOtherAccount.address)).to.equal(recipientBalBefore + lowerAmount);
        });

        it('in replenishing an AVT shortfall at release rather than at claim', async () => {
          const allowance = 1000n;
          await bridge.setReplenishAllowance(await bridge.replenishAllowance(), allowance);
          expect(await avt.balanceOf(bridge.address)).to.equal(0n);

          const [lowerProof, lowerId] = await createLowerProof(bridge, avt, lowerAmount, someOtherAccount, someT2PubKey);
          await expect(bridge.claimLower(lowerProof)).to.not.emit(bridge, 'LogReplenishmentMinted');
          expect(await bridge.replenishAllowance()).to.equal(allowance);

          await increaseBlockTimestamp(LOCK_PERIOD);
          const tx = bridge.releaseLower(lowerId);
          await expect(tx)
            .to.emit(bridge, 'LogReplenishmentMinted')
            .withArgs(lowerAmount, allowance - lowerAmount, lowerId);
          await expect(tx).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
          expect(await avt.balanceOf(bridge.address)).to.equal(0n);

          await bridge.setReplenishAllowance(await bridge.replenishAllowance(), 0n);
        });

        it('in locking an ERC20 claim the bridge cannot yet cover, and releasing it once funded', async () => {
          const bridgeBalance = await token20.balanceOf(bridge.address);
          const amount = bridgeBalance + 1n;
          const recipientBalBefore = await token20.balanceOf(someOtherAccount.address);
          const [lowerProof, lowerId] = await createLowerProof(bridge, token20, amount, someOtherAccount, someT2PubKey);

          await expect(bridge.claimLower(lowerProof)).to.emit(bridge, 'LogLowerLocked');
          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWith('ERC20: transfer amount exceeds balance');
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Locked);
          expect((await bridge.pendingLowers(lowerId)).amount).to.equal(amount);

          await token20.approve(bridge.address, 1n);
          await bridge.lift(token20.address, someT2PubKey, 1n);
          await expect(bridge.releaseLower(lowerId)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
          expect(await token20.balanceOf(someOtherAccount.address)).to.equal(recipientBalBefore + amount);
          expect(await token20.balanceOf(bridge.address)).to.equal(0n);

          // restore the bridge's ERC20 funds for the remaining tests
          await token20.approve(bridge.address, liftAmount * 10n);
          await bridge.lift(token20.address, someT2PubKey, liftAmount * 10n);
        });

        it('in locking an AVT claim the bridge cannot yet cover, and releasing it once the replenish allowance covers it', async () => {
          expect(await avt.balanceOf(bridge.address)).to.equal(0n);
          expect(await bridge.replenishAllowance()).to.equal(0n);
          const [lowerProof, lowerId] = await createLowerProof(bridge, avt, lowerAmount, someOtherAccount, someT2PubKey);

          await expect(bridge.claimLower(lowerProof)).to.emit(bridge, 'LogLowerLocked');
          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWith('SafeERC20: low-level call failed');
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Locked);

          await bridge.setReplenishAllowance(0n, lowerAmount);
          await expect(bridge.releaseLower(lowerId)).to.emit(bridge, 'LogReplenishmentMinted').withArgs(lowerAmount, 0n, lowerId);
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Used);
          expect(await avt.balanceOf(bridge.address)).to.equal(0n);
        });

        it('in releasing exactly at the unlock time', async () => {
          const [, lowerId, unlockTime] = await claimLockedLower(token20);
          await time.setNextBlockTimestamp(unlockTime);
          await expect(bridge.releaseLower(lowerId)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        });

        it('in keeping the unlock time of an existing locked lower when the lock period changes', async () => {
          const [, lowerId, unlockTime] = await claimLockedLower(token20);

          await bridge.setLowerLockPeriod(0n);
          expect((await bridge.pendingLowers(lowerId)).unlockTime).to.equal(unlockTime);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerIsLocked');

          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        });
      });

      context('fails when', () => {
        it('releasing before the lock period has passed', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerIsLocked');
        });

        it('releasing one second before the unlock time', async () => {
          const [, lowerId, unlockTime] = await claimLockedLower(token20);
          await time.setNextBlockTimestamp(unlockTime - 1n);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerIsLocked');
        });

        it('releasing a lower that is not pending', async () => {
          await expect(bridge.releaseLower(4_000_000_000)).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
        });

        it('releasing a lower that has already been released', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await increaseBlockTimestamp(LOCK_PERIOD);
          await bridge.releaseLower(lowerId);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
        });

        it('releasing while lowering is disabled', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await increaseBlockTimestamp(LOCK_PERIOD);
          await bridge.enableLowering(false);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerDisabled');
          await bridge.enableLowering(true);
          await bridge.releaseLower(lowerId);
        });

        it('claiming a lower that is already pending', async () => {
          const [lowerProof] = await claimLockedLower(token20);
          await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsPending');
        });
      });
    });

    context('Reverting by the recipient', () => {
      context('succeeds', () => {
        it('in reverting a locked lower, returning the stored funds to the T2 sender', async () => {
          const bridgeBalBefore = await token20.balanceOf(bridge.address);
          const recipientBalBefore = await token20.balanceOf(someOtherAccount.address);
          const [lowerProof, lowerId] = await claimLockedLower(token20);

          await expect(bridge.connect(someOtherAccount).revertLower(lowerProof))
            .to.emit(bridge, 'LogLowerReverted')
            .withArgs(token20.address, someT2PubKey, someOtherAccount.address, lowerAmount, lowerId);

          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Used);
          expect((await bridge.pendingLowers(lowerId)).unlockTime).to.equal(0n);
          expect(await token20.balanceOf(bridge.address)).to.equal(bridgeBalBefore);
          expect(await token20.balanceOf(someOtherAccount.address)).to.equal(recipientBalBefore);

          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
        });

        it('in using the stored lower data rather than altered proof data', async () => {
          const [lowerProof, lowerId] = await claimLockedLower(token20);
          const alteredProof = overwriteProof(overwriteProof(lowerProof, 20, ethers.toBeHex(lowerAmount * 1000n, 32)), 76, randomBytes32());

          await expect(bridge.connect(someOtherAccount).revertLower(alteredProof))
            .to.emit(bridge, 'LogLowerReverted')
            .withArgs(token20.address, someT2PubKey, someOtherAccount.address, lowerAmount, lowerId);
        });
      });

      context('fails when', () => {
        it('the lower is frozen', async () => {
          const [lowerProof] = await claimFrozenLower(token20);
          await expect(bridge.connect(someOtherAccount).revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsFrozen');
        });

        it('the caller is neither the recipient nor the owner', async () => {
          const [lowerProof] = await claimLockedLower(token20);
          await expect(bridge.connect(accounts[2]).revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'PermissionDenied');
        });

        it('the proof is altered to name the caller as recipient', async () => {
          const [lowerProof] = await claimLockedLower(token20);
          const alteredProof = overwriteProof(lowerProof, 52, accounts[2].address);
          await expect(bridge.connect(accounts[2]).revertLower(alteredProof)).to.be.revertedWithCustomError(bridge, 'PermissionDenied');
        });

        it('the lower is a legacy lower', async () => {
          const [lowerProof] = await claimLockedLower(token20, someOtherAccount, EMPTY_BYTES_32);
          await expect(bridge.connect(someOtherAccount).revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LegacyLower');
        });

        it('lifting is disabled', async () => {
          const [lowerProof] = await claimLockedLower(token20);
          await bridge.enableLifting(false);
          await expect(bridge.connect(someOtherAccount).revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
          await bridge.enableLifting(true);
          await bridge.connect(someOtherAccount).revertLower(lowerProof);
        });
      });
    });

    context('Owner interventions', () => {
      context('succeeds', () => {
        it('in freezing multiple lowers, blocking their release, and skipping those already frozen', async () => {
          const [, firstId] = await claimLockedLower(token20);
          const [, secondId] = await claimLockedLower(token20);
          await bridge.freezeLowers([firstId]);

          const receipt = await (await bridge.freezeLowers([firstId, secondId])).wait();
          const frozenLogs = receipt.logs.filter(log => log.fragment?.name === 'LogLowerFrozen');
          expect(frozenLogs.map(log => log.args.lowerId)).to.deep.equal([secondId]);

          expect(await bridge.lowerState(firstId)).to.equal(LOWER_STATE.Frozen);
          expect(await bridge.lowerState(secondId)).to.equal(LOWER_STATE.Frozen);
          expect((await bridge.pendingLowers(secondId)).frozen).to.equal(true);

          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(firstId)).to.be.revertedWithCustomError(bridge, 'LowerIsFrozen');
          await expect(bridge.releaseLower(secondId)).to.be.revertedWithCustomError(bridge, 'LowerIsFrozen');
        });

        it('in freezing a lower after its lock period has passed but before it is released', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.freezeLowers([lowerId]))
            .to.emit(bridge, 'LogLowerFrozen')
            .withArgs(lowerId);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerIsFrozen');
        });

        it('in freezing and cancelling while lifting and lowering are disabled', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await bridge.enableLifting(false);
          await bridge.enableLowering(false);

          await expect(bridge.freezeLowers([lowerId]))
            .to.emit(bridge, 'LogLowerFrozen')
            .withArgs(lowerId);
          await expect(bridge.cancelLower(lowerId)).to.emit(bridge, 'LogLowerCancelled').withArgs(lowerId);

          await bridge.enableLifting(true);
          await bridge.enableLowering(true);
        });

        it('in unfreezing a lower, keeping its original unlock time', async () => {
          const [, lowerId, unlockTime] = await claimFrozenLower(token20);

          await expect(bridge.unfreezeLower(lowerId)).to.emit(bridge, 'LogLowerUnfrozen').withArgs(lowerId);
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Locked);
          expect((await bridge.pendingLowers(lowerId)).unlockTime).to.equal(unlockTime);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerIsLocked');

          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        });

        it('in reverting a frozen lower, returning the funds to the T2 sender', async () => {
          const bridgeBalBefore = await token20.balanceOf(bridge.address);
          const [lowerProof, lowerId] = await claimFrozenLower(token20);

          await expect(bridge.revertLower(lowerProof))
            .to.emit(bridge, 'LogLowerReverted')
            .withArgs(token20.address, someT2PubKey, someOtherAccount.address, lowerAmount, lowerId);

          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Used);
          expect(await token20.balanceOf(bridge.address)).to.equal(bridgeBalBefore);
        });

        it('in reverting a frozen lower of which the owner is also the recipient', async () => {
          const [lowerProof, lowerId] = await claimFrozenLower(token20, owner);
          await expect(bridge.revertLower(lowerProof))
            .to.emit(bridge, 'LogLowerReverted')
            .withArgs(token20.address, someT2PubKey, owner.address, lowerAmount, lowerId);
        });

        it('in cancelling a frozen lower, leaving the funds on T1', async () => {
          const bridgeBalBefore = await token20.balanceOf(bridge.address);
          const recipientBalBefore = await token20.balanceOf(someOtherAccount.address);
          const [lowerProof, lowerId] = await claimFrozenLower(token20);

          const tx = bridge.cancelLower(lowerId);
          await expect(tx).to.emit(bridge, 'LogLowerCancelled').withArgs(lowerId);
          await expect(tx).to.not.emit(bridge, 'LogLowerReverted');

          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Used);
          expect((await bridge.pendingLowers(lowerId)).unlockTime).to.equal(0n);
          expect(await token20.balanceOf(bridge.address)).to.equal(bridgeBalBefore);
          expect(await token20.balanceOf(someOtherAccount.address)).to.equal(recipientBalBefore);

          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
          await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
          await expect(bridge.connect(someOtherAccount).revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
        });

        it('in cancelling a frozen legacy lower', async () => {
          const [, lowerId] = await claimFrozenLower(token20, someOtherAccount, EMPTY_BYTES_32);
          await expect(bridge.cancelLower(lowerId)).to.emit(bridge, 'LogLowerCancelled').withArgs(lowerId);
        });

        it('in unfreezing and releasing a frozen legacy lower', async () => {
          const [, lowerId] = await claimFrozenLower(token20, someOtherAccount, EMPTY_BYTES_32);
          await bridge.unfreezeLower(lowerId);
          await increaseBlockTimestamp(LOCK_PERIOD);
          await expect(bridge.releaseLower(lowerId)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        });
      });

      context('fails when', () => {
        it('a non-owner attempts to freeze, unfreeze or cancel', async () => {
          const [, lowerId] = await claimFrozenLower(token20);
          const nonOwner = bridge.connect(someOtherAccount);
          await expect(nonOwner.freezeLowers([lowerId])).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(nonOwner.unfreezeLower(lowerId)).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(nonOwner.cancelLower(lowerId)).to.be.revertedWith('Ownable: caller is not the owner');
        });

        it('freezing a lower that is not pending', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await expect(bridge.freezeLowers([lowerId, 4_000_000_000])).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Locked);
        });

        it('freezing a lower that has already been released', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await increaseBlockTimestamp(LOCK_PERIOD);
          await bridge.releaseLower(lowerId);
          await expect(bridge.freezeLowers([lowerId])).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
        });

        it('unfreezing a lower that is not pending or not frozen', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await expect(bridge.unfreezeLower(4_000_000_000)).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
          await expect(bridge.unfreezeLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerNotFrozen');
        });

        it('cancelling a lower that is not pending or not frozen', async () => {
          const [, lowerId] = await claimLockedLower(token20);
          await expect(bridge.cancelLower(4_000_000_000)).to.be.revertedWithCustomError(bridge, 'LowerNotPending');
          await expect(bridge.cancelLower(lowerId)).to.be.revertedWithCustomError(bridge, 'LowerNotFrozen');
        });

        it('reverting a locked lower that is not frozen, even after 72 hours have passed from the proof timestamp', async () => {
          const oldT2Timestamp = (await getCurrentBlockTimestamp()) - OWNER_DELAY - 5;
          const [lowerProof] = await claimLockedLower(token20, someOtherAccount, someT2PubKey, oldT2Timestamp);
          await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerNotFrozen');
        });

        it('reverting a frozen legacy lower', async () => {
          const [lowerProof] = await claimFrozenLower(token20, someOtherAccount, EMPTY_BYTES_32);
          await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LegacyLower');
        });

        it('reverting a frozen lower while lifting is disabled', async () => {
          const [lowerProof, lowerId] = await claimFrozenLower(token20);
          await bridge.enableLifting(false);
          await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
          expect(await bridge.lowerState(lowerId)).to.equal(LOWER_STATE.Frozen);
          await bridge.enableLifting(true);
          await expect(bridge.revertLower(lowerProof)).to.emit(bridge, 'LogLowerReverted');
        });
      });
    });
  });

  context('Check lower', () => {
    it('results are as expected for a valid, unused proof', async () => {
      const amount = 123n;
      const timestamp = Math.floor(Date.now() / 1000);
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, token20, amount, owner, someT2PubKey, timestamp);
      const [
        token,
        checkedAmount,
        recipient,
        lowerId,
        t2Sender,
        t2Timestamp,
        confirmationsRequired,
        confirmationsProvided,
        proofIsValid,
        lowerIsClaimed,
        state,
        lowerIsClaimable,
        lowerIsReleasable,
        unlockTime
      ] = await bridge.checkLower(lowerProof);

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
      expect(state).to.equal(LOWER_STATE.None);
      expect(lowerIsClaimable).to.equal(true);
      expect(lowerIsReleasable).to.equal(false);
      expect(unlockTime).to.equal(0);
    });

    it('results are as expected for a valid, used proof', async () => {
      const amount = 456n;
      await token777.send(bridge.address, amount, someT2PubKey);
      const timestamp = Math.floor(Date.now() / 1000);
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, token777, amount, owner, someT2PubKey, timestamp);
      await bridge.claimLower(lowerProof);

      const [
        token,
        checkedAmount,
        recipient,
        lowerId,
        t2Sender,
        t2Timestamp,
        confirmationsRequired,
        confirmationsProvided,
        proofIsValid,
        lowerIsClaimed,
        state,
        lowerIsClaimable,
        lowerIsReleasable,
        unlockTime
      ] = await bridge.checkLower(lowerProof);

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
      expect(state).to.equal(LOWER_STATE.Used);
      expect(lowerIsClaimable).to.equal(false);
      expect(lowerIsReleasable).to.equal(false);
      expect(unlockTime).to.equal(0);
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
      const [
        token,
        checkedAmount,
        recipient,
        lowerId,
        t2Sender,
        t2Timestamp,
        confirmationsRequired,
        confirmationsProvided,
        proofIsValid,
        lowerIsClaimed,
        state,
        lowerIsClaimable,
        lowerIsReleasable,
        unlockTime
      ] = await bridge.checkLower(invalidProof);
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
      expect(state).to.equal(LOWER_STATE.None);
      expect(lowerIsClaimable).to.equal(false);
      expect(lowerIsReleasable).to.equal(false);
    });

    it('results are as expected for a completely invalid proof', async () => {
      const emptyAddress = ZERO_ADDRESS.address;
      const shortProof = randomBytes32();
      const [
        token,
        amount,
        recipient,
        lowerId,
        t2Sender,
        t2Timestamp,
        confirmationsRequired,
        confirmationsProvided,
        proofIsValid,
        lowerIsClaimed,
        state,
        lowerIsClaimable,
        lowerIsReleasable,
        unlockTime
      ] = await bridge.checkLower(shortProof);

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
      expect(state).to.equal(LOWER_STATE.None);
      expect(lowerIsClaimable).to.equal(false);
      expect(lowerIsReleasable).to.equal(false);
      expect(unlockTime).to.equal(0);
    });
    context('when a lower lock period is set', () => {
      const LOCK_PERIOD = 60 * 60;

      before(async () => {
        await token20.approve(bridge.address, 1_000n);
        await bridge.lift(token20.address, someT2PubKey, 1_000n);
      });

      beforeEach(async () => {
        await bridge.setLowerLockPeriod(LOCK_PERIOD);
      });

      after(async () => {
        await bridge.setLowerLockPeriod(0n);
      });

      it('reports the state, claimability, releasability and unlock time through the lifecycle', async () => {
        const [lowerProof] = await createLowerProof(bridge, token20, 100n, someOtherAccount, someT2PubKey);
        await bridge.claimLower(lowerProof);
        const expectedUnlockTime = BigInt(await getCurrentBlockTimestamp()) + BigInt(LOCK_PERIOD);

        let result = await bridge.checkLower(lowerProof);
        expect(result.state).to.equal(LOWER_STATE.Locked);
        expect(result.lowerIsUsed).to.equal(false);
        expect(result.lowerIsClaimable).to.equal(false);
        expect(result.lowerIsReleasable).to.equal(false);
        expect(result.unlockTime).to.equal(expectedUnlockTime);

        await increaseBlockTimestamp(LOCK_PERIOD);
        result = await bridge.checkLower(lowerProof);
        expect(result.state).to.equal(LOWER_STATE.Locked);
        expect(result.lowerIsReleasable).to.equal(true);

        await bridge.freezeLowers([result.lowerId]);
        result = await bridge.checkLower(lowerProof);
        expect(result.state).to.equal(LOWER_STATE.Frozen);
        expect(result.lowerIsClaimable).to.equal(false);
        expect(result.lowerIsReleasable).to.equal(false);
        expect(result.unlockTime).to.equal(expectedUnlockTime);

        await bridge.unfreezeLower(result.lowerId);
        result = await bridge.checkLower(lowerProof);
        expect(result.state).to.equal(LOWER_STATE.Locked);
        expect(result.lowerIsReleasable).to.equal(true);

        await bridge.releaseLower(result.lowerId);
        result = await bridge.checkLower(lowerProof);
        expect(result.state).to.equal(LOWER_STATE.Used);
        expect(result.lowerIsUsed).to.equal(true);
        expect(result.lowerIsClaimable).to.equal(false);
        expect(result.lowerIsReleasable).to.equal(false);
        expect(result.unlockTime).to.equal(0);
      });

      it('reports neither claimable nor releasable while lowering is disabled', async () => {
        const [lockedProof] = await createLowerProof(bridge, token20, 100n, someOtherAccount, someT2PubKey);
        await bridge.claimLower(lockedProof);
        await increaseBlockTimestamp(LOCK_PERIOD);
        const [unclaimedProof] = await createLowerProof(bridge, token20, 100n, someOtherAccount, someT2PubKey);

        await bridge.enableLowering(false);
        expect((await bridge.checkLower(lockedProof)).lowerIsReleasable).to.equal(false);
        expect((await bridge.checkLower(unclaimedProof)).lowerIsClaimable).to.equal(false);
        await bridge.enableLowering(true);

        expect((await bridge.checkLower(lockedProof)).lowerIsReleasable).to.equal(true);
        expect((await bridge.checkLower(unclaimedProof)).lowerIsClaimable).to.equal(true);
      });

      it('reports a lower with no recipient as not claimable', async () => {
        const [lowerProof] = await createLowerProof(bridge, token20, 100n, ZERO_ADDRESS, someT2PubKey);
        const result = await bridge.checkLower(lowerProof);
        expect(result.proofIsValid).to.equal(true);
        expect(result.lowerIsClaimable).to.equal(false);
      });
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
          .withArgs(token20.address, someT2PubKey, recipient.address, lowerAmount, lowerId);

        // Revert should not transfer tokens to the recipient on T1
        expect(await token20.balanceOf(bridge.address)).to.equal(avnBalBefore);
        expect(await token20.balanceOf(recipient.address)).to.equal(recipBalBefore);

        // Lower has been marked off
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('allows the owner to revert on behalf of the recipient after 72 hours have passed from the proof timestamp', async () => {
        await token777.send(bridge.address, liftAmount, someT2PubKey);

        const oldT2Timestamp = (await getCurrentBlockTimestamp()) - OWNER_DELAY - 5;

        const avnBalBefore = await token777.balanceOf(bridge.address);
        const recipient = someOtherAccount;

        const [lowerProof, lowerId] = await createLowerProof(bridge, token777, lowerAmount, recipient, someT2PubKey, oldT2Timestamp);

        await expect(bridge.connect(owner).revertLower(lowerProof))
          .to.emit(bridge, 'LogLowerReverted')
          .withArgs(token777.address, someT2PubKey, recipient.address, lowerAmount, lowerId);

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

        await expect(bridge.enableLifting(false)).to.emit(bridge, 'LogLiftingEnabled').withArgs(false);
        await expect(bridge.revertLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LiftDisabled');
        await expect(bridge.enableLifting(true)).to.emit(bridge, 'LogLiftingEnabled').withArgs(true);

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
      ERC777Lift: 3,
      ReleaseLower: 4
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

    it('the releaseLower re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ReleaseLower);
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
