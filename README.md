# AVN Bridge Overview

The purpose of the AVN Bridge (T1) contract is to provide a lightweight and gas-efficient means of facilitating a Substrate-based fungible-token-scaling sidechain (T2), be that a parachain or a sovereign chain.

The contract utilises OpenZeppelin's implementation of the Universal Upgradeable Proxy Standard ([EIP-1822](https://eips.ethereum.org/EIPS/eip-1822)).

The system is underwritten by its constructor-specified core token (in the case of Aventus: [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f))

#### The AVN Bridge has 4 main responsibilities:

1. Management of *validators* - POS transaction processors existing as actors within the AVN whose token deposits are locked in T2.

2. The periodic checkpointing (*publishing*) of Merkle tree roots encoding all transactions that have occurred on T2.

3. Securely moving fungible tokens (any token adhering to ERC20 or ERC777 specification) or ETH between T1 Ethereum mainnet and the T2 AVN sidechain by the following processes:
- *Lifting* - locking tokens received by T1 and recreating the equivalent amount in the specified T2 recipient account
- *Lowering* - destroying tokens on T2 and unlocking and transferring the equivalent amount to the specified T1 recipient account

4. *Triggering Growth* - a special form of lifting which inflates the core token supply according to the reward mechanisms of T2.

## Development

### Setup
do `npm i`\
fill in "__config.json" and save locally as "config.json"

#### Run tests
`npx hardhat test`

#### Run coverage report
`npx hardhat coverage`

#### Deploy to Goerli
`npx hardhat run scripts/deploy.js --network goerli`

#### Load a set of validators
`npx hardhat --network goerli loadValidators --file <validators json file path> --address <target contract address> `

#### Deploy to Mainnet
`npx hardhat run scripts/deploy.js --network mainnet`


### Interaction via Etherscan

The deployment will automatically publish and verify the contracts.\
\
The following manual steps are then required to interact with the AVN contract on Etherscan:
- Visit the Etherscan page for the ERC1967Proxy address from the deployment
- Under More Options select "Is this a proxy?"
- Click Verify and Save
- Return to the ERC1967Proxy page's Contract tab
- Now you will be able to "Read as Proxy" or "Write as Proxy" to interact with the AVN contract

### Mainnet Addresses

AVNBridge Persistent Proxy: 0xF05Df39f745A240fb133cC4a11E42467FAB10f1F
AVNBridge Version 1 Implementation Address: 0xd0800E6cb9Fe4327BF6e791398f68ab1d76E59a1
Unlocker: 0x9FC92E791FD6315ab267eC0990D701d81a068c76

#### loadValidators
Tool to initialise an AVN Bridge contract with existing validators.

Accepts json files of the validator keys format.

To run pass 3 arguments: <chain> <avn bridge contract address> <key file path>

e.g.: `node tools/loadValidators.js goerli 0x4C6d630Da5DB0Ba48AF8a9a5875d0d5d88E4Bfe3 "./validators.json"`