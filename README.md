# AVN Bridge Overview

The purpose of the AVN Bridge (T1) contract is to provide a lightweight and gas-efficient means of facilitating a Substrate-based fungible-token-scaling sidechain (T2), be that a parachain or a sovereign chain.

The contract utilises OpenZeppelin's implementation of the Universal Upgradeable Proxy Standard ([EIP-1822](https://eips.ethereum.org/EIPS/eip-1822)).

The system is underwritten by its constructor-specified core token (in the case of Aventus: [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f))

#### The AVN Bridge has 4 main responsibilities:

1. Management of *Authors* - AvN nodes responsible for block creation on T2 and the publishing of their proofs to T1.

2. The periodic checkpointing (*publishing*) by authors of Merkle roots encoding all transactions that have occurred on T2.

3. Securely moving fungible tokens (any token adhering to ERC20 or ERC777 specification) or ETH between T1 Ethereum and the T2 AVN sidechain by the following processes:
- *Lifting* - locking tokens received by T1 and recreating the equivalent amount in the specified T2 recipient account
- *Lowering* - destroying tokens on T2 and unlocking and transferring the equivalent amount to the specified T1 recipient account

4. *Triggering Growth* - a special form of lifting which inflates the core token supply according to the reward mechanisms of T2.

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
The following manual steps are then required to interact with the AVN contract on Etherscan:
- Visit the Etherscan page for the ERC1967Proxy address from the deployment
- Under More Options select "Is this a proxy?"
- Click Verify and Save
- Return to the ERC1967Proxy page's Contract tab
- Now you will be able to "Read as Proxy" or "Write as Proxy" to interact with the AVN contract

### Mainnet Address

0xF05Df39f745A240fb133cC4a11E42467FAB10f1F