// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

interface IAVNBridge {
  event LogGrowthDenied(uint32 period);
  event LogGrowthDelayUpdated(uint256 oldDelaySeconds, uint256 newDelaySeconds);
  event LogAuthorsEnabled(bool state);
  event LogLiftingIsEnabled(bool state);
  event LogLoweringIsEnabled(bool state);
  event LogLowerCallUpdated(bytes2 callId, uint256 numBytes);

  event LogAuthorAdded(address indexed t1Address, bytes32 indexed t2PublicKey, uint32 indexed t2TransactionId);
  event LogAuthorRemoved(address indexed t1Address, bytes32 indexed t2PublicKey, uint32 indexed t2TransactionId);
  event LogRootPublished(bytes32 indexed rootHash, uint32 indexed t2TransactionId);

  event LogLifted(address indexed token, bytes32 indexed t2PublicKey, uint256 amount);
  event LogLoweredFrom(bytes32 indexed t2PublicKey);
  event LogGrowthTriggered(uint256 amount, uint32 indexed period, uint256 indexed releaseTime, uint32 indexed t2TransactionId);
  event LogGrowth(uint256 indexed amount, uint32 indexed period);

  // Owner only
  function loadAuthors(address[] calldata t1Address, bytes32[] calldata t1PublicKeyLHS, bytes32[] calldata t1PublicKeyRHS,
      bytes32[] calldata t2PublicKey) external;
  function setCoreOwner() external;
  function denyGrowth(uint32 period) external;
  function setGrowthDelay(uint256 delaySeconds) external;
  function toggleAuthors(bool state) external;
  function toggleLifting(bool state) external;
  function toggleLowering(bool state) external;
  function updateLowerCall(bytes2 callId, uint256 numBytes) external;

  // Owner or authors only
  function triggerGrowth(uint128 amount, uint32 period, uint256 expiry, uint32 t2TransactionId, bytes calldata confirmations)
      external;

  // Authors only
  function addAuthor(bytes calldata t1PublicKey, bytes32 t2PublicKey, uint256 expiry, uint32 t2TransactionId,
      bytes calldata confirmations) external;
  function removeAuthor(bytes calldata t1PublicKey, bytes32 t2PublicKey, uint256 expiry, uint32 t2TransactionId,
      bytes calldata confirmations) external;
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TransactionId, bytes calldata confirmations) external;

  // Public
  function releaseGrowth(uint32 period) external;
  function lift(address erc20Address, bytes calldata t2PublicKey, uint256 amount) external;
  function liftETH(bytes calldata t2PublicKey) external payable;
  function lower(bytes calldata leaf, bytes32[] calldata merklePath) external;
  function confirmAvnTransaction(bytes32 leafHash, bytes32[] calldata merklePath) external view returns (bool);
}
