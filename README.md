# AvN Bridge Overview

The AvN Bridge Ethereum contract (T1) provides a lightweight and gas-efficient means of facilitating the Substrate-based AvN Network sidechain (T2).

The contract utilises OpenZeppelin's implementation of the Universal Upgradeable Proxy Standard ([EIP-1822](https://eips.ethereum.org/EIPS/eip-1822)).

The system is underwritten by [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f).

The burning and minting abilities of the bridge are governed by the [AVT Authority contract](https://etherscan.io/address/0xcbe8dd2824cb2c4c400b3661b901deb3425f1118#code)

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
   - **Lowering** - Unlocking tokens from the contract and transferring them to the specified T1 recipient, based on having received proof of their destruction on T2. If a lower lock period is set, claimed funds are held for that period before release (see [Locked lowers](#locked-lowers)).

### Locked lowers

When the owner sets a lower lock period (`setLowerLockPeriod`, up to 30 days), lowers are paid out in two steps:

1. `claimLower(proof)` verifies the proof and locks the lower, storing its details and emitting `LogLowerLocked`. No funds move.
2. Once the lock period has passed, anyone can call `releaseLower(lowerId)` to send the funds to the recipient. This emits `LogLowerClaimed`.

With a lock period of zero, `claimLower` pays out immediately as before. Changing the period only affects lowers claimed afterwards. `lowerState(lowerId)` and `checkLower(proof)` report where a lower is in this lifecycle.

While a lower is locked, its recipient can still revert it with `revertLower`, returning the funds to the T2 sender.

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

