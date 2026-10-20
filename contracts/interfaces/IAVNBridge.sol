// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

interface IAVNBridge {
  enum LowerState {
    None, // not yet claimed, reverted or cancelled
    Locked, // claimed and awaiting release
    Frozen, // claimed and held by the owner
    Used // released, reverted or cancelled
  }

  event LogAuthorsEnabled(bool enabled);
  event LogLiftingEnabled(bool enabled);
  event LogLoweringEnabled(bool enabled);
  event LogReplenishAllowanceSet(uint256 amount);
  event LogLowerLockPeriodSet(uint256 period);
  event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

  event LogAuthorAdded(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogAuthorManuallyActivated(address indexed t1Address);
  event LogAuthorRemoved(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogFeesBurned(uint256 indexed amount, uint256 indexed newSupply, uint32 indexed t2TxId);
  event LogRewardsMinted(uint256 indexed amount, uint256 indexed newSupply, uint32 indexed t2TxId);
  event LogRootPublished(bytes32 indexed rootHash, uint32 indexed t2TxId);

  event LogLifted(address indexed token, bytes32 indexed t2PubKey, uint256 amount);
  event LogLowerClaimed(uint32 indexed lowerId);
  event LogLowerLocked(uint32 indexed lowerId, address indexed recipient, address token, uint256 amount, bytes32 t2Sender, uint64 unlockTime);
  event LogLowerFrozen(uint32 indexed lowerId);
  event LogLowerUnfrozen(uint32 indexed lowerId);
  // T2 parses this event as topics only and rejects it if any data is added
  event LogLowerCancelled(uint32 indexed lowerId);
  event LogReplenishmentMinted(uint256 indexed amount, uint256 indexed remainingAllowance, uint32 indexed lowerId);
  event LogLowerReverted(address indexed token, bytes32 indexed t2PubKey, address indexed originalRecipient, uint256 amount, uint32 lowerId);

  // Owner only
  function activateAuthors(address[] calldata t1Addresses) external;
  function cancelLower(uint32 lowerId) external;
  function enableAuthors(bool enable) external;
  function enableLifting(bool enable) external;
  function enableLowering(bool enable) external;
  function freezeLowers(uint32[] calldata lowerIds) external;
  function mintRewards(uint128 amount) external;
  function rotateT1(uint256[] calldata ids, address[] calldata newAddresses) external;
  function setLowerLockPeriod(uint256 period) external;
  function setReplenishAllowance(uint256 expectedCurrent, uint256 amount) external;
  function unfreezeLower(uint32 lowerId) external;

  // Authors only
  function addAuthor(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function burnFees(uint128 amount, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function mintRewards(uint128 amount, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function removeAuthor(bytes32 t2PubKey, bytes calldata t1PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;

  // Public
  function lift(address token, bytes32 t2PubKey, uint256 amount) external;
  function claimLower(bytes calldata proof) external;
  function releaseLower(uint32 lowerId) external;
  function revertLower(bytes calldata proof) external;
  function checkLower(
    bytes calldata proof
  )
    external
    view
    returns (
      address token,
      uint256 amount,
      address recipient,
      uint32 lowerId,
      bytes32 t2Sender,
      uint64 t2Timestamp,
      uint256 confirmationsRequired,
      uint256 confirmationsProvided,
      bool proofIsValid,
      bool lowerIsUsed,
      LowerState state,
      bool lowerIsClaimable,
      bool lowerIsReleasable,
      uint64 unlockTime
    );
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath) external view returns (bool);
  function corroborate(uint32 t2TxId, uint256 expiry) external view returns (int8);
  function isLowerUsed(uint32 lowerId) external view returns (bool);
  function lowerState(uint32 lowerId) external view returns (LowerState);
}
