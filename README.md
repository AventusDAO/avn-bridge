# AVN Overview

The purpose of the AVN (T1) contract is to provide a lightweight and gas-efficient means of facilitating a Substrate-based fungible-token-scaling sidechain (T2), be that a parachain or a sovereign chain.

The system is underwritten by its constructor-specified core token (in the case of Aventus: [AVT](https://etherscan.io/token/0x0d88ed6e74bbfd96b831231638b66c05571e824f))

##### The AVN T1 has 3 main responsibilities:

1. Management of *validators* (POS transaction processors existing as actors within the AVN whose token deposits are locked in T2).
2. The periodic checkpointing (*publishing*) of merkle tree roots encoding all transactions having occurred on the T2.
3. Securely moving fungible tokens (any token adhering to ERC20 or ERC777 specification) or ETH between Ethereum mainnet and an T2 by a process of:
- *Lifting* (locking tokens received by T1 and recreating the equivalent amount in the specified T2 recipient account)
- *Lowering* (destroying tokens on T2 and unlocking and transferring the equivalent amount in T1 to the specified recipient account)
- *Triggering Growth* (a special form of owner-only lifting which inflates the supply via the T2 reward mechanism)

# Contract Functionality

## Administration functions
##### Only callable by the contract owner

- **loadValidators(address[] calldata t1Address, bytes32[] calldata t1PublicKeyLHS, bytes32[] calldata t1PublicKeyRHS,
      bytes32[] calldata t2PublicKey))**\
Function to initialise a set of validators.

- **setAuthorisationStatus(address contractAddress, bool status)**\
Enable / disable contracts permitted to access this contract's storage or funds. This is to enable future upgrades of the AVN contract.\
-- emits _**LogAuthorisationUpdated(address indexed contractAddress, bool status)**_

- **setQuorum(uint256[2] memory quorum)**\
Sets the ratio of validators required to prove consensus, in relation to the total number of registered validators (ie: the fraction of validators required to provide confirmation for a validator method to succeed).
-- emits _**LogQuorumUpdated(uint256[2] quorum)**_

- **disableValidatorFunctions()**\
Turn validator functionality off to prevent any further validator actions.\
-- emits _**LogValidatorFunctionsAreEnabled(false)**_

- **enableValidatorFunctions()**\
Turn the validator functionality back on.\
-- emits _**LogValidatorFunctionsAreEnabled(true)**_

- **disableLifting()**\
Turn the lifting functionality off to prevent any further lifts.\
-- emits _**LogLiftingIsEnabled(false)**_

- **enableLifting()**\
Turn the lifting functionality back on.\
-- emits _**LogLiftingIsEnabled(true)**_

- **disableLowering()**\
Turn the lowering functionality off to prevent any further lowering.\
-- emits _**LogLoweringIsEnabled(false)**_

- **enableLowering()**\
Turn the lowering functionality back on.\
-- emits _**LogLoweringIsEnabled(true)**_

- **updateLowerCall(bytes2 callId, uint256 numBytes)**\
Update or add the call index of any lower function, along with the distance (in bytes) required to reach the lower arguments.\
-- emits _**LogLowerCallUpdated(bytes2 callId, uint256 numBytes)**_

- **recoverERC777Tokens(address erc777Address)**\
Transfer total balance of the specified token from a prior version of the contract when upgrading.

- **recoverERC20Tokens(address erc20Address)**\
Transfer total balance of the specified token from a prior version of the contract when upgrading.

- **recoverETH()**\
Transfer total ETH balance from a prior version of the contract when upgrading.

- **triggerGrowth(uint256 amount)**\
Inflate the supply by the amount specified (amount must be ERC20-approved first).
-- emits _**LogGrowth(uint256 amount, uint32 period)**_

- **setOwner()**\
Changes the owner.\
-- emits _**LogOwnershipTransferred(address indexed owner, address indexed newOwner)**_


## Validator Functions
##### Only callable by an active validator providing proof (the required number of confirmations) of validator consensus from the T2

- **registerValidator(bytes memory t1PublicKey, bytes32 t2PublicKey, uint256 t2TransactionId, bytes calldata confirmations)**\
Registers a new validator account, permanently associating their T1 Ethereum address with their T2 public key and enabling them to participate in consensus.\
Does not immediately activate, this step instead occurs automatically upon the next confirmation received from the newly registered validator.\
May also be used to re-register a previously deregistered validator.\
-- emits _**LogValidatorRegistered(bytes32 indexed t1PublicKeyLHS, bytes32 t1PublicKeyRHS, bytes32 indexed t2PublicKey, uint256 indexed t2TransactionId)**_

- **deregisterValidator(bytes memory t1PublicKey, bytes32 t2PublicKey, uint256 t2TransactionId, bytes calldata confirmations)**\
Deregisters and deactivates a validator, retaining their original registration details but immediately removing their ability to call validator functions or participate in consensus.\
-- emits _**LogValidatorDeregistered(bytes32 indexed t1PublicKeyLHS, bytes32 t1PublicKeyRHS, bytes32 indexed t2PublicKey, uint256 indexed t2TransactionId)**_

- **publishRoot(bytes32 rootHash, uint256 t2TransactionId, bytes calldata confirmations)**\
Add a merkle tree root representing the latest set of transactions to have occurred on the T2.\
-- emits _**LogRootPublished(bytes32 indexed rootHash, uint256 indexed t2TransactionId)**_

## Authorised Functions
##### Only callable by an authorised partner contract (such as a future upgrade contract referencing this contract as storage)

- **storeT2TransactionId(uint256 t2TransactionId)**\
Add a new T2 transaction ID to storage. Fails if already exists.

- **storeRootHash(bytes32 rootHash)**\
Add a new merkle root to storage. Fails if already exists.

- **storeLiftProofHash(bytes32 proofHash)**\
Add a new proof of a proxy lift to storage. Fails if already used.

- **storeLoweredLeafHash(bytes32 leafHash)**\
Add a new merkle root to storage. Fails if already exists.

- **unlockETH(address payable recipient, uint256 amount)**\
Transfer the specified amount of ETH from this contract to the recipient.

- **unlockERC777Tokens(address erc777Address, address recipient, uint256 amount)**\
Send the specified amount of ERC-777 tokens from this contract to the recipient.

- **unlockERC20Tokens(address erc20Address, address recipient, uint256 amount)**\
Transfer the specified amount of ERC-20 tokens from this contract to the recipient.

## Publicly Accessible Functions

- **getAuthorisedContracts()**\
Free-to-call method returns the array of contracts currently authorised to access this contract's funds or set its storage.

- **function getIsPublishedRootHash(bytes32 rootHash) external view returns (bool)**\
Easy means for any future upgrade contracts to view published roots.

- **lift(address erc20Address, bytes calldata t2PublicKey, uint256 amount)**\
Allows the caller to move an amount of their ERC-20 tokens to the specified T2 account, providing they have previously approved this contract for the amount.\
For lifting ERC-777 see [below](#lifting_erc_777_tokens)\
-- emits _**LogLifted(address indexed token, address indexed t1Address, bytes32 indexed t2PublicKey, uint256 amount)**_

- **proxyLift(address erc20Address, bytes calldata t2PublicKey, uint256 amount, address approver, uint256 proofNonce, bytes calldata proof)**\
Allows the caller to move an amount of another party's ERC-20 tokens to the specified T2 account, providing the other party has previously set approval for this contract which covers the amount.\
-- emits _**LogLifted(address indexed token, address indexed t1Address, bytes32 indexed t2PublicKey, uint256 amount)**_

- **liftETH(bytes calldata t2PublicKey)**\
Payable function which allows the caller to move all ETH sent to the specified T2 account.\
-- emits _**LogLifted(address indexed token, address indexed t1Address, bytes32 indexed t2PublicKey, uint256 amount)**_

- **lower(bytes memory leaf, bytes32[] calldata merklePath)**\
Calling with a valid, unused lower leaf results in the amount of the token (ERC-20/ERC-777/ETH) specified in the leaf being transferred to the recipient Ethereum address also specified in the leaf.\
-- emits _**LogLowered(address indexed token, address indexed t1Address, bytes32 indexed t2PublicKey, uint256 amount)**_

- **confirmAvnTransaction(bytes32 leafHash, bytes32[] memory merklePath)**\
Free-to-call method allows a user to confirm whether a transaction leaf is included in any published merkle root.

## Lifting ERC 777 Tokens
ERC-777 tokens do not require approval and can be sent directly to the contract (using `send` or `operatorSend`) to be automatically lifted to the 32 byte T2 public key specified in the send transaction's `data` field (this value must be present).\
e.g: `send(to: AVN_address, amount: amount_to_lift, data: 32_byte_T2_recipient_public_key)`\
-- emits _**LogLifted(address indexed token, address indexed t1Address, bytes32 indexed t2PublicKey, uint256 amount)**_


# avn-tier1 usage
do `npm install`

Edit 'config_.json' and save as 'config.json'

To run local tests:
do `run test` or `sh run.sh test`

To deploy to local network:
do `run deploy-dev` or `sh run.sh deploy-dev`

To deploy to goerli test network:
do `run deploy-goerli` or `sh run.sh deploy-goerli`

To run coverage:
do `run coverage` or `sh run.sh coverage`
