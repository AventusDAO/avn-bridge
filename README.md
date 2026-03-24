# AvN Bridge Overview

The AvN Bridge Ethereum contract (T1) provides a lightweight and gas-efficient means of facilitating the Substrate-based AvN Network sidechain (T2).

The contract utilises OpenZeppelin's implementation of the Universal Upgradeable Proxy Standard ([EIP-1822](https://eips.ethereum.org/EIPS/eip-1822)).

The system is underwritten by [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f).

### Contract Audit

[https://www.quillaudits.com/leaderboard/avnbridge](https://www.quillaudits.com/leaderboard/avnbridge)

### Addresses

#### Mainnet - [0xF05Df39f745A240fb133cC4a11E42467FAB10f1F](https://etherscan.io/address/0xF05Df39f745A240fb133cC4a11E42467FAB10f1F)

#### Testnet - [0x83359eCb73E869174B09221F4460b68FD8B0a42F](https://sepolia.etherscan.io/address/0x83359eCb73E869174B09221F4460b68FD8B0a42F) 

#### Develop - [0x2024d885cfa839296c68dc2d6bba7c258f05cfb5](https://sepolia.etherscan.io/address/0x2024d885cfa839296c68dc2d6bba7c258f05cfb5) 

### Key Functions

1. **Author Management**\
The addition and removal of AvN "authors" - nodes which perform T2 block creation and interact with T1 via T2 proof of consensus.

2. **Root publishing**\
The periodic checkpointing on T1 of all transaction calls having occurred on T2, recorded in the form of Merkle roots.

3. **Bridging funds**\
The secure movement of ERC20 or ERC777 tokens between T1 Ethereum and T2 AVN via:
   - **Lifting** - Locking tokens sent to the T1 contract and authorising the generation of an identical amount in the designated recipient's account on T2.
   - **Lowering** - Unlocking tokens from the contract and transferring them to the specified T1 recipient, based on having received proof of their destruction on T2.

## Development

### Setup

- do `npm i`
- populate a `.env` file with the variables required by `hardhat.config`
- ensure `authors.json` includes the correct set of authors for your environment

### Testing

#### Run tests
`npm run test`

#### Generate test coverage report
`npm run coverage`

#### Format the code
`npm run format`

#### Check contract bytecode size
`npm run size`

### Deployment

#### Deploy the initial proxy contract
`npx hardhat --network <network> deploy <"dev" || "testnet" || "paseo" || "mainnet">`

#### Deploy the AVT authority contract
`npx hardhat --network <network> authority <"dev" || "testnet" || "paseo" || "mainnet">`

#### Prepare (update) the OZ manifest
`npx hardhat --network <network> prepare <bridge address> <"dev" || "testnet" || "paseo" || "mainnet">`

#### Validate a new implementation
`npx hardhat --network <network> validate <bridge address> <"dev" || "testnet" || "paseo" || "mainnet">`

#### Deploy a new implementation
`npx hardhat --network <network> implementation <"dev" || "testnet" || "paseo" || "mainnet">`

#### Publish a test token
`npx hardhat --network <network> publishToken`

#### Lift funds
`npx hardhat --network <network> lift --recipient <recipient T2 public key> --bridge <bridge address> --amount <amount> token <token address>`


## Migrating Claimed Lowers (T2 v8.4.0 upgrade)

Introducing `revertLower` on T1 requires all existing claimed lowers to be migrated from their **hash format** to a new **ID-based format**. The migration process is as follows:

0. The config for each chain environment (eg.: `dev`, `mainnet`, `testnet`, etc) sits at the top of the `scripts/revert-lower-upgrade/common.js` file. Ensure the relevant environment variables are populated as required.

1. Ensure the contract contains the `migrate` function (this function is removed after the migration is complete - see steps 14 & 15):

```
  function migrate(uint256[] calldata buckets, uint256[] calldata words) external onlyOwner {
    if (buckets.length != words.length) revert();

    for (uint256 i; i < buckets.length; ) {
      usedLowers[buckets[i]] = words[i];
      unchecked {
        ++i;
      }
    }
  }
```

2. Pre-deploy the new bridge implementation so it is ready to upgrade to in step 9.

3. Run get-lowers (pass #1):

    `npm run get-lowers <chain>`

    This produces a `scripts/revert-lower-upgrade/data/[chain].json` file containing:

    - `migrateArgs` - the `buckets[]` and `words[]` arguments for the `migrate` function
    - `claimed` - all claimed lower IDs detected in the contract
    - `toRemoveFromT2` - Lower IDs and T1 tx hashes of claimed lowers that haven't been cleared from T2
    - `toRegenerateOnT2` - unclaimed lowers that will require proof regeneration

4. If there are any entries in `toRemoveFromT2` produced in step 3 then pass the T1 tx hashes into Polkadot.js UI -> Developer tab -> `Extrinsics` -> `sudo` -> `sudo(call)` -> `ethBridge` -> `setAdminSetting` -> `QueueAdditionalEthereumEvent`. This will remove them from `TokenManager.lowersReadyToClaim`.

5. **Owner TX 1** - *pause lowering* on the bridge.

6. Ensure T2 is idle by confirming:

    - no pending lowers in `ethBridge.requestQueue`
    - no active lowers in `ethBridge.activeRequest`

7. Perform the T2 forkless upgrade.

8. Run get-lowers again (pass #2):

    `npm run get-lowers <chain>`

    This produces all the final migration data required for steps 10, 11, and 12.

9. **Owner TX 2** - *upgrade* the bridge to the new implementation contract deployed in step 2.

10. **Owner TX 3** - call `migrate(..)` on the bridge, passing the `buckets[..]` and `words[..]` arguments generated in step 8. This will mark all existing claimed lowers as `used`.

11. Verify step 10 on-chain:

    `npm run verify-lowers <chain>`

12. Request lower proof regeneration on T2 for all the remaining unclaimed lowers:

    `npm run regen-lowers <chain>`
    
13. **Owner TX 4** - *unpause lowering* on the bridge. Normal operation resumes.

14. Deploy a new implementation with the `migrate` function removed.

15. **Owner TX 5** - *upgrade* the bridge to the new implementation contract deployed in step 14.


### Lower migration testing helpers

To spam schedule lower requests:

`npm run create-lowers <chain> <T1 recipient address> [batch size (defaults to 1)] [max lowers (defaults to infinity)]`

To claim multiple lowers:

`npm run claim-lowers <chain> <start ID> <end ID>`