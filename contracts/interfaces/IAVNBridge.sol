// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IAVNBridge {
  event LogAuthorsEnabled(bool indexed state);
  event LogLiftingEnabled(bool indexed state);
  event LogLoweringEnabled(bool indexed state);
  event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

  event LogAuthorAdded(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogAuthorRemoved(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogRootPublished(bytes32 indexed rootHash, uint32 indexed t2TxId);

  event LogLifted(address indexed token, bytes32 indexed t2PubKey, uint256 amount);
  event LogLowerClaimed(uint32 indexed lowerId);
  event LogLowerReverted(uint32 indexed lowerId, address indexed recipient, address indexed revertedBy);

  // Owner only
  function toggleAuthors(bool state) external;
  function toggleLifting(bool state) external;
  function toggleLowering(bool state) external;
  function rotateT1(uint256[] calldata ids, address[] calldata newAddresses) external;

  // Authors only
  function addAuthor(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function removeAuthor(bytes32 t2PubKey, bytes calldata t1PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;

  // Public
  function lift(address token, bytes32 t2PubKey, uint256 amount) external;
  function claimLower(bytes calldata proof) external;
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
      bool lowerIsUsed
    );
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath) external view returns (bool);
  function corroborate(uint32 t2TxId, uint256 expiry) external view returns (int8);
  function lowerUsed(uint32 lowerId) external view returns (bool);
}
