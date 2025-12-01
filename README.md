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

#### Prepare (update) the OZ manifest
`npx hardhat --network <network> prepare <bridge address>`

#### Validate a new implementation
`npx hardhat --network <network> validate <bridge address>`

#### Deploy a new implementation
`npx hardhat --network <network> implementation`

#### Publish a test token
`npx hardhat --network <network> publishToken`

#### Lift funds
`npx hardhat --network <network> lift --recipient <recipient T2 public key> --bridge <bridge address> --amount <amount> token <token address>`

## Migrating Claimed Lowers (T2 v8.3.0 upgrade)

Introducing `revertLower` on T1 requires all existing claimed lowers to be migrated from their **hash format** to a new **ID-based format**. The migration process is as follows:

1. Pre-deploy the new bridge implementation so it is ready for upgrade later.

2. Run get-lowers (pass 1):

    `npm run get-lowers-sep -- [chain]`

    This produces a `data/[chain].json` file containing:

    - all claimed lower IDs detected in the contract
    - buckets[] + words[] for `migrate`
    - unclaimed lowers that will require proof regeneration
    - T1 tx hashes of claimed lowers still present on T2

3. Pass the T1 tx hashes output in step 2 with the sudo utilities → additional events tool on T2 to remove stale claimed-lower proofs from tokenManager.

4. **Owner TX 1** - *pause lowering* on the bridge.

5. Ensure T2 is idle by confirming:

    - no pending items in ethBridge.requestQueue
    - no active lowers in T2

6. Perform the T2 forkless upgrade. This will pause T2 -> T1 communication until step 11.

7. Run get-lowers again (pass 2):

    `npm run get-lowers -- <chain>`

    This produces the final migration data for steps 9, 10, and 12.

8. **Owner TX 2** - *upgrade* the bridge to the new implementation contract deployed in step 1.

9. **Owner TX 3** - call `migrate(..)`, passing the `buckets[..]` and `words[..]` arguments generated in step 7 to mark all existing claimed lowers as `used`.

10. Verify step 9:

    `npm run verify-lowers -- <chain>`

11. Request lower proof regeneration on T2 for all remaining unclaimed lowers:

    `npm run regen-lowers -- <chain>`
    
8. **Owner TX 4** - *unpause lowering* on the bridge. Normal operation resumes.


### Lower migration testing helpers

To spam schedule lower requests:

`npm run create-lowers -- <chain> <T1 recipient address> [max lowers (defaults to infinity)]  [batch size (defaults to 1)]`

To claim lowers:

`npm run claim-lowers -- <chain> <start ID> <end ID>`