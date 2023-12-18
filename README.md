# AVN Bridge Overview

The purpose of the AVN Bridge (T1) contract is to provide a lightweight and gas-efficient means of facilitating a Substrate-based sidechain (T2), be that a parachain or a sovereign chain.

The contract utilises OpenZeppelin's implementation of the Universal Upgradeable Proxy Standard ([EIP-1822](https://eips.ethereum.org/EIPS/eip-1822)).

The system is underwritten by its core token (in the case of Aventus: [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f))

### Key Functions

1. **Author Management**\
The addition and removal of AvN "authors" - nodes which perform block creation on T2 and can interact with T1 on behalf of T2 via proof of consensus.

2. **Root publishing**\
The periodic checkpointing on T1 of all transaction calls having occurred on T2, recorded in the form of Merkle Roots by T2.

3. **Bridging funds**\
The secure movement of fungible tokens (any ERC20 or ERC777 compliant token, or ETH) between T1 Ethereum and T2 AVN via:
   - **Lifting** - Locking tokens sent to the T1 contract and authorising the generation of an identical amount in the designated recipient's account on T2.
   - **Lowering** - Unlocking tokens from the contract and transferring them to the specified T1 recipient, based on having received proof of their destruction on T2.

4. **Triggering Growth**\
Inflating the core token's total supply according to the T2 staking and reward cycle data provided to T1 by T2.

## Development

### Setup
do `npm i`\
fill in "config_.json" and save locally as "config.json"
The values in config.json can also be set as environment variables.

#### Run tests
`npx hardhat test`

#### Run coverage report
`npx hardhat coverage`

#### Check bytecode size
`npx hardhat size-contracts`

#### Deploy
`npx hardhat --network <network> deploy --token [core token address] --authors [authors json file]`

#### Upgrade an existing avn-bridge contract
`npx hardhat --network <network> upgrade --bridge <contract address>`

#### Publish a new test token
`npx hardhat --network <network> publishToken`

#### Format the code (JS files only)
`npm run format`

### Interaction via Etherscan

The deployment will automatically publish and verify the contracts.\
\
The following manual steps may then be required to interact with the AVN contract on Etherscan:
- Visit the Etherscan page for the ERC1967Proxy address from the deployment
- Under More Options select "Is this a proxy?"
- Click Verify and Save
- Return to the ERC1967Proxy page's Contract tab
- Now you will be able to "Read as Proxy" or "Write as Proxy" to interact with the AVN contract

### Mainnet Address

0xF05Df39f745A240fb133cC4a11E42467FAB10f1F