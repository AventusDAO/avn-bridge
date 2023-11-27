// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface IAVNBridge {
  event LogGrowthDenied(uint32 period);
  event LogGrowthDelayUpdated(uint256 oldDelaySeconds, uint256 newDelaySeconds);
  event LogAuthorsEnabled(bool state);
  event LogLiftingEnabled(bool state);
  event LogLoweringEnabled(bool state);
  event LogLowerCallUpdated(bytes2 callId, uint256 numBytes);
  event LogMarkSpent();

  event LogAuthorAdded(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogAuthorRemoved(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogRootPublished(bytes32 indexed rootHash, uint32 indexed t2TxId);
  event LogGrowthTriggered(uint256 amount, uint32 indexed period, uint32 indexed t2TxId);

  event LogLifted(address indexed token, bytes32 indexed t2PubKey, uint256 amount);
  event LogLoweredFrom(bytes32 indexed t2PubKey);
  event LogGrowth(uint256 indexed amount, uint32 indexed period);

  // Owner only
  function loadAuthors(address[] calldata t1Address, bytes32[] calldata t1PubKeyLHS, bytes32[] calldata t1PubKeyRHS, bytes32[] calldata t2PubKey) external;
  function setCoreOwner() external;
  function denyGrowth(uint32 period) external;
  function setGrowthDelay(uint256 delaySeconds) external;
  function toggleAuthors(bool state) external;
  function toggleLifting(bool state) external;
  function toggleLowering(bool state) external;
  function updateLowerCall(bytes2 callId, uint256 numBytes) external;
  function markSpent(bytes32[] calldata hashes) external;

  // Authors only
  function addAuthor(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function removeAuthor(bytes32 t2PubKey, bytes calldata t1PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function triggerGrowth(uint128 rewards, uint128 avgStaked, uint32 period, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;

  // Public
  function releaseGrowth(uint32 period) external;
  function lift(address erc20Address, bytes calldata t2PubKey, uint256 amount) external;
  function liftETH(bytes calldata t2PubKey) external payable;
  function lower(bytes calldata leaf, bytes32[] calldata merklePath) external;
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath) external view returns (bool);
  function corroborate(uint32 t2TxId, uint256 expiry) external view returns (int8);
}
