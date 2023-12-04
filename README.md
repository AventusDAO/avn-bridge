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
`npx hardhat --network <network> deploy --token [optional core token address] --authors <path to authors json file>`

#### Upgrade an existing avn-bridge contract
`npx hardhat --network <network> upgrade --proxy <proxy contract address>`

#### Publish a new test token
`npx hardhat --network <network> publishToken`

#### Forcing an upgrade (testnet only)
If the upgrade command fails with: `Error: Deployment at address 0x... is not registered... use the forceImport function` it means your goerli manifest is incorrectly configured. Resolving this requires temporarily swapping out the contracts in order to prepare the correct manifest, before re-attempting the upgrade. Follow these steps:

- Delete the `.openzeppelin/goerli.json` manifest, along with the entire `artifacts` and `cache` folders.
- Retrieve the avn-bridge contract address from the chain and view the contract on Goerli Etherscan.
- Click the `Read as Proxy` tab
- Click on the `Implementation contract` link
- From its `Code` tab copy both the `AVNBridge.sol` code (at the top of the list of files) and the `IAVNBridge.sol` code (at the bottom) over their respective versions in your local `contracts` directory.
- Note: If the pragma version at the top of the contracts has changed since (eg: from "`pragma solidity 0.8.23`" to "`pragma solidity 0.8.17`") then the `solidity.compilers.version` value in `hardhat.config.js`'s `module exports` will also require updating to match.
- Now prepare the new `openzeppelin/goerli.json` manifest by running: `npx hardhat --network goerli prepare-upgrade --proxy <proxy contract address>`
- You may now revert `AVNBridge.sol` and `IAVNBridge.sol`back to the versions you were originally attempting to upgrade to and run the standard upgrade command again (remembering to reset the solidity compiler version too, if required).
- **One final note**: dependent upon network conditions, the upgraded contract may not get published and Etherscan will not yet be displaying its updated Read/Write Proxy interface. To correct this, click through the prompts on Etherscan to publish and save the new contract implementation.

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