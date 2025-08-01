const helper = require('./helpers/testHelper');
const { expect } = require('chai');

let avnBridge, accounts, authors, unauthorizedAccount;

const NUM_AUTHORS = 10;

describe('Rotation', async () => {
  before(async () => {
    await helper.init();
    const Token20 = await ethers.getContractFactory('Token20');
    const token20 = await Token20.deploy(10000000n);
    token20.address = await token20.getAddress();
    avnBridge = await helper.deployAVNBridge(token20.address, NUM_AUTHORS);
    avnBridge.address = await avnBridge.getAddress();
    accounts = helper.accounts();
    authors = helper.authors();
    unauthorizedAccount = accounts[1];
  });

  context('Rotation', async () => {
    context('succeeds', async () => {
      async function removeAuthor(id) {
        expiry = await helper.getValidExpiry();
        t2TxId = helper.randomT2TxId();
        confirmations = await helper.getConfirmations(
          avnBridge,
          'removeAuthor',
          [authors[id - 1].t2PubKey, authors[id - 1].t1PubKey],
          expiry,
          t2TxId
        );
        await avnBridge
          .connect(authors[0].account)
          .removeAuthor(authors[id - 1].t2PubKey, authors[id - 1].t1PubKey, expiry, t2TxId, confirmations);
      }

      it('when called by the owner', async () => {
        expect(await avnBridge.numActiveAuthors()).to.equal(NUM_AUTHORS);

        await removeAuthor(6);
        await removeAuthor(8);

        expect(await avnBridge.numActiveAuthors()).to.equal(NUM_AUTHORS - 2);
        expect(await avnBridge.authorIsActive(5)).to.equal(true);
        expect(await avnBridge.authorIsActive(6)).to.equal(false);
        expect(await avnBridge.authorIsActive(7)).to.equal(true);
        expect(await avnBridge.authorIsActive(8)).to.equal(false);

        const startID = 1;
        const endID = NUM_AUTHORS;

        const oldT1Addresses = [];
        for (let i = startID; i <= endID; i++) {
          oldT1Addresses.push(await avnBridge.idToT1Address(i));
        }

        const newT1Addresses = Array.from({ length: NUM_AUTHORS }, () => ethers.Wallet.createRandom().address);
        await avnBridge.rotateT1(newT1Addresses, startID, endID);

        for (let i = 0; i < newT1Addresses.length; i++) {
          const id = startID + i;
          const expectedNewAddress = newT1Addresses[i];
          const actualT1Address = await avnBridge.idToT1Address(id);
          const mappedId = await avnBridge.t1AddressToId(expectedNewAddress);

          expect(actualT1Address).to.equal(expectedNewAddress);
          expect(mappedId).to.equal(id);
          expect(actualT1Address).to.not.equal(oldT1Addresses[i]);
        }

        expect(await avnBridge.numActiveAuthors()).to.equal(NUM_AUTHORS - 2);
        expect(await avnBridge.authorIsActive(5)).to.equal(true);
        expect(await avnBridge.authorIsActive(6)).to.equal(false);
        expect(await avnBridge.authorIsActive(7)).to.equal(true);
        expect(await avnBridge.authorIsActive(8)).to.equal(false);
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        const newT1Addresses = Array.from({ length: NUM_AUTHORS }, () => ethers.Wallet.createRandom().address);
        await expect(avnBridge.connect(unauthorizedAccount).rotateT1(newT1Addresses, 1, NUM_AUTHORS)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });

      it('with the wrong number of addresses', async () => {
        const newT1Addresses = Array.from({ length: NUM_AUTHORS }, () => ethers.Wallet.createRandom().address);
        await expect(avnBridge.rotateT1(newT1Addresses, 1, NUM_AUTHORS - 1)).to.be.reverted;
      });
    });
  });
});
