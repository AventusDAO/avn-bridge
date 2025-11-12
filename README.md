# AVN Bridge Overview

The purpose of the AVN Bridge (T1) contract is to provide a lightweight and gas-efficient means of facilitating a Substrate-based sidechain (T2), be that a parachain or a sovereign chain.

The contract utilises OpenZeppelin's implementation of the Universal Upgradeable Proxy Standard ([EIP-1822](https://eips.ethereum.org/EIPS/eip-1822)).

The system is underwritten by its core token (in the case of Aventus: [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f)).

### Mainnet Address

[0xF05Df39f745A240fb133cC4a11E42467FAB10f1F](https://etherscan.io/address/0xF05Df39f745A240fb133cC4a11E42467FAB10f1F) 

### Key Functions

1. **Author Management**\
The addition and removal of AvN "authors" - nodes which perform block creation on T2 and can interact with T1 on behalf of T2 via proof of consensus.

2. **Root publishing**\
The periodic checkpointing on T1 of all transaction calls having occurred on T2, recorded in the form of Merkle Roots by T2.

3. **Bridging funds**\
The secure movement of fungible tokens (any ERC20 or ERC777 token, or ETH) between T1 Ethereum and T2 AVN via:
   - **Lifting** - Locking tokens sent to the T1 contract and authorising the generation of an identical amount in the designated recipient's account on T2.
   - **Lowering** - Unlocking tokens from the contract and transferring them to the specified T1 recipient, based on having received proof of their destruction on T2.

## Development

### Setup

- do `npm i`
- populate a `.env` file with the variables required by hardhat.config
- ensure `authors.json` includes the correct set of authors for your environment

### Testing

#### Run tests
`npm run test`

#### Run coverage
`npm run coverage`

#### Format the code
`npm run format`

#### Check bytecode size
`npm run size`

### Deployment

#### Deploy initial proxy
`npx hardhat --network <network> deploy --env <"dev" || "testnet" || "paseo" || "mainnet">`

#### Prepare OZ manifest
`npx hardhat --network <network> prepare <bridge address>`

#### Validate new implementation
`npx hardhat --network <network> validate <bridge address>`

#### Deploy new implementation
`npx hardhat --network <network> implementation`

#### Publish a test token
`npx hardhat --network <network> publishToken`

#### Lift funds
`npx hardhat --network <network> lift --recipient <recipient T2 public key> --bridge <bridge address> --amount <amount> token <token address>`

### Migrating Claimed Lowers

To upgrade to the `revertLower`-enabled bridge, all existing claimed lowers must be migrated from their **hash format** to the new **ID-based format**. The process is as follows:

1. Deploy the new implementation contract.
2. **Owner TX 1** - *pause lowering* on the bridge.
3. Run:\
    `npm run used-lowers-sep -- 0xBridge... [from block]` (Sepolia)\
    `npm run used-lowers-main -- 0xBridge... [from block]` (Mainnet)

    This scans for `LogLowerClaimed` events, capturing all claimed Lower IDs and generating the buckets[] and words[] arrays required for setUsedLowers(...). The lower IDs are also saved to a `scripts/<0xBridge...` file for later verification.
4. **Owner TX 2** - *upgrade* the bridge to the new implementation contract.
5. **Owner TX 3** - call `setClaimedLowers`, passing the `buckets` and `words` arrays generated in step 3.
6. Run:\
    `npm run verify-lowers-sep -- 0xBridge...` (Sepolia)\
    `npm run verify-lowers-main -- 0xBridge...` (Mainnet)

    This checks that all lower IDs saved to the file are now correctly marked as `used` in the contract.
7. **Owner TX 4** - (after successful verification) *unpause lowering* on the bridge.

💡 **Tip**: You can safely re-run the `used-lowers-*` at any time — it overwrites the saved file with the latest list of lowers.