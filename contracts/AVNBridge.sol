// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/**
 * @dev Aventus Network bridging contract between Ethereum tier 1 (T1) and AVN tier 2 (T2) blockchains.
 * Enables POS "author" nodes to periodically publish T2 transactional state to T1.
 * Enables addition and removal of authors from participation in consensus.
 * Enables "lifting" of ERC20 or ERC777 tokens from T1 to the specified account on T2.
 * Enables "lowering" of ERC20 and ERC777 tokens from T2 to the T1 account specified in the T2 proof.
 * Proxy upgradeable implementation utilising EIP-1822.
 */

import './interfaces/IAVNBridge.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/interfaces/IERC20.sol';
import '@openzeppelin/contracts/interfaces/IERC777.sol';
import '@openzeppelin/contracts/interfaces/IERC777Recipient.sol';
import '@openzeppelin/contracts/interfaces/IERC1820Registry.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';

contract AVNBridge is IAVNBridge, IERC777Recipient, Initializable, UUPSUpgradeable, OwnableUpgradeable {
  using SafeERC20 for IERC20;

  IERC1820Registry private constant ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);

  string private constant EIP712_PREFIX = '\x19\x01';

  bytes32 private constant ERC777_TOKEN_HASH = keccak256('ERC777Token');
  bytes32 private constant ERC777_TOKENS_RECIPIENT_HASH = keccak256('ERC777TokensRecipient');
  bytes32 private constant VERSION_HASH = keccak256('1');

  bytes32 private constant DOMAIN_TYPEHASH = keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
  bytes32 private constant ADD_AUTHOR_TYPEHASH = keccak256('AddAuthor(bytes t1PubKey,bytes32 t2PubKey,uint256 expiry,uint32 t2TxId)');
  bytes32 private constant LOWER_DATA_TYPEHASH =
    keccak256('LowerData(address token,uint256 amount,address recipient,uint32 lowerId,bytes32 t2Sender,uint64 t2Timestamp)');
  bytes32 private constant PUBLISH_ROOT_TYPEHASH = keccak256('PublishRoot(bytes32 rootHash,uint256 expiry,uint32 t2TxId)');
  bytes32 private constant REMOVE_AUTHOR_TYPEHASH = keccak256('RemoveAuthor(bytes32 t2PubKey,bytes t1PubKey,uint256 expiry,uint32 t2TxId)');

  uint256 private constant LOWER_DATA_LENGTH = 20 + 32 + 20 + 4 + 32 + 8; // token address + amount + T1 recipient address + lower ID + T2 sender public key + T2 timestamp
  uint256 private constant MINIMUM_AUTHOR_SET = 4;
  uint256 private constant SIGNATURE_LENGTH = 65;
  uint256 private constant T2_TOKEN_LIMIT = type(uint128).max;
  uint256 private constant MINIMUM_LOWER_PROOF_LENGTH = LOWER_DATA_LENGTH + SIGNATURE_LENGTH * 2;

  uint256 private constant UNLOCKED = 0;
  uint256 private constant LOCKED = 1;

  uint32 private constant OWNER_REVERT_LOWER_DELAY = 3 days;

  int8 private constant TX_SUCCEEDED = 1;
  int8 private constant TX_PENDING = 0;
  int8 private constant TX_FAILED = -1;

  /// @custom:oz-renamed-from isRegisteredValidator
  mapping(uint256 => bool) public isAuthor;
  /// @custom:oz-renamed-from isActiveValidator
  mapping(uint256 => bool) public authorIsActive;
  mapping(address => uint256) public t1AddressToId;
  /// @custom:oz-renamed-from t2PublicKeyToId
  mapping(bytes32 => uint256) public t2PubKeyToId;
  mapping(uint256 => address) public idToT1Address;
  /// @custom:oz-renamed-from idToT2PublicKey
  mapping(uint256 => bytes32) public idToT2PubKey;
  /// @custom:oz-renamed-from numBytesToLowerData
  mapping(bytes2 => uint256) private _unused3_;
  mapping(bytes32 => bool) public isPublishedRootHash;
  /// @custom:oz-renamed-from isUsedT2TransactionId
  mapping(uint256 => bool) public isUsedT2TxId;
  /// @custom:oz-renamed-from hasLowered
  mapping(bytes32 => bool) private _unused8_;
  /// @custom:oz-renamed-from growthTriggered
  mapping(uint32 => uint256) private _unused4_;
  /// @custom:oz-renamed-from growthAmount
  mapping(uint32 => uint128) private _unused5_;

  /// @custom:oz-renamed-from quorum
  uint256[2] private _unused1_;
  /// @custom:oz-renamed-from numActiveValidators
  uint256 public numActiveAuthors;
  /// @custom:oz-renamed-from nextValidatorId
  uint256 public nextAuthorId;
  /// @custom:oz-renamed-from growthDelay
  uint256 private _unused6_;
  /// @custom:oz-renamed-from coreToken
  address private _unused7_;
  /// @custom:oz-renamed-from priorInstance
  address private _unused2_;
  /// @custom:oz-renamed-from validatorFunctionsAreEnabled
  bool public authorsEnabled;
  /// @custom:oz-renamed-from liftingIsEnabled
  bool public liftingEnabled;
  /// @custom:oz-renamed-from loweringIsEnabled
  bool public loweringEnabled;
  address public pendingOwner;
  uint256 private _lock;

  mapping(uint256 => uint256) private usedLowers; // bitmap of 256-bit buckets where lowerId >> 8 = bucket and lowerId & 255 = bit (eg: lowedId 514 = bucket[2], bit index 2)

  error AddressIsZero(); // 0x867915ab
  error AddressMismatch(); // 0x4cd87fb5
  error AlreadyAdded(); // 0xf411c327
  error AmountIsZero(); // 0x43ad20fc
  error AuthorsDisabled(); // 0x7b465238
  error BadConfirmations(); // 0x409c8aac
  error CannotChangeT2Key(bytes32); // 0x140c6815
  error InvalidERC777(); // 0x0e9dcbf6
  error InvalidProof(); // 0x09bde339
  error InvalidRecipient(); // 0x9c8d2cd2
  error InvalidT1Key(); // 0x4b0218a8
  error InvalidT2Key(); // 0xf4fc87a4
  error LegacyLower(); // 0x9e79b036
  error LiftDisabled(); // 0xb63d2c8c
  error LiftFailed(); // 0xb19ed519
  error LiftLimitHit(); // 0xc36d2830
  error Locked(); // 0x0f2e5b6c
  error LowerDisabled(); // 0x499e8c3a
  error LowerIsUsed(); // 0x24c1c1ce
  error MissingKeys(); // 0x097ec09e
  error NotAnAuthor(); // 0x157b0512
  error NotEnoughAuthors(); // 0x3a6a875c
  error PendingOwnerOnly(); // 0x306bd3d7
  error PermissionDenied(); // 0x1e092104
  error RootHashIsUsed(); // 0x2c8a3b6e
  error T1AddressInUse(address); // 0x78f22dd1
  error T2KeyInUse(bytes32); // 0x02f3935c
  error TxIdIsUsed(); // 0x7edd16f0
  error WindowExpired(); // 0x7bbfb6fe

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  modifier whenAuthorsEnabled() {
    if (!authorsEnabled) revert AuthorsDisabled();
    _;
  }

  modifier whenLiftEnabled() {
    if (!liftingEnabled) revert LiftDisabled();
    _;
  }

  modifier whenLowerEnabled() {
    if (!loweringEnabled) revert LowerDisabled();
    _;
  }

  modifier withinCallWindow(uint256 expiry) {
    if (block.timestamp > expiry) revert WindowExpired();
    _;
  }

  modifier lock() {
    if (_lock == LOCKED) revert Locked();
    _lock = LOCKED;
    _;
    _lock = UNLOCKED;
  }

  function initialize(
    address[] calldata t1Addresses,
    bytes32[] calldata t1PubKeysLHS,
    bytes32[] calldata t1PubKeysRHS,
    bytes32[] calldata t2PubKeys
  ) public initializer {
    __Ownable_init();
    __UUPSUpgradeable_init();
    ERC1820_REGISTRY.setInterfaceImplementer(address(this), ERC777_TOKENS_RECIPIENT_HASH, address(this));
    authorsEnabled = true;
    liftingEnabled = true;
    loweringEnabled = true;
    nextAuthorId = 1;
    _initialiseAuthors(t1Addresses, t1PubKeysLHS, t1PubKeysRHS, t2PubKeys);
  }

  /**
   * @dev Temporary owner function to migrate existing claimed lowers and drain any trace wei.
   */
  function migrate(uint256[] calldata buckets, uint256[] calldata words) external onlyOwner {
    if (buckets.length != words.length) revert();

    for (uint256 i; i < buckets.length; ) {
      usedLowers[buckets[i]] = words[i];
      unchecked {
        ++i;
      }
    }

    uint256 balance = address(this).balance;
    if (balance != 0) {
      (bool ok, ) = payable(owner()).call{ value: balance }('');
      if (!ok) revert();
    }
  }

  /**
   * @dev EIP712 Domain name.
   */
  function name() public pure returns (string memory) {
    return 'AVNBridge';
  }

  /**
   * @dev Lets the owner enable/disable author access.
   */
  function enableAuthors(bool enable) external onlyOwner {
    authorsEnabled = enable;
    emit LogAuthorsEnabled(enable);
  }

  /**
   * @dev Lets the owner enable/disable lifting.
   */
  function enableLifting(bool enable) external onlyOwner {
    liftingEnabled = enable;
    emit LogLiftingEnabled(enable);
  }

  /**
   * @dev Lets the owner enable/disable lowering.
   */
  function enableLowering(bool enable) external onlyOwner {
    loweringEnabled = enable;
    emit LogLoweringEnabled(enable);
  }

  /**
   * @dev Lets the owner rotate author T1 addresses.
   */
  function rotateT1(uint256[] calldata ids, address[] calldata newAddresses) external onlyOwner {
    uint256 rotations = ids.length;
    if (rotations != newAddresses.length) revert MissingKeys();

    uint256 id;
    address newAddress;
    address oldAddress;

    for (uint256 i; i < rotations; i++) {
      id = ids[i];
      newAddress = newAddresses[i];
      if (newAddress == address(0)) revert AddressIsZero();
      if (t1AddressToId[newAddress] != 0) revert T1AddressInUse(newAddress);
      oldAddress = idToT1Address[id];
      if (oldAddress == address(0)) revert NotAnAuthor();
      t1AddressToId[oldAddress] = 0;
      idToT1Address[id] = newAddress;
      t1AddressToId[newAddress] = id;
    }
  }

  /**
   * @dev Enables T2 to add a new author, permanently linking their T1 and T2 keys.
   * Author activation will occur upon the first confirmation received from them.
   * Can also be used to reactivate an author.
   */
  function addAuthor(
    bytes calldata t1PubKey,
    bytes32 t2PubKey,
    uint256 expiry,
    uint32 t2TxId,
    bytes calldata confirmations
  ) external whenAuthorsEnabled withinCallWindow(expiry) {
    if (t1PubKey.length != 64) revert InvalidT1Key();
    if (t2PubKey == bytes32(0)) revert InvalidT2Key();
    address t1Address = _toAddress(t1PubKey);
    uint256 id = t1AddressToId[t1Address];
    if (isAuthor[id]) revert AlreadyAdded();
    bytes32 proofHash = _toAddAuthorProofHash(t1PubKey, t2PubKey, expiry, t2TxId);
    _verifyConfirmations(false, proofHash, confirmations);
    _storeT2TxId(t2TxId);

    if (id == 0) {
      _addNewAuthor(t1Address, t2PubKey);
    } else {
      if (t2PubKey != idToT2PubKey[id]) revert CannotChangeT2Key(idToT2PubKey[id]);
      isAuthor[id] = true;
    }

    emit LogAuthorAdded(t1Address, t2PubKey, t2TxId);
  }

  /**
   * @dev Enables T2 to remove an author, immediately revoking their authority on T1.
   */
  function removeAuthor(
    bytes32 t2PubKey,
    bytes calldata t1PubKey,
    uint256 expiry,
    uint32 t2TxId,
    bytes calldata confirmations
  ) external whenAuthorsEnabled withinCallWindow(expiry) {
    if (t1PubKey.length != 64) revert InvalidT1Key();
    uint256 id = t2PubKeyToId[t2PubKey];
    if (!isAuthor[id]) revert NotAnAuthor();

    bytes32 proofHash = _toRemoveAuthorProofHash(t2PubKey, t1PubKey, expiry, t2TxId);
    _verifyConfirmations(false, proofHash, confirmations);

    if (numActiveAuthors <= MINIMUM_AUTHOR_SET) revert NotEnoughAuthors();
    _storeT2TxId(t2TxId);

    isAuthor[id] = false;

    if (authorIsActive[id]) {
      authorIsActive[id] = false;
      unchecked {
        --numActiveAuthors;
      }
    }

    emit LogAuthorRemoved(idToT1Address[id], t2PubKey, t2TxId);
  }

  /**
   * @dev Enables T2 to publish a Merkle root summarising the latest set of T2 extrinsic calls.
   */
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external whenAuthorsEnabled withinCallWindow(expiry) {
    if (isPublishedRootHash[rootHash]) revert RootHashIsUsed();
    bytes32 proofHash = _toPublishRootProofHash(rootHash, expiry, t2TxId);
    _verifyConfirmations(false, proofHash, confirmations);
    _storeT2TxId(t2TxId);
    isPublishedRootHash[rootHash] = true;
    emit LogRootPublished(rootHash, t2TxId);
  }

  /**
   * @dev Lets the caller lift an amount of approved ERC20 tokens to the specified T2 recipient.
   */
  function lift(address token, bytes32 t2PubKey, uint256 amount) external whenLiftEnabled lock {
    if (t2PubKey == bytes32(0)) revert InvalidT2Key();
    uint256 existingBalance = IERC20(token).balanceOf(address(this));
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    uint256 newBalance = IERC20(token).balanceOf(address(this));
    if (newBalance <= existingBalance) revert LiftFailed();
    if (newBalance > T2_TOKEN_LIMIT) revert LiftLimitHit();
    emit LogLifted(token, t2PubKey, newBalance - existingBalance);
  }

  /**
   * @dev ERC777 hook, triggered when anyone sends ERC777 tokens to this contract with a data payload containing
   * the 32 byte public key of the T2 recipient. Fails if the recipient is not supplied.
   */
  function tokensReceived(address operator, address, address to, uint256 amount, bytes calldata data, bytes calldata) external whenLiftEnabled {
    if (operator == address(this)) return; // triggered by calling transferFrom in a lift call-chain so we don't lift again here
    if (_lock == LOCKED) revert Locked();
    if (amount == 0) revert AmountIsZero();
    if (to != address(this)) revert InvalidRecipient();
    if (ERC1820_REGISTRY.getInterfaceImplementer(msg.sender, ERC777_TOKEN_HASH) != msg.sender) revert InvalidERC777();
    if (IERC777(msg.sender).balanceOf(address(this)) > T2_TOKEN_LIMIT) revert LiftLimitHit();
    if (data.length != 32) revert InvalidT2Key();
    emit LogLifted(msg.sender, bytes32(data), amount);
  }

  /**
   * @dev Checks a lower proof. Returns the details of the lower, proof validity, and used status.
   */
  function checkLower(
    bytes calldata lowerProof
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
    )
  {
    if (!_isCorrectLength(lowerProof)) return (address(0), 0, address(0), 0, bytes32(0), 0, 0, 0, false, false);

    (token, amount, recipient, lowerId, t2Sender, t2Timestamp) = _extractLowerData(lowerProof);
    bytes32 proofHash = _toLowerDataProofHash(token, amount, recipient, lowerId, t2Sender, t2Timestamp);
    uint256 numConfirmationsProvided = (lowerProof.length - LOWER_DATA_LENGTH) / SIGNATURE_LENGTH;
    bool[] memory confirmed = new bool[](nextAuthorId);
    uint256 confirmationsOffset;

    lowerIsUsed = lowerUsed(lowerId);
    confirmationsProvided = numConfirmationsProvided;
    confirmationsRequired = _requiredConfirmations();
    assembly {
      confirmationsOffset := add(lowerProof.offset, LOWER_DATA_LENGTH)
    }

    for (uint256 i; i < numConfirmationsProvided; ++i) {
      uint256 id = _recoverAuthorId(proofHash, confirmationsOffset, i);
      if (authorIsActive[id] && !confirmed[id]) confirmed[id] = true;
      else confirmationsProvided--;
    }

    proofIsValid = confirmationsProvided >= confirmationsRequired;
  }

  /**
   * @dev Enables anyone to claim the amount of funds specified in the lower proof, for the intended recipient.
   */
  function claimLower(bytes calldata lowerProof) external whenLowerEnabled lock {
    (address token, uint256 amount, address recipient, uint32 lowerId, bytes32 t2Sender, uint64 t2Timestamp) = _extractLowerData(lowerProof);
    if (recipient == address(0)) revert AddressIsZero();

    _processLower(token, amount, recipient, lowerId, t2Sender, t2Timestamp, lowerProof);
    _releaseFunds(token, amount, recipient);
    emit LogLowerClaimed(lowerId);
  }

  /**
   * @dev Allows the intended recipient to revert a lower instead of claiming it, returning the funds to the originating T2 sender.
   * In the case of the recipient being unable to revert, the owner may do so on their behalf after 72 hours have passed.
   */
  function revertLower(bytes calldata lowerProof) external whenLiftEnabled lock {
    (address token, uint256 amount, address recipient, uint32 lowerId, bytes32 t2Sender, uint64 t2Timestamp) = _extractLowerData(lowerProof);
    bool canRevert = msg.sender == recipient || (msg.sender == owner() && block.timestamp > t2Timestamp + OWNER_REVERT_LOWER_DELAY);
    if (!canRevert) revert PermissionDenied();
    if (t2Sender == bytes32(0)) revert LegacyLower();

    _processLower(token, amount, recipient, lowerId, t2Sender, t2Timestamp, lowerProof);
    emit LogLowerReverted(token, t2Sender, recipient, amount, lowerId);
  }

  /**
   * @dev Confirm the existence of a T2 extrinsic call within a published root.
   */
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath) external view returns (bool) {
    bytes32 node;
    uint256 i;

    do {
      node = merklePath[i];
      leafHash = leafHash < node ? keccak256(abi.encode(leafHash, node)) : keccak256(abi.encode(node, leafHash));
      unchecked {
        ++i;
      }
    } while (i < merklePath.length);

    return isPublishedRootHash[leafHash];
  }

  /**
   * @dev Returns the current status of an author transaction. Helper function, intended for use by T2 authors.
   */
  function corroborate(uint32 t2TxId, uint256 expiry) external view returns (int8) {
    if (isUsedT2TxId[t2TxId]) return TX_SUCCEEDED;
    else if (block.timestamp > expiry) return TX_FAILED;
    else return TX_PENDING;
  }

  /**
   * @dev Returns the claim status of the lower.
   */
  function lowerUsed(uint32 lowerId) public view returns (bool) {
    uint256 bucket = uint256(lowerId) >> 8;
    uint256 mask = 1 << (uint256(lowerId) & 255);
    return (usedLowers[bucket] & mask) != 0;
  }

  /** @dev Starts the ownership transfer of the contract to a new account. Replaces the pending transfer if there is one.
   *  Can only be called by the current owner.
   */
  function transferOwnership(address newOwner) public override onlyOwner {
    pendingOwner = newOwner;
    emit OwnershipTransferStarted(owner(), newOwner);
  }

  /**
   * @dev The new owner accepts the ownership transfer.
   */
  function acceptOwnership() external {
    if (msg.sender != pendingOwner) revert PendingOwnerOnly();
    delete pendingOwner;
    _transferOwnership(msg.sender);
  }

  /**
   * @dev Disables renounceOwnership.
   */
  function renounceOwnership() public override onlyOwner {}

  function _authorizeUpgrade(address) internal override onlyOwner {}

  function _activateAuthor(uint256 id) private {
    authorIsActive[id] = true;
    unchecked {
      ++numActiveAuthors;
    }
  }

  function _addNewAuthor(address t1Address, bytes32 t2PubKey) private returns (uint256 id) {
    unchecked {
      id = nextAuthorId++;
    }
    if (t2PubKeyToId[t2PubKey] != 0) revert T2KeyInUse(t2PubKey);
    idToT1Address[id] = t1Address;
    idToT2PubKey[id] = t2PubKey;
    t1AddressToId[t1Address] = id;
    t2PubKeyToId[t2PubKey] = id;
    isAuthor[id] = true;
  }

  function _domainSeparator() private view returns (bytes32) {
    return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name())), VERSION_HASH, block.chainid, address(this)));
  }

  function _extractLowerData(
    bytes calldata lowerProof
  ) private pure returns (address token, uint256 amount, address recipient, uint32 lowerId, bytes32 t2Sender, uint64 t2Timestamp) {
    if (!_isCorrectLength(lowerProof)) revert InvalidProof();

    assembly {
      token := shr(96, calldataload(lowerProof.offset))
      amount := calldataload(add(lowerProof.offset, 20))
      recipient := shr(96, calldataload(add(lowerProof.offset, 52)))
      lowerId := shr(224, calldataload(add(lowerProof.offset, 72)))
      t2Sender := calldataload(add(lowerProof.offset, 76))
      t2Timestamp := shr(192, calldataload(add(lowerProof.offset, 108)))
    }
  }

  function _initialiseAuthors(
    address[] calldata t1Addresses,
    bytes32[] calldata t1PubKeysLHS,
    bytes32[] calldata t1PubKeysRHS,
    bytes32[] calldata t2PubKeys
  ) private {
    uint256 numAuth = t1Addresses.length;
    if (numAuth < MINIMUM_AUTHOR_SET) revert NotEnoughAuthors();
    if (t1PubKeysLHS.length != numAuth || t1PubKeysRHS.length != numAuth || t2PubKeys.length != numAuth) revert MissingKeys();

    bytes memory t1PubKey;
    address t1Address;
    uint256 i;

    do {
      t1Address = t1Addresses[i];
      if (t1Address == address(0)) revert AddressIsZero();
      t1PubKey = abi.encode(t1PubKeysLHS[i], t1PubKeysRHS[i]);
      if (address(uint160(uint256(keccak256(t1PubKey)))) != t1Address) revert AddressMismatch();
      if (t1AddressToId[t1Address] != 0) revert T1AddressInUse(t1Address);
      _activateAuthor(_addNewAuthor(t1Address, t2PubKeys[i]));
      unchecked {
        ++i;
      }
    } while (i < numAuth);
  }

  function _isCorrectLength(bytes calldata proof) private pure returns (bool) {
    if (proof.length < MINIMUM_LOWER_PROOF_LENGTH) return false;
    return (proof.length - LOWER_DATA_LENGTH) % SIGNATURE_LENGTH == 0;
  }

  function _processLower(
    address token,
    uint256 amount,
    address recipient,
    uint32 lowerId,
    bytes32 t2Sender,
    uint64 t2Timestamp,
    bytes calldata lowerProof
  ) private {
    if (lowerUsed(lowerId)) revert LowerIsUsed();
    uint256 bucket = uint256(lowerId) >> 8;
    usedLowers[bucket] |= 1 << (uint256(lowerId) & 255);

    bytes32 proofHash = _toLowerDataProofHash(token, amount, recipient, lowerId, t2Sender, t2Timestamp);
    _verifyConfirmations(true, proofHash, lowerProof[LOWER_DATA_LENGTH:]);
  }

  function _recoverAuthorId(bytes32 ethSignedPrefixMsgHash, uint256 confirmationsOffset, uint256 confirmationsIndex) private view returns (uint256 id) {
    bytes32 r;
    bytes32 s;
    uint8 v;

    assembly {
      let sig := add(confirmationsOffset, mul(confirmationsIndex, SIGNATURE_LENGTH))
      r := calldataload(sig)
      s := calldataload(add(sig, 32))
      v := byte(0, calldataload(add(sig, 64)))
    }

    if (v < 27) {
      unchecked {
        v += 27;
      }
    }

    id = v < 29 && uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
      ? t1AddressToId[ecrecover(ethSignedPrefixMsgHash, v, r, s)]
      : 0;
  }

  function _releaseFunds(address token, uint256 amount, address recipient) private {
    if (token == ERC1820_REGISTRY.getInterfaceImplementer(token, ERC777_TOKEN_HASH)) {
      try IERC777(token).send(recipient, amount, '') {} catch {
        IERC20(token).safeTransfer(recipient, amount);
      }
    } else IERC20(token).safeTransfer(recipient, amount);
  }

  function _requiredConfirmations() private view returns (uint256 required) {
    required = numActiveAuthors;
    unchecked {
      required -= (required * 2) / 3;
    }
  }

  function _storeT2TxId(uint256 t2TxId) private {
    if (isUsedT2TxId[t2TxId]) revert TxIdIsUsed();
    isUsedT2TxId[t2TxId] = true;
  }

  function _toAddress(bytes memory t1PubKey) private pure returns (address) {
    return address(uint160(uint256(keccak256(t1PubKey))));
  }

  function _toAddAuthorProofHash(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId) private view returns (bytes32) {
    bytes32 t1PubKeyHash = keccak256(t1PubKey);
    bytes32 structHash = keccak256(abi.encode(ADD_AUTHOR_TYPEHASH, t1PubKeyHash, t2PubKey, expiry, t2TxId));
    return keccak256(abi.encodePacked(EIP712_PREFIX, _domainSeparator(), structHash));
  }

  function _toLowerDataProofHash(
    address token,
    uint256 amount,
    address recipient,
    uint32 lowerId,
    bytes32 t2Sender,
    uint64 t2Timestamp
  ) private view returns (bytes32) {
    bytes32 structHash = keccak256(abi.encode(LOWER_DATA_TYPEHASH, token, amount, recipient, lowerId, t2Sender, t2Timestamp));
    return keccak256(abi.encodePacked(EIP712_PREFIX, _domainSeparator(), structHash));
  }

  function _toPublishRootProofHash(bytes32 rootHash, uint256 expiry, uint32 t2TxId) private view returns (bytes32) {
    bytes32 structHash = keccak256(abi.encode(PUBLISH_ROOT_TYPEHASH, rootHash, expiry, t2TxId));
    return keccak256(abi.encodePacked(EIP712_PREFIX, _domainSeparator(), structHash));
  }

  function _toRemoveAuthorProofHash(bytes32 t2PubKey, bytes calldata t1PubKey, uint256 expiry, uint32 t2TxId) private view returns (bytes32) {
    bytes32 t1PubKeyHash = keccak256(t1PubKey);
    bytes32 structHash = keccak256(abi.encode(REMOVE_AUTHOR_TYPEHASH, t2PubKey, t1PubKeyHash, expiry, t2TxId));
    return keccak256(abi.encodePacked(EIP712_PREFIX, _domainSeparator(), structHash));
  }

  function _verifyConfirmations(bool isLower, bytes32 msgHash, bytes calldata confirmations) private {
    uint256[] memory confirmed = new uint256[](nextAuthorId);
    uint256 requiredConfirmations = _requiredConfirmations();
    uint256 numConfirmationsProvided = confirmations.length / SIGNATURE_LENGTH;
    uint256 confirmationsOffset;
    uint256 confirmationsIndex;
    uint256 validConfirmations;
    uint256 authorId;

    assembly {
      confirmationsOffset := confirmations.offset
    }

    if (isLower) {
      // For lowers all confirmations are explicit so the first authorId is extracted from the first confirmation
      authorId = _recoverAuthorId(msgHash, confirmationsOffset, confirmationsIndex);
      confirmationsIndex = 1;
    } else {
      // For non-lowers the we optimistically assume the sender is an author
      authorId = t1AddressToId[msg.sender];
      unchecked {
        ++numConfirmationsProvided; // their confirmation is thus implicit
      }
    }

    do {
      if (!authorIsActive[authorId]) {
        if (isAuthor[authorId]) {
          _activateAuthor(authorId);
          unchecked {
            ++validConfirmations;
          }
          requiredConfirmations = _requiredConfirmations();
          if (validConfirmations == requiredConfirmations) return; // success
          confirmed[authorId] = 1;
        }
      } else if (confirmed[authorId] == 0) {
        unchecked {
          ++validConfirmations;
        }
        if (validConfirmations == requiredConfirmations) return; // success
        confirmed[authorId] = 1;
      }

      authorId = _recoverAuthorId(msgHash, confirmationsOffset, confirmationsIndex);
      unchecked {
        ++confirmationsIndex;
      }
    } while (confirmationsIndex <= numConfirmationsProvided);

    revert BadConfirmations();
  }
}
