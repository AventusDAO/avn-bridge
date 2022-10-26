// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAVN {
  event LogAuthorisationUpdated(address indexed contractAddress, bool status);
  event LogQuorumUpdated(uint256[2] quorum);
  event LogValidatorFunctionsAreEnabled(bool status);
  event LogLiftingIsEnabled(bool status);
  event LogLoweringIsEnabled(bool status);
  event LogLowerCallUpdated(bytes2 callId, uint256 numBytes);

  event LogValidatorRegistered(bytes32 indexed t1PublicKeyLHS, bytes32 t1PublicKeyRHS, bytes32 indexed t2PublicKey,
      uint256 indexed t2TransactionId);
  event LogValidatorDeregistered(bytes32 indexed t1PublicKeyLHS, bytes32 t1PublicKeyRHS, bytes32 indexed t2PublicKey,
      uint256 indexed t2TransactionId);
  event LogRootPublished(bytes32 indexed rootHash, uint256 indexed t2TransactionId);

  event LogLifted(address indexed token, address indexed t1Address, bytes32 indexed t2PublicKey, uint256 amount);
  event LogLowered(address indexed token, address indexed t1Address, bytes32 indexed t2PublicKey, uint256 amount);

  // Owner only
  function transferValidators() external;
  function setAuthorisationStatus(address contractAddress, bool status) external;
  function setQuorum(uint256[2] memory quorum) external;
  function disableValidatorFunctions() external;
  function enableValidatorFunctions() external;
  function disableLifting() external;
  function enableLifting() external;
  function disableLowering() external;
  function enableLowering() external;
  function updateLowerCall(bytes2 callId, uint256 numBytes) external;
  function recoverERC777TokensFromLegacyTreasury(address erc777Address) external;
  function recoverERC20TokensFromLegacyTreasury(address erc20Address) external;
  function liftLegacyStakes(bytes calldata t2PublicKey, uint256 amount) external;

  // Validator only
  function registerValidator(bytes memory t1PublicKey, bytes32 t2PublicKey, uint256 t2TransactionId,
      bytes calldata confirmations) external;
  function deregisterValidator(bytes memory t1PublicKey, bytes32 t2PublicKey, uint256 t2TransactionId,
      bytes calldata confirmations) external;
  function publishRoot(bytes32 rootHash, uint256 t2TransactionId, bytes calldata confirmations) external;

  // Authorised contract only
  function storeT2TransactionId(uint256 t2TransactionId) external;
  function storeRootHash(bytes32 rootHash) external;
  function storeLiftProofHash(bytes32 proofHash) external;
  function storeLoweredLeafHash(bytes32 leafHash) external;
  function unlockETH(address payable recipient, uint256 amount) external;
  function unlockERC777Tokens(address erc777Address, address recipient, uint256 amount) external;
  function unlockERC20Tokens(address erc20Address, address recipient, uint256 amount) external;

  // Public
  function getAuthorisedContracts() external view returns (address[] memory);
  function getIsPublishedRootHash(bytes32 rootHash) external view returns (bool);
  function lift(address erc20Address, bytes calldata t2PublicKey, uint256 amount) external;
  function proxyLift(address erc20Address, bytes calldata t2PublicKey, uint256 amount, address approver, uint256 proofNonce,
      bytes calldata proof) external;
  function liftETH(bytes calldata t2PublicKey) external payable;
  function lower(bytes memory leaf, bytes32[] calldata merklePath) external;
  function confirmAvnTransaction(bytes32 leafHash, bytes32[] memory merklePath) external view returns (bool);
}
