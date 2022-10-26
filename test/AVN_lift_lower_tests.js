const testHelper = require('./helpers/testHelper');
const AVN = artifacts.require('AVN');
const Token777 = artifacts.require('Token777');
const Token20 = artifacts.require('Token20');
const BN = web3.utils.BN;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const AVT_ADDRESS = '0x0d88eD6E74bbFD96B831231638b66C05571e824F';
const DIRECT_LOWER_NUM_BYTES = 2;
const PROXY_LOWER_NUM_BYTES = 133;
const ONE_AVT_IN_ATTO = new BN(10).pow(new BN(18));

let avn, token777, token20;
let accounts, validators;
let owner, someOtherAccount, someT2PublicKey;

contract('AVN', async () => {

  before(async () => {
    await testHelper.init();
    token777 = await Token777.deployed();
    token20 = await Token20.deployed();
    avn = await AVN.deployed();
    accounts = testHelper.accounts();
    owner = accounts[0];
    someOtherAccount = accounts[1];
    someT2PublicKey = testHelper.someT2PublicKey();
    validators = testHelper.validators();
    await testHelper.loadValidators(avn, validators, 10);
  });

  context('Authorisation', async () => {
    let avn1, avn2, avn3, avn4;

    before(async () => {
      // Create some contracts as only contracts can be authorised
      avn1 = await AVN.new(AVT_ADDRESS, ZERO_ADDRESS);
      avn2 = await AVN.new(AVT_ADDRESS, ZERO_ADDRESS);
      avn3 = await AVN.new(AVT_ADDRESS, ZERO_ADDRESS);
      avn4 = await AVN.new(AVT_ADDRESS, ZERO_ADDRESS);
    });

    async function checkAuthorisationLog(_address, _status, _expectLog) {
      const logArgs = await testHelper.getLogArgs(avn, 'LogAuthorisationUpdated', _expectLog);
      if (_expectLog) {
        assert.equal(logArgs.contractAddress, _address);
        assert.equal(logArgs.status, _status);
      }
    }

    async function hasSameElements(_authorised) {
      const contractArray = (await avn.getAuthorisedContracts()).slice().sort();
      assert.deepEqual(contractArray, _authorised.slice().sort());
    }

    it('fails to set storage permission if not called by owner', async () => {
      await testHelper.expectRevert(() => avn.setAuthorisationStatus(someOtherAccount, true, {from: someOtherAccount}),
          'Only owner');
    });

    it('fails to set storage permission for an EOA address', async () => {
      await testHelper.expectRevert(() => avn.setAuthorisationStatus(owner, true), 'Only contracts');
    });

    it('fails to access any authorised functions if not authorised sender', async () => {
      await testHelper.expectRevert(() => avn.storeT2TransactionId(testHelper.randomUint256()), 'Access denied');
      await testHelper.expectRevert(() => avn.storeRootHash(testHelper.randomBytes32()), 'Access denied');
      await testHelper.expectRevert(() => avn.storeLiftProofHash(testHelper.randomBytes32()), 'Access denied');
      await testHelper.expectRevert(() => avn.storeLoweredLeafHash(testHelper.randomBytes32()), 'Access denied');
      await testHelper.expectRevert(() => avn.unlockETH(owner, 1), 'Access denied');
      await testHelper.expectRevert(() => avn.unlockERC20Tokens(token20.address, owner, 1), 'Access denied');
      await testHelper.expectRevert(() => avn.unlockERC777Tokens(token777.address, owner, 1), 'Access denied');
    });

    it('State remains as expected', async () => {
      let authorised = [];
      await hasSameElements(authorised);

      // Add a new address
      await avn.setAuthorisationStatus(avn1.address, true);
      await checkAuthorisationLog(avn1.address, true, true);
      authorised.push(avn1.address);
      await hasSameElements(authorised);

      // Set an address to the same status
      await avn.setAuthorisationStatus(avn1.address, true);
      await checkAuthorisationLog(avn1.address, true, false); // no log expected if setting to same status
      await hasSameElements(authorised); // no update to authorised array expected either

      // Add more authorised
      await avn.setAuthorisationStatus(avn2.address, true);
      authorised.push(avn2.address);
      await avn.setAuthorisationStatus(avn3.address, true);
      authorised.push(avn3.address);
      await avn.setAuthorisationStatus(avn4.address, true);
      authorised.push(avn4.address);
      await hasSameElements(authorised);

      // Remove from the start of the array
      await avn.setAuthorisationStatus(avn1.address, false);
      await checkAuthorisationLog(avn1.address, false, true);
      authorised.splice(authorised.indexOf(avn1.address), 1);
      await hasSameElements(authorised);

      // Remove from the end
      await avn.setAuthorisationStatus(avn3.address, false);
      authorised.splice(authorised.indexOf(avn3.address), 1);
      await hasSameElements(authorised);

      // Remove all
      await avn.setAuthorisationStatus(avn1.address, false);
      await avn.setAuthorisationStatus(avn4.address, false);
      await avn.setAuthorisationStatus(avn2.address, false);
      await avn.setAuthorisationStatus(avn3.address, false);
      await hasSameElements([]);
    });
  });

  context('setOwner', async () => {

    it('succeeds', async () => {
      await avn.setOwner(someOtherAccount);
      assert.equal(someOtherAccount, await avn.owner());
      const logArgs = await testHelper.getLogArgs(avn, 'LogOwnershipTransferred');
      assert.equal(logArgs.owner, owner);
      assert.equal(logArgs.newOwner, someOtherAccount);
      await avn.setOwner(owner, {from: someOtherAccount});
      assert.equal(owner, await avn.owner());
    });

    it('fails if the new owner has a zero address', async () => {
      await testHelper.expectRevert(() => avn.setOwner(ZERO_ADDRESS), 'Owner cannot be zero address');
    });

    it('fails if the sender is not owner', async () => {
      await testHelper.expectRevert(() => avn.setOwner(owner, {from: someOtherAccount}), 'Only owner');
    });
  });

  context('update and check lower IDs', async () => {
    const newID = '0xff00';

    async function checkCanLower() {
      await avn.liftETH(someT2PublicKey, {value: 1000});
      const tree = await testHelper.createTreeAndPublishRoot(avn, testHelper.PSEUDO_ETH_ADDRESS, 1000, false, newID);
      try {
        await avn.lower(tree.leafData, tree.merklePath);
      } catch (error) {
        return false;
      }
      return true;
    }

    it('owner can add a lower call', async () => {
      await avn.updateLowerCall(newID, DIRECT_LOWER_NUM_BYTES);
      const logArgs = await testHelper.getLogArgs(avn, 'LogLowerCallUpdated');
      assert.equal(logArgs.callId, newID);
      assert.equal(logArgs.numBytes.toNumber(), DIRECT_LOWER_NUM_BYTES);
      assert.equal(await checkCanLower(), true);
    });

    it('owner can remove a lower call by setting numbytes to zero', async () => {
      await avn.updateLowerCall(newID, 0);
      const logArgs = await testHelper.getLogArgs(avn, 'LogLowerCallUpdated');
      assert.equal(logArgs.callId, newID);
      assert.equal(logArgs.numBytes.toNumber(), 0);
      assert.equal(await checkCanLower(), false);
    });

    it('fails to update a lower call when not the owner', async () => {
      await testHelper.expectRevert(() => avn.updateLowerCall(newID, DIRECT_LOWER_NUM_BYTES, {from: someOtherAccount}),
          'Only owner');
    });

    it('check an existing lower call', async () => {
      assert.equal(await avn.numBytesToLowerData(testHelper.LOWER_ID), DIRECT_LOWER_NUM_BYTES);
    });

    it('check an existing proxy lower pointer', async () => {
      assert.equal(await avn.numBytesToLowerData(testHelper.PROXY_LOWER_ID), PROXY_LOWER_NUM_BYTES);
    });

    it('check a non-existent pointer', async () => {
      assert.equal(await avn.numBytesToLowerData(newID), 0);
    });
  });

  context('lift()', async () => {

    it('can lift ETH [ @skip-on-coverage ]', async () => {
      const avnEthBalanceBefore = new BN(await web3.eth.getBalance(avn.address));
      const lifterEthBalanceBefore = new BN(await web3.eth.getBalance(owner));
      const liftAmount = new BN(123);

      const tx = await avn.liftETH(someT2PublicKey, {value: liftAmount});
      const gasPrice = new BN(await web3.eth.getGasPrice());
      const txCost = new BN(tx.receipt.gasUsed).mul(gasPrice);

      const avnEthBalanceAfter = new BN(await web3.eth.getBalance(avn.address));
      const lifterEthBalanceAfter = new BN(await web3.eth.getBalance(owner));

      assert.equal(avnEthBalanceBefore.add(liftAmount).toString(), avnEthBalanceAfter.toString());
      assert.equal(lifterEthBalanceBefore.sub(liftAmount).sub(txCost).toString(), lifterEthBalanceAfter.toString());

      const logArgs = await testHelper.getLogArgs(avn, 'LogLifted');
      assert.equal(logArgs.token, testHelper.PSEUDO_ETH_ADDRESS);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC777 tokens', async () => {
      const liftAmount = new BN(100)
      await token777.send(avn.address, liftAmount, someT2PublicKey);

      const logArgs = await testHelper.getLogArgs(avn, 'LogLifted');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC777 tokens via operatorSend', async () => {
      const liftAmount = new BN(100)
      const otherOperatorData = '0x1234';
      await token777.operatorSend(owner, avn.address, liftAmount, someT2PublicKey, otherOperatorData);
      const logArgs = await testHelper.getLogArgs(avn, 'LogLifted');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC20 tokens', async () => {
      const avnBalanceBefore = await token20.balanceOf(avn.address);
      const liftAmount = new BN(200);
      await token20.approve(avn.address, liftAmount);
      await avn.lift(token20.address, someT2PublicKey, liftAmount);

      assert.equal(avnBalanceBefore.add(liftAmount).toString(), (await token20.balanceOf(avn.address)).toString());

      const logArgs = await testHelper.getLogArgs(avn, 'LogLifted');
      assert.equal(logArgs.token, token20.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC20 tokens via proxyLift on behalf of someone else', async () => {
      const liftAmount = new BN(200);
      const proofNonce = 1;
      const liftProofHash = testHelper.hash(token20.address, someT2PublicKey, liftAmount, proofNonce);
      const proof = await testHelper.sign(liftProofHash, owner);

      await token20.approve(avn.address, liftAmount, {from: owner});

      // the someOtherAccount never holds any funds
      assert.equal(await token20.balanceOf(someOtherAccount), 0);
      await avn.proxyLift(token20.address, someT2PublicKey, liftAmount, owner, proofNonce, proof, {from: someOtherAccount});
      assert.equal(await token20.balanceOf(someOtherAccount), 0);

      const logArgs = await testHelper.getLogArgs(avn, 'LogLifted');
      assert.equal(logArgs.token, token20.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount, liftAmount.toString());
    });

    it('can lift ERC20 tokens via proxyLift for oneself', async () => {
      const liftAmount = new BN(100);
      const proofNonce = 2;
      const liftProofHash = testHelper.hash(token20.address, someT2PublicKey, liftAmount, proofNonce);
      const proof = await testHelper.sign(liftProofHash, owner);

      await token20.approve(avn.address, liftAmount, {from: owner});
      await avn.proxyLift(token20.address, someT2PublicKey, liftAmount, owner, proofNonce, proof, {from: owner});

      const logArgs = await testHelper.getLogArgs(avn, 'LogLifted');
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
        await massiveERC777.send(avn.address, maxLiftAmount, someT2PublicKey);

        massiveERC20 = await Token20.new(massiveTotalSupply);
        await massiveERC20.approve(avn.address, maxLiftAmount);
        await avn.lift(massiveERC20.address, someT2PublicKey, maxLiftAmount);
      });

      it('attempting to lift 0 ETH', async () => {
        await testHelper.expectRevert(() => avn.liftETH(someT2PublicKey), 'Cannot lift zero ETH');
      });

      it('attempting to lift ETH without supplying a public key', async () => {
        await testHelper.expectRevert(() => avn.liftETH('0x', {value: 100}), 'Bad T2 public key');
      });

      it('attempting to lift ETH with an incorrect T2 public key (too short)', async () => {
        await testHelper.expectRevert(() => avn.liftETH(web3.utils.randomHex(16), {value: 100}), 'Bad T2 public key');
      });

      it('attempting to lift ETH with an incorrect T2 public key(too long)', async () => {
        await testHelper.expectRevert(() => avn.liftETH(web3.utils.randomHex(48), {value: 100}), 'Bad T2 public key');
      });

      it('attempting to lift 0 ERC20 tokens', async () => {
        await token20.approve(avn.address, 0);
        await testHelper.expectRevert(() => avn.lift(token20.address, someT2PublicKey, 0), 'Cannot lift zero ERC20 tokens');
      });

      it('attempting to lift ERC-20 tokens without supplying a T2 public key', async () => {
        await token20.approve(avn.address, 1);
        await testHelper.expectRevert(() => avn.lift(token20.address, '0x', 1), 'Bad T2 public key');
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key (too short)', async () => {
        await token20.approve(avn.address, 1);
        await testHelper.expectRevert(() => avn.lift(token20.address, web3.utils.randomHex(16), 1), 'Bad T2 public key');
      });

      it('attempting to lift ERC-20 tokens with an incorrect T2 public key(too long)', async () => {
        await token20.approve(avn.address, 1);
        await testHelper.expectRevert(() => avn.lift(token20.address, web3.utils.randomHex(48), 1), 'Bad T2 public key');
      });

      it('attempting to lift 0 ERC777 tokens', async () => {
        await testHelper.expectRevert(() => token777.send(avn.address, 0, someT2PublicKey), 'Cannot lift zero ERC777 tokens');
      });

      it('attempting to lift ERC777 tokens without supplying a T2 public key', async () => {
        await testHelper.expectRevert(() => token777.send(avn.address, 1, '0x'), 'Bad T2 public key');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key (too short)', async () => {
        await testHelper.expectRevert(() => token777.send(avn.address, 1, web3.utils.randomHex(16)), 'Bad T2 public key');
      });

      it('attempting to lift ERC777 tokens with an incorrect T2 public key(too long)', async () => {
        await testHelper.expectRevert(() => token777.send(avn.address, 1, web3.utils.randomHex(48)), 'Bad T2 public key');
      });

      it('attempting to lift more ERC777 tokens to T2 than its supported limit', async () => {
        await testHelper.expectRevert(() => massiveERC777.send(avn.address, 1, someT2PublicKey), 'Exceeds ERC777 lift limit');
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        await massiveERC20.approve(avn.address, 1);
        await testHelper.expectRevert(() => avn.lift(massiveERC20.address, someT2PublicKey, 1), 'Exceeds ERC20 lift limit');
      });

      it('attempting a proxy ERC20 lift using an invalid lift proof', async () => {
         const liftAmount = new BN(100);
         const proofNonce = 100;
         const proof = await testHelper.randomBytes32()
         await token20.approve(avn.address, liftAmount, {from: owner});
         await testHelper.expectRevert(() => avn.proxyLift(token20.address, someT2PublicKey, liftAmount, owner, proofNonce,
            proof, {from: someOtherAccount}), 'Lift proof invalid');
        });

        it('attempting a proxy ERC20 lift by re-using a used lift proof', async () => {
         const liftAmount = new BN(100);
         const proofNonce = 1;
         const liftProofHash = testHelper.hash(token20.address, someT2PublicKey, liftAmount, proofNonce);
         const proof = await testHelper.sign(liftProofHash, owner);
         await token20.approve(avn.address, liftAmount, {from: owner});
         await avn.proxyLift(token20.address, someT2PublicKey, liftAmount, owner, proofNonce, proof, {from: someOtherAccount});
         await token20.approve(avn.address, liftAmount, {from: owner});
         await testHelper.expectRevert(() => avn.proxyLift(token20.address, someT2PublicKey, liftAmount, owner, proofNonce,
            proof, {from: someOtherAccount}), 'Lift proof already used');
        });

      it('attempting to lift ETH when lift is disabled', async () => {
        await avn.disableLifting();
        let logArgs = await testHelper.getLogArgs(avn, 'LogLiftingIsEnabled');
        assert.equal(logArgs.status, false);
        await testHelper.expectRevert(() => avn.liftETH(someT2PublicKey, {value:100}), 'Lifting currently disabled');
        await avn.enableLifting();
        logArgs = await testHelper.getLogArgs(avn, 'LogLiftingIsEnabled');
        assert.equal(logArgs.status, true);
        await avn.liftETH(someT2PublicKey, {value:100});
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avn.disableLifting();
        await testHelper.expectRevert(() => token777.send(avn.address, 1, someT2PublicKey), 'Lifting currently disabled');
        await avn.enableLifting();
        await token777.send(avn.address, 1, someT2PublicKey);
      });

      it('attempting to lift ERC20 tokens when lift is disabled', async () => {
        await avn.disableLifting();
        await token20.approve(avn.address, 1);
        await testHelper.expectRevert(() => avn.lift(token20.address, someT2PublicKey, 1), 'Lifting currently disabled');
        await avn.enableLifting();
        await avn.lift(token20.address, someT2PublicKey, 1);
      });

      it('attempting to lift ERC777 tokens using ERC20 backwards compatability ', async () => {
        const amount = new BN(2);
        await token777.approve(avn.address, amount);
        await testHelper.expectRevert(() => avn.lift(token777.address, someT2PublicKey, amount), 'ERC20 lift only');
      });

      it('attempting to lift ERC777 tokens when lift is disabled', async () => {
        await avn.disableLifting();
        await testHelper.expectRevert(() => token777.send(avn.address, 1, someT2PublicKey), 'Lifting currently disabled');
        await avn.enableLifting();
        await token777.send(avn.address, 1, someT2PublicKey);
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await token20.approve(avn.address, 100);
        await testHelper.expectRevert(() => avn.lift(token20.address, someT2PublicKey, 200),
            'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await testHelper.expectRevert(() => avn.lift(token20.address, someT2PublicKey, 1, {from: someOtherAccount}),
            'ERC20: insufficient allowance');
      });

      it('attempting to lift more ERC777 tokens than are available in sender balance', async () => {
        await testHelper.expectRevert(() => token777.send(avn.address, 1, someT2PublicKey, {from: someOtherAccount}),
            'ERC777: transfer amount exceeds balance');
      });

      it('calling FTSM tokensReceived hook directly with tokens not destined for the FTSM', async () => {
        await testHelper.expectRevert(() => avn.tokensReceived(owner, owner, someOtherAccount, 100, someT2PublicKey, '0x'),
            'Tokens must be sent to this contract');
      });

      it('calling FTSM tokensReceived hook directly and not a registered contract', async () => {
        await testHelper.expectRevert(() => avn.tokensReceived(owner, owner, avn.address, 100, someT2PublicKey, '0x'),
            'Token must be registered');
      });
    });
  });

  context('lower()', async () => {
    const liftAmount = new BN(100);
    const lowerAmount = new BN(50);

    it('lower ETH succeeds [ @skip-on-coverage ]', async () => {
      await avn.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avn, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount);

      const avnEthBalanceBefore = new BN(await web3.eth.getBalance(avn.address));
      const lowererEthBalanceBefore = new BN(await web3.eth.getBalance(owner));

      const tx = await avn.lower(tree.leafData, tree.merklePath);
      const gasPrice = new BN(await web3.eth.getGasPrice());
      const txCost = new BN(tx.receipt.gasUsed).mul(gasPrice);

      const avnEthBalanceAfter = new BN(await web3.eth.getBalance(avn.address));
      const lowererEthBalanceAfter = new BN(await web3.eth.getBalance(owner));

      assert.equal(avnEthBalanceBefore.sub(lowerAmount).toString(), avnEthBalanceAfter.toString());
      assert.equal(lowererEthBalanceBefore.add(lowerAmount).sub(txCost).toString(), lowererEthBalanceAfter.toString());

      const logArgs = await testHelper.getLogArgs(avn, 'LogLowered');
      assert.equal(logArgs.token, testHelper.PSEUDO_ETH_ADDRESS);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
    });

    it('proxy lower ETH succeeds [ @skip-on-coverage ]', async () => {
      await avn.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avn, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount, true);

      const avnEthBalanceBefore = new BN(await web3.eth.getBalance(avn.address));
      const lowererEthBalanceBefore = new BN(await web3.eth.getBalance(owner));

      const tx = await avn.lower(tree.leafData, tree.merklePath);
      const gasPrice = new BN(await web3.eth.getGasPrice());
      const txCost = new BN(tx.receipt.gasUsed).mul(gasPrice);

      const avnEthBalanceAfter = new BN(await web3.eth.getBalance(avn.address));
      const lowererEthBalanceAfter = new BN(await web3.eth.getBalance(owner));

      assert.equal(avnEthBalanceBefore.sub(lowerAmount).toString(), avnEthBalanceAfter.toString());
      assert.equal(lowererEthBalanceBefore.add(lowerAmount).sub(txCost).toString(), lowererEthBalanceAfter.toString());

      const logArgs = await testHelper.getLogArgs(avn, 'LogLowered');
      assert.equal(logArgs.token, testHelper.PSEUDO_ETH_ADDRESS);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
    });

    it('lift and lower ETH for coverage', async () => {
      await avn.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avn, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount);
      await avn.lower(tree.leafData, tree.merklePath);
    });

    it('proxy lift and lower ETH for coverage', async () => {
      await avn.liftETH(someT2PublicKey, {value: liftAmount});
      const tree = await testHelper.createTreeAndPublishRoot(avn, testHelper.PSEUDO_ETH_ADDRESS, lowerAmount, true);
      await avn.lower(tree.leafData, tree.merklePath);
    });

    it('lower ERC20 succeeds', async () => {
      // lift
      await token20.approve(avn.address, liftAmount);
      await avn.lift(token20.address, someT2PublicKey, liftAmount);
      // record pre-lower balances
      const avnBalanceBefore = await token20.balanceOf(avn.address);
      const senderBalBefore = await token20.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avn, token20.address, lowerAmount);

      // lower and confirm values
      await avn.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avn, 'LogLowered');
      assert.equal(logArgs.token, token20.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token20.balanceOf(avn.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token20.balanceOf(owner)).toString());
    });

    it('proxy lower ERC20 succeeds', async () => {
      // lift
      await token20.approve(avn.address, liftAmount);
      await avn.lift(token20.address, someT2PublicKey, liftAmount);
      // record pre-lower balances
      const avnBalanceBefore = await token20.balanceOf(avn.address);
      const senderBalBefore = await token20.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avn, token20.address, lowerAmount, true);

      // lower and confirm values
      await avn.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avn, 'LogLowered');
      assert.equal(logArgs.token, token20.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token20.balanceOf(avn.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token20.balanceOf(owner)).toString());
    });

    it('lower ERC777 succeeds', async () => {
      // lift
      await token777.send(avn.address, liftAmount, someT2PublicKey);
      // record pre-lower balances
      const avnBalanceBefore = await token777.balanceOf(avn.address);
      const senderBalBefore = await token777.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avn, token777.address, lowerAmount);

      // lower and confirm values
      await avn.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avn, 'LogLowered');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token777.balanceOf(avn.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token777.balanceOf(owner)).toString());
    });

    it('proxy lower ERC777 succeeds', async () => {
      // lift
      await token777.send(avn.address, liftAmount, someT2PublicKey);
      // record pre-lower balances
      const avnBalanceBefore = await token777.balanceOf(avn.address);
      const senderBalBefore = await token777.balanceOf(owner);

      let tree = await testHelper.createTreeAndPublishRoot(avn, token777.address, lowerAmount, true);

      // lower and confirm values
      await avn.lower(tree.leafData, tree.merklePath, {from: someOtherAccount});
      const logArgs = await testHelper.getLogArgs(avn, 'LogLowered');
      assert.equal(logArgs.token, token777.address);
      assert.equal(logArgs.t1Address, owner);
      assert.equal(logArgs.t2PublicKey, someT2PublicKey);
      assert.equal(logArgs.amount.toString(), lowerAmount.toString());
      assert.equal(avnBalanceBefore.sub(lowerAmount).toString(), (await token777.balanceOf(avn.address)).toString());
      assert.equal(senderBalBefore.add(lowerAmount).toString(), (await token777.balanceOf(owner)).toString());
    });

    context('lower fails when', async () => {
      let tree;

      beforeEach(async () => {
        tree = await testHelper.createTreeAndPublishRoot(avn, token777.address, lowerAmount);
      });

      it('lowering is disabled', async () => {
        await avn.disableLowering();
        let logArgs = await testHelper.getLogArgs(avn, 'LogLoweringIsEnabled');
        assert.equal(logArgs.status, false);
        await testHelper.expectRevert(() => avn.lower(tree.leafData, tree.merklePath), 'Lowering currently disabled');
        await avn.enableLowering();
        logArgs = await testHelper.getLogArgs(avn, 'LogLoweringIsEnabled');
        assert.equal(logArgs.status, true);
        await avn.lower(tree.leafData, tree.merklePath);
      });

      it('the leaf has already been used for a lower', async () => {
        await avn.lower(tree.leafData, tree.merklePath);
        await testHelper.expectRevert(() => avn.lower(tree.leafData, tree.merklePath), 'Already lowered');
      });

      it('leaf is invalid', async () => {
        await testHelper.expectRevert(() => avn.lower(testHelper.randomBytes32(), tree.merklePath), 'Leaf or path invalid');
      });

      it('path is invalid', async () => {
        await testHelper.expectRevert(() => avn.lower(tree.leafData, [testHelper.randomBytes32()]), 'Leaf or path invalid');
      });

      it('leaf is not recognised as a lower leaf', async () => {
        const  badId = '0xaaaa';
        tree = await testHelper.createTreeAndPublishRoot(avn, token777.address, lowerAmount, true, badId);
        await testHelper.expectRevert(() => avn.lower(tree.leafData, tree.merklePath), 'Not a lower leaf');
      });

      it('attempting to lower ETH to an address which cannot receive it', async () => {
        await avn.liftETH(someT2PublicKey, {value: 100});
        const addressCannotReceiveETH = token20.address;
        tree = await testHelper.createTreeAndPublishRootWithLoweree(avn, addressCannotReceiveETH, testHelper.PSEUDO_ETH_ADDRESS,
            lowerAmount);
        await testHelper.expectRevert(() => avn.lower(tree.leafData, tree.merklePath), 'ETH transfer failed');
      });
    });
  });

  context('confirmT2Transaction', async() =>{
    it('confirm a leaf exists in published tree', async () => {
      let tree = await testHelper.createTreeAndPublishRoot(avn, token777.address, 0);
      assert.equal(await avn.confirmAvnTransaction(tree.leafHash, tree.merklePath), true);
      assert.equal(await avn.confirmAvnTransaction(testHelper.randomBytes32(), tree.merklePath), false);
    });
  });

  context('calling avn functions directly without permission', async () => {

    it('storeT2TransactionId() fails', async () => {
      await testHelper.expectRevert(() => avn.storeT2TransactionId(testHelper.randomUint256()), 'Access denied');
    });

    it('storeRootHash() fails', async () => {
      await testHelper.expectRevert(() => avn.storeRootHash(testHelper.randomBytes32()), 'Access denied');
    });

    it('storeLiftProofHash() fails', async () => {
      await testHelper.expectRevert(() => avn.storeLiftProofHash(testHelper.randomBytes32()), 'Access denied');
    });

    it('storeLoweredLeafHash() fails', async () => {
      await testHelper.expectRevert(() => avn.storeLoweredLeafHash(testHelper.randomBytes32()), 'Access denied');
    });

    it('unlockETH() fails', async () => {
      await testHelper.expectRevert(() => avn.unlockETH(owner, 10), 'Access denied');
    });

    it('unlockERC20Tokens() fails', async () => {
      await testHelper.expectRevert(() => avn.unlockERC20Tokens(token20.address, owner, 10), 'Access denied');
    });

    it('unlockERC777Tokens() fails', async () => {
      await testHelper.expectRevert(() => avn.unlockERC777Tokens(token777.address, owner, 10), 'Access denied');
    });
  });

  context('avn token recovery', async () => {
    let newAvn;

    before(async () => {
      newAvn = await AVN.new(AVT_ADDRESS, avn.address);
      const amount = new BN(1000);
      // Ensure some funds are in the old oldAvn
      await token777.send(avn.address, amount, someT2PublicKey);
      await token20.transfer(avn.address, amount);
      // We lift ETH as it's the only way we can add ETH
      await avn.liftETH(someT2PublicKey, {value: 123});
      // Enable the AVN as a treasurer
      await avn.setAuthorisationStatus(newAvn.address, true);
    });

    it('erc777 recovery fails when not called by owner', async () => {
      await testHelper.expectRevert(() => newAvn.recoverERC777Tokens(token777.address, {from: someOtherAccount}), 'Only owner');
    });

    it('erc20 recovery fails when not called by owner', async () => {
      await testHelper.expectRevert(() => newAvn.recoverERC20Tokens(token20.address, {from: someOtherAccount}), 'Only owner');
    });

    it('can recover ERC777 tokens', async () => {
      const avnBalanceBefore = new BN(await token777.balanceOf(newAvn.address));
      const oldAvnBalanceBefore = new BN(await token777.balanceOf(avn.address));
      await newAvn.recoverERC777Tokens(token777.address);

      const avnBalanceAfter = new BN(await token777.balanceOf(newAvn.address));
      const oldAvnBalanceAfter = new BN(await token777.balanceOf(avn.address));

      assert.equal(oldAvnBalanceAfter.toString(), '0');
      assert.equal(avnBalanceAfter.toString(), oldAvnBalanceBefore.add(avnBalanceBefore).toString());
    });

    it('can recover ERC20 tokens', async () => {
      const avnBalanceBefore = new BN(await token20.balanceOf(newAvn.address));
      const oldAvnBalanceBefore = new BN(await token20.balanceOf(avn.address));
      await newAvn.recoverERC20Tokens(token20.address);

      const avnBalanceAfter = new BN(await token20.balanceOf(newAvn.address));
      const oldAvnBalanceAfter = new BN(await token20.balanceOf(avn.address));

      assert.equal(oldAvnBalanceAfter.toString(), '0');
      assert.equal(avnBalanceAfter.toString(), oldAvnBalanceBefore.add(avnBalanceBefore).toString());
    });

    it('can recover ETH', async () => {
      const avnBalanceBefore = new BN(await web3.eth.getBalance(newAvn.address));
      const oldAvnBalanceBefore = new BN(await web3.eth.getBalance(avn.address));
      await newAvn.recoverETH();

      const avnBalanceAfter = new BN(await web3.eth.getBalance(newAvn.address));
      const oldAvnBalanceAfter = new BN(await web3.eth.getBalance(avn.address));

      assert.equal(oldAvnBalanceAfter.toString(), '0');
      assert.equal(avnBalanceAfter.toString(), oldAvnBalanceBefore.add(avnBalanceBefore).toString());
    });
  });

  context('triggerGrowth', async () => {
    const growthAmount = ONE_AVT_IN_ATTO.mul(new BN(10));

    beforeEach(async () => {
      await token20.approve(avn.address, growthAmount);
    });

    it('fails to trigger growth if not called by the owner', async () => {
      await testHelper.expectRevert(() => avn.triggerGrowth(growthAmount, {from: someOtherAccount}), 'Only owner');
    });

    it('fails to trigger zero growth', async () => {
      await testHelper.expectRevert(() => avn.triggerGrowth(0), 'Cannot trigger zero growth');
    });

    it('succeeds for the first era', async () => {
      const avnBalanceBefore = await token20.balanceOf(avn.address);
      const ownerBalanceBefore = await token20.balanceOf(owner);

      await avn.triggerGrowth(growthAmount);
      const logArgs = await testHelper.getLogArgs(avn, 'LogGrowth');
      testHelper.bnEquals(logArgs.amount, growthAmount);
      testHelper.bnEquals(logArgs.era, 1);

      const avnBalanceAfter = await token20.balanceOf(avn.address);
      const ownerBalanceAfter = await token20.balanceOf(owner);

      testHelper.bnEquals(avnBalanceBefore.add(growthAmount), avnBalanceAfter);
      testHelper.bnEquals(ownerBalanceBefore.sub(growthAmount), ownerBalanceAfter);
    });

    it('succeeds for the second era', async () => {
      await avn.triggerGrowth(growthAmount);
      const logArgs = await testHelper.getLogArgs(avn, 'LogGrowth');
      testHelper.bnEquals(logArgs.era, 2);
    });
  });
});