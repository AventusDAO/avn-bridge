// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

/// @title Bridging contract between Ethereum tier 1 (T1) and AVN tier 2 (T2) blockchains
/// @author Aventus Network Services
/** @notice
  Enables POS authors to periodically publish the transactional state of T2 to this contract.
  Enables authors to be added and removed from participating in consensus.
  Enables triggering periodic growth of the core token according to the reward calculation mechanisms of T2.
  Enables the "lifting" of any ETH, ERC20, or ERC777 tokens received, locking them in the contract to be recreated on T2.
  Enables the "lowering" of ETH, ERC20, and ERC777 tokens, unlocking them from the contract via proof of their destruction on T2.
*/
/// @dev Proxy upgradeable implementation utilising EIP-1822

import "./interfaces/IAVNBridge.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC777.sol";
import "@openzeppelin/contracts/interfaces/IERC777Recipient.sol";
import "@openzeppelin/contracts/interfaces/IERC1820Registry.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract AVNBridge is IAVNBridge, IERC777Recipient, Initializable, UUPSUpgradeable, OwnableUpgradeable {
  // Universal address as defined in Registry Contract Address section of https://eips.ethereum.org/EIPS/eip-1820
  IERC1820Registry constant internal ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);
  // keccak256("ERC777Token")
  bytes32 constant internal ERC777_TOKEN_HASH = 0xac7fbab5f54a3ca8194167523c6753bfeb96a445279294b6125b68cce2177054;
  // keccak256("ERC777TokensRecipient")
  bytes32 constant internal ERC777_TOKENS_RECIPIENT_HASH = 0xb281fc8c12954d22544db45de3159a39272895b169a852b314f9cc762e44c53b;
  uint256 constant internal SIGNATURE_LENGTH = 65;
  uint256 constant internal LIFT_LIMIT = type(uint128).max;
  address constant internal PSEUDO_ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  /// @notice Query an author's current status by their internal ID
  mapping (uint256 => bool) public isAuthor;
  /// @notice Query an author's current activation status by their internal ID
  mapping (uint256 => bool) public authorIsActive;
  /// @notice Query an author's persistent internal author ID by their Ethereum address
  mapping (address => uint256) public t1AddressToId;
  /// @notice Query an author's persistent internal author ID by their T2 public key
  mapping (bytes32 => uint256) public t2PubKeyToId;
  /// @notice Query an author's persistent Ethereum address by their internal author ID
  mapping (uint256 => address) public idToT1Address;
  /// @notice Query an author's persistent T2 public key by their internal author ID
  mapping (uint256 => bytes32) public idToT2PubKey;
  /// @notice Mapping of T2 extrinsic IDs to the number of bytes that require traversing in a leaf before reaching lower data
  mapping (bytes2 => uint256) public numBytesToLowerData;
  /// @notice Query whether a particular Merkle tree root hash of T2 state has been published
  mapping (bytes32 => bool) public isPublishedRootHash;
  /// @notice Query whether a unique T2 transaction ID has been used
  mapping (uint256 => bool) public isUsedT2TxId;
  /// @notice Query whether the hash of a T2 lower transaction leaf has been used to claim its lowered funds on T1
  mapping (bytes32 => bool) public hasLowered;
  /// @notice Query the release time of a unique growth period
  /// @dev When a corresponding growth amount exists for the period, zero indicates the growth was either immediate or canceled
  mapping (uint32 => uint256) public growthRelease;
  /// @notice Query the amount of growth requested for a period
  mapping (uint32 => uint256) public growthAmount;

  uint256[2] public _unused1_; // Storage slot no longer used but must not be removed
  uint256 public numActiveAuthors;
  uint256 public nextAuthorId;
  uint256 public growthDelay;
  address public coreToken;
  address internal _unused2_; // Storage slot no longer used but must not be removed
  bool public authorsEnabled;
  bool public liftingEnabled;
  bool public loweringEnabled;

  error LiftDisabled();
  error AuthorsDisabled();
  error MissingKeys();
  error AddressInUse(address t1Address);
  error T2KeyInUse(bytes32 t2PubKey);
  error AddressMismatch(address t1Address, bytes t1PubKey);
  error SetCoreOwnerFailed();
  error AmountIsZero();
  error PeriodIsUsed();
  error OwnerOnly();
  error GrowthUnavailable();
  error NotReady(uint256 releaseTime);
  error InvalidT1Key();
  error AlreadyAdded();
  error CannotChangeT2Key(bytes32 existingT2PubKey);
  error NotAnAuthor();
  error RootHashIsUsed();
  error LiftLimitHit();
  error InvalidRecipient();
  error InvalidERC777();
  error LowerDisabled();
  error InvalidTxData();
  error LowerIsUsed();
  error UnsignedTx();
  error NotALowerTx();
  error PaymentFailed();
  error CoreMintFailed();
  error BadConfirmations();
  error TxIdIsUsed();
  error InvalidT2Key();
  error WindowExpired();

  function initialize(address _coreToken)
    public
    initializer
  {
    assert(_coreToken != address(0));
    __Ownable_init();
    coreToken = _coreToken;
    ERC1820_REGISTRY.setInterfaceImplementer(address(this), ERC777_TOKENS_RECIPIENT_HASH, address(this));
    numBytesToLowerData[0x5900] = 133; // callID (2 bytes) + proof (2 prefix + 32 relayer + 32 signer + 1 prefix + 64 signature)
    numBytesToLowerData[0x5700] = 133; // callID (2 bytes) + proof (2 prefix + 32 relayer + 32 signer + 1 prefix + 64 signature)
    numBytesToLowerData[0x5702] = 2;   // callID (2 bytes)
    authorsEnabled = true;
    liftingEnabled = true;
    loweringEnabled = true;
    nextAuthorId = 1;
    growthDelay = 7 days;
  }

  modifier onlyWhenLiftingEnabled() {
    if (!liftingEnabled) revert LiftDisabled();
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

  /// @notice Bulk initialise a set of authors
  /// @param t1Address Array of Ethereum addresses
  /// @param t1PubKeyLHS Array of 32 leftmost bytes of Ethereum public keys corresponding to addresses
  /// @param t1PubKeyRHS Array of 32 rightmost bytes of Ethereum public keys corresponding to addresses
  /// @param t2PubKey Array of 32 byte sr25519 public key values
  /// @dev This is useful for setting up existing networks, after which addAuthor should be used instead
  function loadAuthors(address[] calldata t1Address, bytes32[] calldata t1PubKeyLHS, bytes32[] calldata t1PubKeyRHS,
      bytes32[] calldata t2PubKey)
    onlyOwner
    external
  {
    uint256 numToLoad = t1Address.length;
    bytes32 _t2PubKey;
    address _t1Address;
    bytes memory t1PubKey;

    if (t1PubKeyLHS.length != numToLoad && t1PubKeyRHS.length != numToLoad && t2PubKey.length != numToLoad) {
      revert MissingKeys();
    }

    for (uint256 i; i < numToLoad;) {
      _t1Address = t1Address[i];
      _t2PubKey = t2PubKey[i];
      if (t1AddressToId[_t1Address] != 0) revert AddressInUse(_t1Address);
      if (t2PubKeyToId[_t2PubKey] != 0) revert T2KeyInUse(_t2PubKey);
      t1PubKey = abi.encode(t1PubKeyLHS[i], t1PubKeyRHS[i]);
      if (address(uint160(uint256(keccak256(t1PubKey)))) != _t1Address) revert AddressMismatch(_t1Address, t1PubKey);
      idToT1Address[nextAuthorId] = _t1Address;
      idToT2PubKey[nextAuthorId] = _t2PubKey;
      t1AddressToId[_t1Address] = nextAuthorId;
      t2PubKeyToId[_t2PubKey] = nextAuthorId;
      isAuthor[nextAuthorId] = true;
      authorIsActive[nextAuthorId] = true;
      unchecked {
        ++numActiveAuthors;
        ++nextAuthorId;
        ++i;
      }
    }
  }

  /// @notice Sets the owner of the associated core token contract to the owner of this contract
  /// @dev Note: Growth depends upon this contract owning the core token contract, so it cannot occur until the owner of the
  /// core token contract is set back to this contract
  function setCoreOwner()
    onlyOwner
    external
  {
    (bool success, ) = coreToken.call(abi.encodeWithSignature("setOwner(address)", msg.sender));
    if (!success) revert SetCoreOwnerFailed();
  }

  /// @notice Cancel a single growth period, preventing that period's growth from ever being released
  /// @param period Period to deny growth for
  /// @dev Sets the release time for an unreleased growth period to zero (the growthAmount persists to lock that period)
  function denyGrowth(uint32 period)
    onlyOwner
    external
  {
    growthRelease[period] = 0;
    emit LogGrowthDenied(period);
  }

  /// @notice Set the amount of time that must pass between triggering and releasing any future period's growth
  /// @param delaySeconds Delay in whole seconds
  function setGrowthDelay(uint256 delaySeconds)
    onlyOwner
    external
  {
    emit LogGrowthDelayUpdated(growthDelay, delaySeconds);
    growthDelay = delaySeconds;
  }

  /// @notice Switch all author functions on or off
  /// @param state true = functions on, false = functions off
  function toggleAuthors(bool state)
    onlyOwner
    external
  {
    authorsEnabled = state;
    emit LogAuthorsEnabled(state);
  }

  /// @notice Switch all lifting functions on or off
  /// @param state true = functions on, false = functions off
  function toggleLifting(bool state)
    onlyOwner
    external
  {
    liftingEnabled = state;
    emit LogLiftingEnabled(state);
  }

  /// @notice Switch the lower function on or off
  /// @param state true = function on, false = function off
  function toggleLowering(bool state)
    onlyOwner
    external
  {
    loweringEnabled = state;
    emit LogLoweringEnabled(state);
  }

  /// @notice Add or update T2 lower methods
  /// @param callId the call index of the extrinsic in T2
  /// @param numBytes the distance (in bytes) required to reach relevant lower data arguments encoded within a transaction leaf
  function updateLowerCall(bytes2 callId, uint256 numBytes)
    onlyOwner
    external
  {
    numBytesToLowerData[callId] = numBytes;
    emit LogLowerCallUpdated(callId, numBytes);
  }

  /// @notice Initialise inflating the core token supply by the specified amount
  /// @param rewards Total amount of rewards generated in the period
  /// @param avgStaked Average amount staked in the period
  /// @param period Unique growth period
  /// @param expiry Timestamp by which the function must be called
  /// @param t2TxId Unique transaction ID
  /// @param confirmations Concatenated author-signed confirmations of the transaction details
  /** @dev
    Immediate growth release occurs when called by the owner (passing zero for t2TxId and empty confirmations bytes).
    Immediate growth release occurs when called by the authors, IFF the current growthDelay is set to zero.
    In these immediate cases a growth event is then emitted to be read by T2.
    Otherwise, values are stored to be released at a later time, determined by the current value of growthDelay.
  */
  function triggerGrowth(uint128 rewards, uint128 avgStaked, uint32 period, uint256 expiry, uint32 t2TxId, bytes calldata confirmations)
    onlyWhenAuthorsEnabled
    onlyWithinCallWindow(expiry)
    external
  {
    if (rewards == 0 || avgStaked == 0) revert AmountIsZero();
    if (growthAmount[period] != 0) revert PeriodIsUsed();
    uint256 amount = rewards * IERC20(coreToken).totalSupply() / avgStaked;
    growthAmount[period] = amount;

    if (confirmations.length == 0) {
      if (msg.sender != owner()) revert OwnerOnly();
      _releaseGrowth(amount, period);
    } else {
      _verifyConfirmations(keccak256(abi.encode(rewards, avgStaked, period, expiry, t2TxId)), confirmations);
      _storeT2TxId(t2TxId);
      uint256 releaseTime = block.timestamp;
      if (growthDelay == 0) {
        _releaseGrowth(amount, period);
      } else {
        unchecked { releaseTime += growthDelay; }
        growthRelease[period] = releaseTime;
      }
      emit LogGrowthTriggered(amount, period, releaseTime, t2TxId);
    }
  }

  /// @notice Release the requested growth for a period
  /// @param period Unique growth period
  /** @dev
    This mints the core token amount requested to this contract, locking it and emitting a growth event to be read by T2.
    This function can be called by anyone but will only succeed if the release time has passed.
  */
  function releaseGrowth(uint32 period)
    external
  {
    uint256 releaseTime = growthRelease[period];
    if (releaseTime == 0) revert GrowthUnavailable();
    if (block.timestamp < releaseTime) revert NotReady(releaseTime);
    growthRelease[period] = 0;
    _releaseGrowth(growthAmount[period], period);
  }

  /// @notice Add a new author, allowing them to participate in consensus
  /// @param t1PubKey 64 byte Ethereum public key of author
  /// @param t2PubKey 32 byte sr25519 public key of author
  /// @param expiry Timestamp by which the function must be called
  /// @param t2TxId Unique transaction ID
  /// @param confirmations Concatenated author-signed confirmations of the transaction details
  /** @dev
    This permanently associates the author's T1 Ethereum address with their T2 public key.
    May also be used to re-add a previously removed author, providing their associated accounts do not change.
    Does not immediately activate the author.
    Activation instead occurs upon receiving the first set of confirmations which include the newly added author.
    Emits an author added event to be read by T2.
  */
  function addAuthor(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations)
    onlyWhenAuthorsEnabled
    onlyWithinCallWindow(expiry)
    external
  {
    if (t1PubKey.length != 64) revert InvalidT1Key();
    address t1Address = address(uint160(uint256(keccak256(t1PubKey))));
    uint256 id = t1AddressToId[t1Address];
    if (isAuthor[id]) revert AlreadyAdded();

    _verifyConfirmations(keccak256(abi.encode(t1PubKey, t2PubKey, expiry, t2TxId)), confirmations);
    _storeT2TxId(t2TxId);

    if (id == 0) {
      if (t2PubKeyToId[t2PubKey] != 0) revert T2KeyInUse(t2PubKey);
      id = nextAuthorId;
      idToT1Address[id] = t1Address;
      t1AddressToId[t1Address] = id;
      idToT2PubKey[id] = t2PubKey;
      t2PubKeyToId[t2PubKey] = id;
      unchecked { ++nextAuthorId; }
    } else {
      if (t2PubKey != idToT2PubKey[id]) revert CannotChangeT2Key(idToT2PubKey[id]);
    }

    isAuthor[id] = true;

    emit LogAuthorAdded(t1Address, t2PubKey, t2TxId);
  }

  /// @notice Remove and deactivate an author, excluding them from consensus
  /// @param t2PubKey 32 byte sr25519 public key of author
  /// @param t1PubKey 64 byte Ethereum public key of author
  /// @param expiry Timestamp by which the function must be called
  /// @param t2TxId Unique transaction ID
  /// @param confirmations Concatenated author-signed confirmations of the transaction details
  /** @dev
    Author details are retained.
    Emits an author removal event to be read by T2.
  */
  function removeAuthor(bytes32 t2PubKey, bytes calldata t1PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations)
    onlyWhenAuthorsEnabled
    onlyWithinCallWindow(expiry)
    external
  {
    uint256 id = t2PubKeyToId[t2PubKey];
    if (!isAuthor[id]) revert NotAnAuthor();

    isAuthor[id] = false;

    if (authorIsActive[id]) {
      authorIsActive[id] = false;
      unchecked { --numActiveAuthors; }
    }

    _verifyConfirmations(keccak256(abi.encode(t2PubKey, t1PubKey, expiry, t2TxId)), confirmations);
    _storeT2TxId(t2TxId);

    emit LogAuthorRemoved(idToT1Address[id], t2PubKey, t2TxId);
  }

  /// @notice Stores a Merkle tree root hash representing the latest set of transactions to have occurred on T2
  /// @param rootHash 32 byte keccak256 hash of the Merkle tree root
  /// @param expiry Timestamp by which the function must be called
  /// @param t2TxId Unique transaction ID
  /// @param confirmations Concatenated author-signed confirmations of the transaction details
  /// @dev Emits a root published event to be read by T2
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations)
    onlyWhenAuthorsEnabled
    onlyWithinCallWindow(expiry)
    external
  {
    if (isPublishedRootHash[rootHash]) revert RootHashIsUsed();
    _verifyConfirmations(keccak256(abi.encode(rootHash, expiry, t2TxId)), confirmations);
    _storeT2TxId(t2TxId);
    isPublishedRootHash[rootHash] = true;
    emit LogRootPublished(rootHash, t2TxId);
  }

  /// @notice Lift an amount of ERC20 tokens to the specified T2 recipient, providing the amount has first been approved
  /// @param erc20Address address of the ERC20 token contract
  /// @param t2PubKey 32 byte sr25519 public key value of the T2 recipient account
  /// @param amount of token to lift (in the token's full decimals)
  /** @dev
    Locks the tokens in the contract and emits a corresponding lift event to be read by T2.
    Fails if no recipient is specified (though only the byte length of the recipient can be checked so care is required).
    Fails if it causes the total amount of the token held in this contract to exceed uint128 max (this is a T2 constraint).
  */
  function lift(address erc20Address, bytes calldata t2PubKey, uint256 amount)
    onlyWhenLiftingEnabled
    external
  {
    if (amount == 0) revert AmountIsZero();
    assert(IERC20(erc20Address).transferFrom(msg.sender, address(this), amount));
    if (IERC20(erc20Address).balanceOf(address(this)) > LIFT_LIMIT) revert LiftLimitHit();
    emit LogLifted(erc20Address, _checkT2PubKey(t2PubKey), amount);
  }

  /// @notice Lift all ETH sent to the specified T2 recipient
  /// @param t2PubKey 32 byte sr25519 public key value of the T2 recipient account
  /** @dev
    Locks the ETH in the contract and emits a corresponding lift event to be read by T2.
    Fails if no recipient is specified (though only the byte length of the recipient can be checked so care is required).
  */
  function liftETH(bytes calldata t2PubKey)
    payable
    onlyWhenLiftingEnabled
    external
  {
    if (msg.value == 0) revert AmountIsZero();
    emit LogLifted(PSEUDO_ETH_ADDRESS, _checkT2PubKey(t2PubKey), msg.value);
  }

  /// @notice Lifts all ERC777 tokens received to the T2 recipient specified in the data payload
  /// @param data 32 byte sr25519 public key value of the T2 recipient account
  /** @dev
    This function is not called directly by users.
    It is called when ERC777 tokens are sent to this contract using either send or operatorSend, passing the recipient as "data".
    Fails if no recipient is specified (though only the byte length of the recipient can be checked so care is required).
    Fails if it causes the total amount of the token held in this contract to exceed uint128 max (this is a T2 constraint).
    Emits a corresponding lift event to be read by T2.
  */
  function tokensReceived(address operator, address /* from */, address to, uint256 amount, bytes calldata data,
      bytes calldata /* operatorData */)
    onlyWhenLiftingEnabled
    external
  {
    if (operator == address(this)) return; // internally triggered by calling transferFrom in a lift so we don't lift again here
    if (amount == 0) revert AmountIsZero();
    if (to != address(this)) revert InvalidRecipient();
    if (ERC1820_REGISTRY.getInterfaceImplementer(msg.sender, ERC777_TOKEN_HASH) != msg.sender) revert InvalidERC777();
    if (IERC777(msg.sender).balanceOf(address(this)) > LIFT_LIMIT) revert LiftLimitHit();
    emit LogLifted(msg.sender, _checkT2PubKey(data), amount);
  }

  /// @notice Unlock ERC20/ERC777/ETH to the recipient specified in the transaction leaf, providing the T2 state is published
  /// @param leaf Raw encoded T2 transaction data
  /// @param merklePath Array of hashed leaves lying between the transaction leaf and the Merkle tree root hash
  /// @dev Anyone may call this method since the recipient of the tokens is governed by the content of the leaf
  function lower(bytes calldata leaf, bytes32[] calldata merklePath)
    external
  {
    if (!loweringEnabled) revert LowerDisabled();
    bytes32 leafHash = keccak256(leaf);
    if (!confirmTransaction(leafHash, merklePath)) revert InvalidTxData();
    if (hasLowered[leafHash]) revert LowerIsUsed();
    hasLowered[leafHash] = true;

    uint256 ptr;

    // Determine the position of the Call ID in the leaf:
    unchecked {
      ptr += _getCompactIntegerByteSize(leaf[0]); // add number of bytes encoding the leaf length
      if (leaf[ptr] & 0x80 == 0x0) revert UnsignedTx(); // bitwise version check to ensure leaf is a signed tx
      // add version(1) + multiAddress type(1) + sender(32) + curve type(1) + signature(64) = 99 bytes to check era bytes:
      ptr += leaf[ptr + 99] == 0x0 ? 100 : 101; // add 99 + number of era bytes (immortal is 1, otherwise 2)
      ptr += _getCompactIntegerByteSize(leaf[ptr]); // add number of bytes encoding the nonce
      ptr += _getCompactIntegerByteSize(leaf[ptr]); // add number of bytes encoding the tip
    }

    bytes2 callId;

    // Retrieve the Call ID from the leaf:
    assembly {
      ptr := add(ptr, leaf.offset)
      callId := calldataload(ptr)
    }

    uint256 numBytesToSkip = numBytesToLowerData[callId]; // get the number of bytes between the pointer and the lower arguments
    if (numBytesToSkip == 0) revert NotALowerTx(); // we don't recognise this Call ID as a lower so revert

    bytes32 t2PubKey;
    address token;
    uint128 amount;
    address t1Address;

    assembly {
      ptr := add(ptr, numBytesToSkip) // skip the required number of bytes to point to the start of lower transaction arguments
      t2PubKey := calldataload(ptr) // load next 32 bytes into 32 byte type starting at ptr
      token := calldataload(add(ptr, 20)) // load leftmost 20 of next 32 bytes into 20 byte type starting at ptr + 20
      amount := calldataload(add(ptr, 36)) // load leftmost 16 of next 32 bytes into 16 byte type starting at ptr + 20 + 16
      t1Address := calldataload(add(ptr, 56)) // load leftmost 20 of next 32 bytes type starting at ptr + 20 + 16 + 20

      // the amount was encoded in little endian so reverse it to big endian:
      amount := or(shr(8, and(amount, 0xFF00FF00FF00FF00FF00FF00FF00FF00)), shl(8, and(amount, 0x00FF00FF00FF00FF00FF00FF00FF00FF)))
      amount := or(shr(16, and(amount, 0xFFFF0000FFFF0000FFFF0000FFFF0000)), shl(16, and(amount, 0x0000FFFF0000FFFF0000FFFF0000FFFF)))
      amount := or(shr(32, and(amount, 0xFFFFFFFF00000000FFFFFFFF00000000)), shl(32, and(amount, 0x00000000FFFFFFFF00000000FFFFFFFF)))
      amount := or(shr(64, amount), shl(64, amount))
    }

    if (token == PSEUDO_ETH_ADDRESS) {
      (bool success, ) = payable(t1Address).call{value: amount}("");
      if (!success) revert PaymentFailed();
    } else {
      try IERC777(token).send(t1Address, amount, "") {
      } catch {
        assert(IERC20(token).transfer(t1Address, amount));
      }
    }

    emit LogLoweredFrom(t2PubKey);
  }

  /// @notice Confirm the existence of any T2 transaction in a published root
  /// @param leafHash keccak256 hash of a raw encoded T2 transaction leaf
  /// @param merklePath Array of hashed leaves lying between the transaction leaf and the Merkle tree root hash
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath)
    public
    view
    returns (bool)
  {
    bytes32 node;
    uint256 i;

    do {
      node = merklePath[i];
      leafHash = leafHash < node ? keccak256(abi.encode(leafHash, node)) : keccak256(abi.encode(node, leafHash));
      unchecked { ++i; }
    } while (i < merklePath.length);

    return isPublishedRootHash[leafHash];
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  function _releaseGrowth(uint256 amount, uint32 period)
    private
  {
    if (IERC20(coreToken).balanceOf(address(this)) + amount > LIFT_LIMIT) revert LiftLimitHit();
    (bool success, ) = coreToken.call(abi.encodeWithSignature("mint(uint128)", amount));
    if (!success) revert CoreMintFailed();
    emit LogGrowth(amount, period);
  }

  // reference: https://docs.substrate.io/v3/advanced/scale-codec/#compactgeneral-integers
  function _getCompactIntegerByteSize(bytes1 checkByte)
    private
    pure
    returns (uint8 result)
  {
    result = uint8(checkByte);
    assembly {
      switch and(result, 3)
      case 0 { result := 1 } // single-byte mode
      case 1 { result := 2 } // two-byte mode
      case 2 { result := 4 } // four-byte mode
      default { result := add(shr(2, result), 5) } // upper 6 bits + 4 = number of bytes to follow + 1 for checkbyte
    }
  }

  function _requiredConfirmations()
    private
    view
    returns (uint256 required)
  {
    required = numActiveAuthors;
    unchecked { required -= required * 2 / 3; }
  }

  function _verifyConfirmations(bytes32 msgHash, bytes calldata confirmations)
    private
  {
    uint256[] memory confirmed = new uint256[](nextAuthorId);
    bytes32 ethSignedPrefixMsgHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
    uint256 requiredConfirmations = _requiredConfirmations();
    uint256 id = t1AddressToId[msg.sender];
    uint256 numConfirmations;
    unchecked { numConfirmations = 1 + confirmations.length / SIGNATURE_LENGTH; } // The sender's confirmation is implicit
    uint256 validConfirmations;
    uint256 i;
    bytes32 r;
    bytes32 s;
    uint8 v;

    do {
      if (!authorIsActive[id]) {
        if (isAuthor[id]) { // Here we activate any previously added but as yet unactivated authors
          authorIsActive[id] = true;
          unchecked {
            ++numActiveAuthors;
            ++validConfirmations;
          }
          requiredConfirmations = _requiredConfirmations();
          if (validConfirmations == requiredConfirmations) return;
          confirmed[id] = 1;
        }
      } else if (confirmed[id] == 0) {
        unchecked { ++validConfirmations; }
        if (validConfirmations == requiredConfirmations) return;
        confirmed[id] = 1;
      }

      assembly {
        let sig := add(confirmations.offset, mul(i, SIGNATURE_LENGTH))
        r := calldataload(sig)
        s := calldataload(add(sig, 32))
        v := byte(0, calldataload(add(sig, 64)))
        i := add(i, 1)
      }

      if (v < 27) { unchecked { v += 27; } }

      id = v < 29 && uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
        ? t1AddressToId[ecrecover(ethSignedPrefixMsgHash, v, r, s)]
        : 0;

    } while (i < numConfirmations);

    revert BadConfirmations();
  }

  function _storeT2TxId(uint256 t2TxId)
    private
  {
    if (isUsedT2TxId[t2TxId]) revert TxIdIsUsed();
    isUsedT2TxId[t2TxId] = true;
  }

  function _checkT2PubKey(bytes calldata t2PubKey)
    private
    pure
    returns (bytes32 checkedT2PubKey)
  {
    if (t2PubKey.length != 32) revert InvalidT2Key();
    checkedT2PubKey = bytes32(t2PubKey);
  }
}
