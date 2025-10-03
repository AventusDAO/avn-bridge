// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @dev Aventus Network Services bridging contract between Ethereum tier 1 (T1) and AVN tier 2 (T2) blockchains.
 * Enables POS "author" nodes to periodically publish T2 transactional state to T1.
 * Enables authors to be added and removed from participation in consensus.
 * Enables the "lifting" of any ETH, ERC20, or ERC777 tokens from T1 to the specified account on T2.
 * Enables the "lowering" of ETH, ERC20, and ERC777 tokens from T2 to the T1 account specified in the T2 proof.
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
  // Universal address as defined in Registry Contract Address section of https://eips.ethereum.org/EIPS/eip-1820
  IERC1820Registry private constant ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);
  // keccak256("ERC777Token")
  bytes32 private constant ERC777_TOKEN_HASH = 0xac7fbab5f54a3ca8194167523c6753bfeb96a445279294b6125b68cce2177054;
  // keccak256("ERC777TokensRecipient")
  bytes32 private constant ERC777_TOKENS_RECIPIENT_HASH = 0xb281fc8c12954d22544db45de3159a39272895b169a852b314f9cc762e44c53b;
  string private constant ESM_PREFIX = '\x19Ethereum Signed Message:\n32';
  string private constant EIP712_PREFIX = '\x19\x01';
  bytes32 private constant VERSION_HASH = keccak256('1');
  bytes32 private constant DOMAIN_TYPEHASH = keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
  bytes32 private constant ADD_AUTHOR_TYPEHASH = keccak256('AddAuthor(bytes t1PubKey,bytes32 t2PubKey,uint256 expiry,uint32 t2TxId)');
  bytes32 private constant LOWER_DATA_TYPEHASH = keccak256('LowerData(address token,uint256 amount,address recipient,uint32 lowerId)');
  bytes32 private constant PUBLISH_ROOT_TYPEHASH = keccak256('PublishRoot(bytes32 rootHash,uint256 expiry,uint32 t2TxId)');
  bytes32 private constant REMOVE_AUTHOR_TYPEHASH = keccak256('RemoveAuthor(bytes32 t2PubKey,bytes t1PubKey,uint256 expiry,uint32 t2TxId)');
  address private constant PSEUDO_ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
  uint256 private constant LIFT_LIMIT = type(uint128).max;
  uint256 private constant MINIMUM_AUTHOR_SET = 4;
  uint256 private constant LOWER_DATA_LENGTH = 20 + 32 + 20 + 4; // token address + amount + recipient address + lower ID
  uint256 private constant SIGNATURE_LENGTH = 65;
  uint256 private constant MINIMUM_LOWER_PROOF_LENGTH = LOWER_DATA_LENGTH + SIGNATURE_LENGTH * 2;
  uint256 private constant UNLOCKED = 0;
  uint256 private constant LOCKED = 1;
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
  mapping(bytes32 => bool) public hasLowered;
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
  error LiftDisabled(); // 0xb63d2c8c
  error LiftFailed(); // 0xb19ed519
  error LiftLimitHit(); // 0xc36d2830
  error Locked(); // 0x0f2e5b6c
  error LowerDisabled(); // 0x499e8c3a
  error LowerIsUsed(); // 0x24c1c1ce
  error MissingKeys(); // 0x097ec09e
  error NotAnAuthor(); // 0x157b0512
  error NotEnoughAuthors(); // 0x3a6a875c
  error PaymentFailed(); // 0xf499da20
  error PendingOwnerOnly(); // 0x306bd3d7
  error RootHashIsUsed(); // 0x2c8a3b6e
  error T1AddressInUse(address); // 0x78f22dd1
  error T2KeyInUse(bytes32); // 0x02f3935c
  error TxIdIsUsed(); // 0x7edd16f0
  error WindowExpired(); // 0x7bbfb6fe

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
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

  modifier onlyWhenLiftingEnabled() {
    if (!liftingEnabled) revert LiftDisabled();
    _;
  }

  modifier onlyWhenLoweringEnabled() {
    if (!loweringEnabled) revert LowerDisabled();
    _;
  }

  modifier onlyWhenAuthorsEnabled() {
    if (!authorsEnabled) revert AuthorsDisabled();
    _;
  }

  modifier onlyWithinCallWindow(uint256 expiry) {
    if (block.timestamp > expiry) revert WindowExpired();
    _;
  }

  modifier lock() {
    if (_lock == LOCKED) revert Locked();
    _lock = LOCKED;
    _;
    _lock = UNLOCKED;
  }

  function migrate(address avt, address newOwner) external onlyOwner {
    (bool success, ) = avt.call(abi.encodeWithSignature('setOwner(address)', newOwner));
    if (!success) revert();
  }

  function name() public pure returns (string memory) {
    return 'AVNBridge';
  }

  /**
   * @dev Allows the owner to enable/disable author functionality.
   */
  function toggleAuthors(bool state) external onlyOwner {
    authorsEnabled = state;
    emit LogAuthorsEnabled(state);
  }

  /**
   * @dev Allows the owner to enable/disable lifting.
   */
  function toggleLifting(bool state) external onlyOwner {
    liftingEnabled = state;
    emit LogLiftingEnabled(state);
  }

  /**
   * @dev Allows the owner to enable/disable lowering.
   */
  function toggleLowering(bool state) external onlyOwner {
    loweringEnabled = state;
    emit LogLoweringEnabled(state);
  }

  function rotateT1(address[] calldata newT1Addresses, uint256 startID, uint256 endID) external onlyOwner {
    uint256 numToRotate = endID - startID + 1;
    if (numToRotate != newT1Addresses.length) revert();

    for (uint256 i; i < numToRotate; i++) {
      uint256 currentID = startID + i;
      address oldAddress = idToT1Address[currentID];
      t1AddressToId[oldAddress] = 0;
      address newAddress = newT1Addresses[i];
      idToT1Address[currentID] = newAddress;
      t1AddressToId[newAddress] = currentID;
    }
  }

  /**
   * @dev Enables T2 to add a new author, permanently associating their T1 and T2 accounts and enabling
   * them to take part in consensus. Can also be used to reactivate an author, provided their details
   * have not changed. Activation of the author occurs on the first confirmation received from them.
   */
  function addAuthor(
    bytes calldata t1PubKey,
    bytes32 t2PubKey,
    uint256 expiry,
    uint32 t2TxId,
    bytes calldata confirmations
  ) external onlyWhenAuthorsEnabled onlyWithinCallWindow(expiry) {
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
  ) external onlyWhenAuthorsEnabled onlyWithinCallWindow(expiry) {
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
   * @dev Enables T2 to publish a Merkle tree root hash representing the latest set of calls to have been made on T2.
   */
  function publishRoot(
    bytes32 rootHash,
    uint256 expiry,
    uint32 t2TxId,
    bytes calldata confirmations
  ) external onlyWhenAuthorsEnabled onlyWithinCallWindow(expiry) {
    if (isPublishedRootHash[rootHash]) revert RootHashIsUsed();
    bytes32 proofHash = _toPublishRootProofHash(rootHash, expiry, t2TxId);
    _verifyConfirmations(false, proofHash, confirmations);
    _storeT2TxId(t2TxId);
    isPublishedRootHash[rootHash] = true;
    emit LogRootPublished(rootHash, t2TxId);
  }

  /**
   * @dev Enables anyone to move an amount of ERC20 tokens to the specified 32 byte public key of the recipient on T2.
   * Tokens must first be approved for use by this contract. Fails if it will cause the total amount of the
   * tokens currently lifted to exceed 340282366920938463463374607431768211455 (T2 constraint).
   */
  function lift(address token, bytes32 t2PubKey, uint256 amount) external onlyWhenLiftingEnabled lock {
    if (t2PubKey == bytes32(0)) revert InvalidT2Key();
    uint256 existingBalance = IERC20(token).balanceOf(address(this));
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    uint256 newBalance = IERC20(token).balanceOf(address(this));
    if (newBalance <= existingBalance) revert LiftFailed();
    if (newBalance > LIFT_LIMIT) revert LiftLimitHit();
    emit LogLifted(token, t2PubKey, newBalance - existingBalance);
  }

  /**
   * @dev Enables anyone to lift an amount of ETH to the specified 32 byte public key of the T2 recipient.
   */
  function liftETH(bytes32 t2PubKey) external payable onlyWhenLiftingEnabled lock {
    if (t2PubKey == bytes32(0)) revert InvalidT2Key();
    if (msg.value == 0) revert AmountIsZero();
    emit LogLifted(PSEUDO_ETH_ADDRESS, t2PubKey, msg.value);
  }

  /**
   * @dev ERC777 hook, triggered when anyone sends ERC777 tokens to this contract with a data payload containing
   * the 32 byte public key of the T2 recipient. Fails if the recipient is not supplied. Fails if it will cause the
   * total amount of the tokens currently lifted to exceed 340282366920938463463374607431768211455 (T2 constraint).
   */
  function tokensReceived(
    address operator,
    address /* from */,
    address to,
    uint256 amount,
    bytes calldata data,
    bytes calldata /* operatorData */
  ) external onlyWhenLiftingEnabled {
    if (operator == address(this)) return; // triggered by calling transferFrom in a lift call-chain so we don't lift again here
    if (_lock == LOCKED) revert Locked();
    if (amount == 0) revert AmountIsZero();
    if (to != address(this)) revert InvalidRecipient();
    if (ERC1820_REGISTRY.getInterfaceImplementer(msg.sender, ERC777_TOKEN_HASH) != msg.sender) revert InvalidERC777();
    if (IERC777(msg.sender).balanceOf(address(this)) > LIFT_LIMIT) revert LiftLimitHit();
    if (data.length != 32) revert InvalidT2Key();
    emit LogLifted(msg.sender, bytes32(data), amount);
  }

  /**
   * @dev Enables anyone to claim the amount of funds specified in the T2-supplied lower proof, for the intended recipient.
   */
  function claimLower(bytes calldata lowerProof) external onlyWhenLoweringEnabled lock {
    (address token, uint256 amount, address recipient, uint32 lowerId) = _extractLowerData(lowerProof);
    if (recipient == address(0)) revert AddressIsZero();
    _processLower(token, amount, recipient, lowerId, lowerProof);
    _releaseFunds(token, amount, recipient);

    emit LogLowerClaimed(lowerId);
  }

  /** @dev Check a lower proof. Returns the details, proof validity, and whether or not the lower has been claimed.
   * For unclaimed lowers, if the confirmations required exceed those provided then the proof must be regenerated
   * by T2 before claiming.
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
      uint256 confirmationsRequired,
      uint256 confirmationsProvided,
      bool proofIsValid,
      bool lowerIsClaimed
    )
  {
    if (lowerProof.length < MINIMUM_LOWER_PROOF_LENGTH) return (address(0), 0, address(0), 0, 0, 0, false, false);

    (token, amount, recipient, lowerId) = _extractLowerData(lowerProof);
    bytes32 proofHash = _toLowerDataProofHash(token, amount, recipient, lowerId);
    uint256 numConfirmations = (lowerProof.length - LOWER_DATA_LENGTH) / SIGNATURE_LENGTH;
    bool[] memory confirmed = new bool[](nextAuthorId);
    uint256 confirmationsOffset;

    lowerIsClaimed = hasLowered[proofHash];
    confirmationsProvided = numConfirmations;
    confirmationsRequired = _requiredConfirmations();
    assembly {
      confirmationsOffset := add(lowerProof.offset, LOWER_DATA_LENGTH)
    }

    for (uint256 i = 0; i < numConfirmations; ++i) {
      uint256 id = _recoverAuthorId(proofHash, confirmationsOffset, i);
      if (authorIsActive[id] && !confirmed[id]) confirmed[id] = true;
      else confirmationsProvided--;
    }

    proofIsValid = confirmationsProvided >= confirmationsRequired;
  }

  /**
   * @dev Enables anyone to check the current status of any author transaction. Helper function, intended for use by T2 authors.
   */
  function corroborate(uint32 t2TxId, uint256 expiry) external view returns (int8) {
    if (isUsedT2TxId[t2TxId]) return TX_SUCCEEDED;
    else if (block.timestamp > expiry) return TX_FAILED;
    else return TX_PENDING;
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
   * @dev Confirm the existence of a T2 extrinsic call within a published root.
   */
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath) public view returns (bool) {
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

  /** @dev Starts the ownership transfer of the contract to a new account. Replaces the pending transfer if there is one.
   *  Can only be called by the current owner.
   */
  function transferOwnership(address newOwner) public override onlyOwner {
    pendingOwner = newOwner;
    emit OwnershipTransferStarted(owner(), newOwner);
  }

  /**
   * @dev Disables the renounceOwnership function to prevent relinquishing ownership.
   */
  function renounceOwnership() public override onlyOwner {}

  function _authorizeUpgrade(address) internal override onlyOwner {}

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
      t1PubKey = abi.encode(t1PubKeysLHS[i], t1PubKeysRHS[i]);
      if (address(uint160(uint256(keccak256(t1PubKey)))) != t1Address) revert AddressMismatch();
      if (t1AddressToId[t1Address] != 0) revert T1AddressInUse(t1Address);
      _activateAuthor(_addNewAuthor(t1Address, t2PubKeys[i]));
      unchecked {
        ++i;
      }
    } while (i < numAuth);
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

  function _activateAuthor(uint256 id) private {
    authorIsActive[id] = true;
    unchecked {
      ++numActiveAuthors;
    }
  }

  function _domainSeparator() private view returns (bytes32) {
    return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name())), VERSION_HASH, block.chainid, address(this)));
  }

  function _extractLowerData(bytes calldata lowerProof) private pure returns (address token, uint256 amount, address recipient, uint32 lowerId) {
    if (lowerProof.length < MINIMUM_LOWER_PROOF_LENGTH) revert InvalidProof();
    assembly {
      token := shr(96, calldataload(lowerProof.offset))
      amount := calldataload(add(lowerProof.offset, 20))
      recipient := shr(96, calldataload(add(lowerProof.offset, 52)))
      lowerId := shr(224, calldataload(add(lowerProof.offset, 72)))
    }
  }

  function _processLower(address token, uint256 amount, address recipient, uint32 lowerId, bytes calldata lowerProof) private {
    bytes32 proofHash = _toLowerDataProofHash(token, amount, recipient, lowerId);
    if (hasLowered[proofHash]) revert LowerIsUsed();
    hasLowered[proofHash] = true;
    _verifyConfirmations(true, proofHash, lowerProof[LOWER_DATA_LENGTH:]);
  }

  function _releaseFunds(address token, uint256 amount, address recipient) private {
    if (token == PSEUDO_ETH_ADDRESS) {
      (bool success, ) = payable(recipient).call{ value: amount }('');
      if (!success) revert PaymentFailed();
    } else if (token == ERC1820_REGISTRY.getInterfaceImplementer(token, ERC777_TOKEN_HASH)) {
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

  function _toAddress(bytes memory t1PubKey) private pure returns (address) {
    return address(uint160(uint256(keccak256(t1PubKey))));
  }

  function _verifyConfirmations(bool isLower, bytes32 msgHash, bytes calldata confirmations) private {
    uint256[] memory confirmed = new uint256[](nextAuthorId);
    uint256 requiredConfirmations = _requiredConfirmations();
    uint256 numConfirmations = confirmations.length / SIGNATURE_LENGTH;
    uint256 confirmationsOffset;
    uint256 confirmationsIndex;
    uint256 validConfirmations;
    uint256 authorId;

    assembly {
      confirmationsOffset := confirmations.offset
    }

    // Setup the first iteration of the do-while loop:
    if (isLower) {
      // For lowers all confirmations are explicit so the first authorId is extracted from the first confirmation
      authorId = _recoverAuthorId(msgHash, confirmationsOffset, confirmationsIndex);
      confirmationsIndex = 1;
    } else {
      // For non-lowers there is a high likelihood the sender is an author, so their confirmation is taken to be implicit
      authorId = t1AddressToId[msg.sender];
      unchecked {
        ++numConfirmations;
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

      // Setup the next iteration of the loop
      authorId = _recoverAuthorId(msgHash, confirmationsOffset, confirmationsIndex);
      unchecked {
        ++confirmationsIndex;
      }
    } while (confirmationsIndex <= numConfirmations);

    revert BadConfirmations();
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

  function _toAddAuthorProofHash(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId) private view returns (bytes32) {
    bytes32 t1PubKeyHash = keccak256(t1PubKey);
    bytes32 structHash = keccak256(abi.encode(ADD_AUTHOR_TYPEHASH, t1PubKeyHash, t2PubKey, expiry, t2TxId));
    return keccak256(abi.encodePacked(EIP712_PREFIX, _domainSeparator(), structHash));
  }

  function _toLowerDataProofHash(address token, uint256 amount, address recipient, uint32 lowerId) private view returns (bytes32) {
    bytes32 structHash = keccak256(abi.encode(LOWER_DATA_TYPEHASH, token, amount, recipient, lowerId));
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

  function _storeT2TxId(uint256 t2TxId) private {
    if (isUsedT2TxId[t2TxId]) revert TxIdIsUsed();
    isUsedT2TxId[t2TxId] = true;
  }
}
