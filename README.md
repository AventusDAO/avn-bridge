# AvN Bridge Overview

The AvN Bridge Ethereum contract (T1) provides a lightweight and gas-efficient means of facilitating the Substrate-based AvN Network sidechain (T2).

The contract utilises OpenZeppelin's implementation of the Universal Upgradeable Proxy Standard ([EIP-1822](https://eips.ethereum.org/EIPS/eip-1822)).

The system is underwritten by [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f).

### Contract Audit

[https://www.quillaudits.com/leaderboard/avnbridge](https://www.quillaudits.com/leaderboard/avnbridge)

### Addresses

#### Mainnet - [0xF05Df39f745A240fb133cC4a11E42467FAB10f1F](https://etherscan.io/address/0xF05Df39f745A240fb133cC4a11E42467FAB10f1F)

#### Testnet - [0x83359eCb73E869174B09221F4460b68FD8B0a42F](https://etherscan.io/address/0x83359eCb73E869174B09221F4460b68FD8B0a42F) 

#### Develop - [0x8017bDbD6Def5f8518Fe44c2D650c21d1C4427A1](https://etherscan.io/address/0x8017bDbD6Def5f8518Fe44c2D650c21d1C4427A1) 

### Key Functions

1. **Author Management**\
The addition and removal of AvN "authors" - nodes which perform T2 block creation and interact with T1 via T2 proof of consensus.

2. **Root publishing**\
The periodic checkpointing on T1 of all transaction calls having occurred on T2, recorded in the form of Merkle roots.

3. **Bridging funds**\
The secure movement of fungible tokens (any ERC20 or ERC777 token, or ETH) between T1 Ethereum and T2 AVN via:
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

## Migrating Claimed Lowers

When upgrading to the **`revertLower`-enabled** bridge, all existing claimed lowers must be migrated from their **hash format** to the new **ID-based format**. The migration process is as follows:

1. Deploy the new implementation contract to be ready to upgrade to (in step 4).

2. **Owner TX 1** - *pause lowering* on the bridge.

3. Generate the migration data by running:

    `npm run get-lowers-sep -- 0xBridgeAddress  [fromBlock]  [v2ThresholdLowerID]` (Sepolia)\
    `npm run get-lowers-main -- 0xBridgeAddress  [fromBlock]  [v2ThresholdLowerID]` (Mainnet)

    **e.g. for Dev bridge (published @ block 6,855,422) with V2 thresh 119:** `npm run get-lowers-sep -- 0x8017bdbd6def5f8518fe44c2d650c21d1c4427a1 6845422 119`

    This scans the specified bridge for `LogLowerClaimed` events, capturing all claimed Lower IDs and generating the `buckets[..]` and `words[..]` arguments required for `setUsedLowers(..)`.

    The claimed lowers are saved to `scripts/claimed_0xbridgeaddress.txt` to be verified (in step 6).

    The unclaimed lowers (from 0 to the `v2ThresholdLowerID`) are saved to `scripts/regenerate_0xbridgeaddress.txt` to be regenerated on T2.

4. **Owner TX 2** - *upgrade* the bridge to the new implementation contract.

5. **Owner TX 3** - call `setUsedLowers(..)`, passing the `buckets[..]` and `words[..]` arguments generated in step 3.

6. Verify the migration by running:

    `npm run verify-lowers-sep -- 0xBridgeAddress` (Sepolia)\
    `npm run verify-lowers-main -- 0xBridgeAddress` (Mainnet)

    This checks all the lower IDs discovered in step 3 are now correctly marked as `used` in the contract.
    
7. **Owner TX 4** - (after successful verification) *unpause lowering* on the bridge.

💡 **Tip**: You can safely re-run the `used-lowers-*` command at any time — it simply overwrites any existing saved file with the latest list of claimed lowers.

### Lower migration testing helper

Spam schedule lower requests:

`npm run create-lowers-dev -- [max lowers (defaults to inf.)]  [batch size (defaults to 1)]`

`npm run create-lowers-testnet -- [max lowers (defaults to inf.)]  [batch size (defaults to 1)]`

### Lower proof regeneration helper
Request lower proof regeneration for all unclaimed lowers:

`npm run regen-lowers-dev`

`npm run regen-lowers-testnet`

`npm run regen-lowers-mainnet`

