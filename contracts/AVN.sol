// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./interfaces/IAVN.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC777.sol";
import "@openzeppelin/contracts/interfaces/IERC777Recipient.sol";
import "@openzeppelin/contracts/interfaces/IERC1820Registry.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract AVN is IAVN, IERC777Recipient, Initializable, UUPSUpgradeable, OwnableUpgradeable {
  // Universal address as defined in Registry Contract Address section of https://eips.ethereum.org/EIPS/eip-1820
  IERC1820Registry constant internal ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);
  // keccak256("ERC777Token")
  bytes32 constant internal ERC777_TOKEN_HASH = 0xac7fbab5f54a3ca8194167523c6753bfeb96a445279294b6125b68cce2177054;
  // keccak256("ERC777TokensRecipient")
  bytes32 constant internal ERC777_TOKENS_RECIPIENT_HASH = 0xb281fc8c12954d22544db45de3159a39272895b169a852b314f9cc762e44c53b;
  uint256 constant internal SIGNATURE_LENGTH = 65;
  uint256 constant internal LIFT_LIMIT = type(uint128).max;
  address constant internal PSEUDO_ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  mapping (uint256 => bool) public isRegisteredValidator;
  mapping (uint256 => bool) public isActiveValidator;
  mapping (address => uint256) public t1AddressToId;
  mapping (bytes32 => uint256) public t2PublicKeyToId;
  mapping (uint256 => address) public idToT1Address;
  mapping (uint256 => bytes32) public idToT2PublicKey;
  mapping (bytes2 => uint256) public numBytesToLowerData;
  mapping (bytes32 => bool) public isPublishedRootHash;
  mapping (uint256 => bool) public isUsedT2TransactionId;
  mapping (bytes32 => bool) public hasLowered;
  mapping (bytes32 => bool) public hasLifted;

  uint256[2] public quorum;
  uint256 public numActiveValidators;
  uint256 public nextValidatorId;
  uint32 public growthPeriod;
  address public coreToken;
  address internal priorInstance;
  bool public validatorFunctionsAreEnabled;
  bool public liftingIsEnabled;
  bool public loweringIsEnabled;

  function initialize(address _coreToken, address _priorInstance)
    public
    initializer
  {
    require(_coreToken != address(0), "Core token not specified");
    __Ownable_init();
    coreToken = _coreToken;
    priorInstance = _priorInstance; // We allow address(0) for no prior instance
    ERC1820_REGISTRY.setInterfaceImplementer(address(this), ERC777_TOKENS_RECIPIENT_HASH, address(this));
    // TODO: Set the lower IDs correctly
    numBytesToLowerData[0x2d00] = 133; // callID (2 bytes) + proof (2 prefix + 32 relayer + 32 signer + 1 prefix + 64 signature)
    numBytesToLowerData[0x2700] = 133; // callID (2 bytes) + proof (2 prefix + 32 relayer + 32 signer + 1 prefix + 64 signature)
    numBytesToLowerData[0x2702] = 2;   // callID (2 bytes)
    validatorFunctionsAreEnabled = true;
    liftingIsEnabled = true;
    loweringIsEnabled = true;
    nextValidatorId = 1;
    growthPeriod = 1;
    quorum[0] = 2;
    quorum[1] = 3;
  }

  modifier onlyWhenLiftingIsEnabled() {
    require(liftingIsEnabled, "Lifting currently disabled");
    _;
  }

  modifier onlyWhenValidatorFunctionsAreEnabled() {
    require(validatorFunctionsAreEnabled, "Function currently disabled");
    _;
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  function loadValidators(address[] calldata t1Address, bytes32[] calldata t1PublicKeyLHS, bytes32[] calldata t1PublicKeyRHS,
      bytes32[] calldata t2PublicKey)
    onlyOwner
    external
  {
    require(t1Address.length == t1PublicKeyLHS.length && t1PublicKeyLHS.length == t1PublicKeyRHS.length
        && t1PublicKeyRHS.length == t2PublicKey.length, "Validator keys missing");

    bytes memory t1PublicKey;

    for (uint256 i; i < t1Address.length; i++) {
      require(t1AddressToId[t1Address[i]] == 0, "T1Address already in use");
      require(t2PublicKeyToId[t2PublicKey[i]] == 0, "T2PublicKey already in use");
      t1PublicKey = abi.encodePacked(t1PublicKeyLHS[i], t1PublicKeyRHS[i]);
      require(address(uint160(uint256(keccak256(t1PublicKey)))) == t1Address[i], "T1 account mismatch");
      idToT1Address[nextValidatorId] = t1Address[i];
      idToT2PublicKey[nextValidatorId] = t2PublicKey[i];
      t1AddressToId[t1Address[i]] = nextValidatorId;
      t2PublicKeyToId[t2PublicKey[i]] = nextValidatorId;
      isRegisteredValidator[nextValidatorId] = true;
      isActiveValidator[nextValidatorId] = true;
      numActiveValidators++;
      nextValidatorId++;
    }
  }

  function setQuorum(uint256[2] memory _quorum)
    onlyOwner
    public
  {
    require(_quorum[1] != 0, "Invalid: div by zero");
    require(_quorum[0] <= _quorum[1], "Invalid: above 100%");
    quorum = _quorum;
    emit LogQuorumUpdated(quorum);
  }

  function enableValidatorFunctions(bool status)
    onlyOwner
    external
  {
    validatorFunctionsAreEnabled = status;
    emit LogValidatorFunctionsAreEnabled(status);
  }

  function enableLifting(bool status)
    onlyOwner
    external
  {
    liftingIsEnabled = status;
    emit LogLiftingIsEnabled(status);
  }

  function enableLowering(bool status)
    onlyOwner
    external
  {
    loweringIsEnabled = status;
    emit LogLoweringIsEnabled(status);
  }

  function updateLowerCall(bytes2 callId, uint256 numBytes)
    onlyOwner
    external
  {
    numBytesToLowerData[callId] = numBytes;
    emit LogLowerCallUpdated(callId, numBytes);
  }

  receive() payable external {
    require(msg.sender == priorInstance, "Cannot accept ETH unless lifting");
  }

  function triggerGrowth(uint256 amount)
    onlyOwner
    external
  {
    require(amount > 0, "Cannot trigger zero growth");
    assert(IERC20(coreToken).transferFrom(owner(), address(this), amount));
    uint256 newBalance = IERC20(coreToken).balanceOf(address(this));
    require(newBalance <= LIFT_LIMIT, "Exceeds limit");
    emit LogGrowth(amount, growthPeriod++);
  }

  function registerValidator(bytes memory t1PublicKey, bytes32 t2PublicKey, uint256 t2TransactionId,
      bytes calldata confirmations)
    onlyWhenValidatorFunctionsAreEnabled
    external
  {
    require(t1PublicKey.length == 64, "T1 public key must be 64 bytes");
    address t1Address = address(uint160(uint256(keccak256(t1PublicKey))));
    uint256 id = t1AddressToId[t1Address];
    require(isRegisteredValidator[id] == false, "Validator is already registered");

    // The order of the elements is the reverse of the deregisterValidatorHash
    bytes32 registerValidatorHash = keccak256(abi.encodePacked(t1PublicKey, t2PublicKey));
    verifyConfirmations(toConfirmationHash(registerValidatorHash, t2TransactionId), confirmations);
    doStoreT2TransactionId(t2TransactionId);

    if (id == 0) {
      require(t2PublicKeyToId[t2PublicKey] == 0, "T2 public key already in use");
      id = nextValidatorId;
      idToT1Address[id] = t1Address;
      t1AddressToId[t1Address] = id;
      idToT2PublicKey[id] = t2PublicKey;
      t2PublicKeyToId[t2PublicKey] = id;
      nextValidatorId++;
    } else {
      require(idToT2PublicKey[id] == t2PublicKey, "Cannot change T2 public key");
    }

    isRegisteredValidator[id] = true;

    bytes32 t1PublicKeyLHS;
    bytes32 t1PublicKeyRHS;
    assembly {
      t1PublicKeyLHS := mload(add(t1PublicKey, 0x20))
      t1PublicKeyRHS := mload(add(t1PublicKey, 0x40))
    }

    emit LogValidatorRegistered(t1PublicKeyLHS, t1PublicKeyRHS, t2PublicKey, t2TransactionId);
  }

  function deregisterValidator(bytes memory t1PublicKey, bytes32 t2PublicKey, uint256 t2TransactionId,
      bytes calldata confirmations)
    onlyWhenValidatorFunctionsAreEnabled
    external
  {
    uint256 id = t2PublicKeyToId[t2PublicKey];
    require(isRegisteredValidator[id], "Validator is not registered");

    // The order of the elements is the reverse of the registerValidatorHash
    bytes32 deregisterValidatorHash = keccak256(abi.encodePacked(t2PublicKey, t1PublicKey));
    verifyConfirmations(toConfirmationHash(deregisterValidatorHash, t2TransactionId), confirmations);
    doStoreT2TransactionId(t2TransactionId);

    isRegisteredValidator[id] = false;
    isActiveValidator[id] = false;
    numActiveValidators--;

    bytes32 t1PublicKeyLHS;
    bytes32 t1PublicKeyRHS;
    assembly {
      t1PublicKeyLHS := mload(add(t1PublicKey, 0x20))
      t1PublicKeyRHS := mload(add(t1PublicKey, 0x40))
    }

    emit LogValidatorDeregistered(t1PublicKeyLHS, t1PublicKeyRHS, t2PublicKey, t2TransactionId);
  }

  function publishRoot(bytes32 rootHash, uint256 t2TransactionId, bytes calldata confirmations)
    onlyWhenValidatorFunctionsAreEnabled
    external
  {
    verifyConfirmations(toConfirmationHash(rootHash, t2TransactionId), confirmations);
    doStoreT2TransactionId(t2TransactionId);
    require(isPublishedRootHash[rootHash] == false, "Root already exists");
    isPublishedRootHash[rootHash] = true;
    emit LogRootPublished(rootHash, t2TransactionId);
  }

  function getIsPublishedRootHash(bytes32 rootHash)
    external
    view
    returns (bool)
  {
    return isPublishedRootHash[rootHash];
  }

  function lift(address erc20Address, bytes calldata t2PublicKey, uint256 amount)
    onlyWhenLiftingIsEnabled
    external
  {
    doLift(erc20Address, msg.sender, t2PublicKey, amount);
  }

  function proxyLift(address erc20Address, bytes calldata t2PublicKey, uint256 amount, address approver, uint256 proofNonce,
      bytes calldata proof)
    onlyWhenLiftingIsEnabled
    external
  {
    if (msg.sender != approver) {
      bytes32 proofHash = keccak256(proof);
      require(hasLifted[proofHash] == false, "Lift proof already used");
      hasLifted[proofHash] = true;
      bytes32 msgHash = keccak256(abi.encodePacked(erc20Address, t2PublicKey, amount, proofNonce));
      address signer = recoverSigner(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)), proof);
      require(signer == approver, "Lift proof invalid");
    }
    doLift(erc20Address, approver, t2PublicKey, amount);
  }

  function liftETH(bytes calldata t2PublicKey)
    payable
    onlyWhenLiftingIsEnabled
    external
  {
    bytes32 checkedT2PublicKey = checkT2PublicKey(t2PublicKey);
    require(msg.value > 0, "Cannot lift zero ETH");
    emit LogLifted(PSEUDO_ETH_ADDRESS, msg.sender, checkedT2PublicKey, msg.value);
  }

  // ERC-777 automatic lifting
  function tokensReceived(address /* operator */, address from, address to, uint256 amount, bytes calldata data,
      bytes calldata /* operatorData */)
    onlyWhenLiftingIsEnabled
    external
  {
    if (from == priorInstance) return; // recovering funds so we don't lift here
    if (data.length == 0 && from == owner() && msg.sender == address(coreToken)) return; // growth action so we don't lift here
    require(to == address(this), "Tokens must be sent to this contract");
    require(amount > 0, "Cannot lift zero ERC777 tokens");
    bytes32 checkedT2PublicKey = checkT2PublicKey(data);
    require(ERC1820_REGISTRY.getInterfaceImplementer(msg.sender, ERC777_TOKEN_HASH) == msg.sender, "Token must be registered");
    IERC777 erc777Contract = IERC777(msg.sender);
    require(erc777Contract.balanceOf(address(this)) <= LIFT_LIMIT, "Exceeds ERC777 lift limit");
    emit LogLifted(msg.sender, from, checkedT2PublicKey, amount);
  }

  function lower(bytes memory leaf, bytes32[] calldata merklePath)
    external
  {
    require(loweringIsEnabled, "Lowering currently disabled");
    bytes32 leafHash = keccak256(leaf);
    require(confirmAvnTransaction(leafHash, merklePath), "Leaf or path invalid");
    require(hasLowered[leafHash] == false, "Already lowered");
    hasLowered[leafHash] = true;

    uint256 ptr;
    ptr += getCompactIntegerByteSize(leaf[ptr]); // add number of bytes encoding the leaf length
    require(uint8(leaf[ptr]) & 128 != 0, "Unsigned transaction"); // bitwise version check to ensure leaf is signed transaction
    ptr += 99; // version (1 byte) + multiAddress type (1 byte) + sender (32 bytes) + curve type (1 byte) + signature (64 bytes)
    ptr += leaf[ptr] == 0x00 ? 1 : 2; // add number of era bytes (immortal is 1, otherwise 2)
    ptr += getCompactIntegerByteSize(leaf[ptr]); // add number of bytes encoding the nonce
    ptr += getCompactIntegerByteSize(leaf[ptr]); // add number of bytes encoding the tip
    ptr += 32; // account for the first 32 EVM bytes holding the leaf's length

    bytes2 callId;

    assembly {
      callId := mload(add(leaf, ptr))
    }

    require(numBytesToLowerData[callId] != 0, "Not a lower leaf");
    ptr += numBytesToLowerData[callId];
    bytes32 t2PublicKey;
    address token;
    uint128 amount;
    address t1Address;

    assembly {
      t2PublicKey := mload(add(leaf, ptr)) // load next 32 bytes into 32 byte type starting at ptr
      token := mload(add(add(leaf, 20), ptr)) // load leftmost 20 of next 32 bytes into 20 byte type starting at ptr + 20
      amount := mload(add(add(leaf, 36), ptr)) // load leftmost 16 of next 32 bytes into 16 byte type starting at ptr + 20 + 16
      t1Address := mload(add(add(leaf, 56), ptr)) // load leftmost 20 of next 32 bytes type starting at ptr + 20 + 16 + 20
    }

    // amount was encoded in little endian so we need to reverse to big endian:
    amount = ((amount & 0xFF00FF00FF00FF00FF00FF00FF00FF00) >> 8) | ((amount & 0x00FF00FF00FF00FF00FF00FF00FF00FF) << 8);
    amount = ((amount & 0xFFFF0000FFFF0000FFFF0000FFFF0000) >> 16) | ((amount & 0x0000FFFF0000FFFF0000FFFF0000FFFF) << 16);
    amount = ((amount & 0xFFFFFFFF00000000FFFFFFFF00000000) >> 32) | ((amount & 0x00000000FFFFFFFF00000000FFFFFFFF) << 32);
    amount = (amount >> 64) | (amount << 64);

    if (token == PSEUDO_ETH_ADDRESS) {
      (bool success, ) = payable(t1Address).call{value: amount}("");
      require(success, "ETH transfer failed");
    } else if (ERC1820_REGISTRY.getInterfaceImplementer(token, ERC777_TOKEN_HASH) == token) {
      IERC777(token).send(t1Address, amount, "");
    } else {
      assert(IERC20(token).transfer(t1Address, amount));
    }

    emit LogLowered(token, t1Address, t2PublicKey, amount);
  }

  function confirmAvnTransaction(bytes32 leafHash, bytes32[] memory merklePath)
    public
    view
    returns (bool)
  {
    bytes32 rootHash = leafHash;

    for (uint256 i; i < merklePath.length; i++) {
      bytes32 node = merklePath[i];
      if (rootHash < node)
        rootHash = keccak256(abi.encode(rootHash, node));
      else
        rootHash = keccak256(abi.encode(node, rootHash));
    }

    return isPublishedRootHash[rootHash];
  }

  // reference: https://docs.substrate.io/v3/advanced/scale-codec/#compactgeneral-integers
  function getCompactIntegerByteSize(bytes1 checkByte)
    private
    pure
    returns (uint256 byteLength)
  {
    uint8 mode = uint8(checkByte) & 3; // the 2 least significant bits encode the byte mode so we do a bitwise AND on them

    if (mode == 0) { // single-byte mode
      byteLength = 1;
    } else if (mode == 1) { // two-byte mode
      byteLength = 2;
    } else if (mode == 2) { // four-byte mode
      byteLength = 4;
    } else {
      byteLength = uint8(checkByte >> 2) + 5; // upper 6 bits + 4 are the number of bytes following + 1 for the checkbyte itself
    }
  }

  function toConfirmationHash(bytes32 data, uint256 t2TransactionId)
    private
    view
    returns (bytes32)
  {
    return keccak256(abi.encode(data, t2TransactionId, idToT2PublicKey[t1AddressToId[msg.sender]]));
  }

  function verifyConfirmations(bytes32 msgHash, bytes memory confirmations)
    private
  {
    bytes32 ethSignedPrefixMsgHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
    uint256 numConfirmations = confirmations.length / SIGNATURE_LENGTH;
    uint256 requiredConfirmations = numActiveValidators * quorum[0] / quorum[1] + 1;
    uint256 validConfirmations;
    uint256 id;
    bytes32 r;
    bytes32 s;
    uint8 v;
    bool[] memory confirmed = new bool[](nextValidatorId);

    for (uint256 i; i < numConfirmations; i++) {
      assembly {
        let offset := mul(i, SIGNATURE_LENGTH)
        r := mload(add(confirmations, add(0x20, offset)))
        s := mload(add(confirmations, add(0x40, offset)))
        v := byte(0, mload(add(confirmations, add(0x60, offset))))
      }
      if (v < 27) v += 27;
      if (v != 27 && v != 28 || uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
        continue;
      } else {
        id = t1AddressToId[ecrecover(ethSignedPrefixMsgHash, v, r, s)];

        if (isActiveValidator[id] == false) {
          if (isRegisteredValidator[id]) {
            // Here we activate any previously registered but as yet unactivated validators
            isActiveValidator[id] = true;
            numActiveValidators++;
            validConfirmations++;
            confirmed[id] = true;
          }
        } else if (confirmed[id] == false) {
          validConfirmations++;
          confirmed[id] = true;
        }
      }
      if (validConfirmations == requiredConfirmations) break;
    }

    require(validConfirmations == requiredConfirmations, "Invalid confirmations");
  }

  function doStoreT2TransactionId(uint256 t2TransactionId)
    private
  {
    require(isUsedT2TransactionId[t2TransactionId] == false, "T2 transaction must be unique");
    isUsedT2TransactionId[t2TransactionId] = true;
  }

  function doLift(address erc20Address, address approver, bytes memory t2PublicKey, uint256 amount)
    private
  {
    require(ERC1820_REGISTRY.getInterfaceImplementer(erc20Address, ERC777_TOKEN_HASH) == address(0), "ERC20 lift only");
    require(amount > 0, "Cannot lift zero ERC20 tokens");
    bytes32 checkedT2PublicKey = checkT2PublicKey(t2PublicKey);
    IERC20 erc20Contract = IERC20(erc20Address);
    uint256 currentBalance = erc20Contract.balanceOf(address(this));
    assert(erc20Contract.transferFrom(approver, address(this), amount));
    uint256 newBalance = erc20Contract.balanceOf(address(this));
    require(newBalance <= LIFT_LIMIT, "Exceeds ERC20 lift limit");
    emit LogLifted(erc20Address, approver, checkedT2PublicKey, newBalance - currentBalance);
  }

  function checkT2PublicKey(bytes memory t2PublicKey)
    private
    pure
    returns (bytes32 checkedT2PublicKey)
  {
    require(t2PublicKey.length == 32, "Bad T2 public key");
    checkedT2PublicKey = bytes32(t2PublicKey);
  }

  function recoverSigner(bytes32 hash, bytes memory signature)
    private
    pure
    returns (address)
  {
    if (signature.length != 65) return address(0);

    bytes32 r;
    bytes32 s;
    uint8 v;

    assembly {
      r := mload(add(signature, 0x20))
      s := mload(add(signature, 0x40))
      v := byte(0, mload(add(signature, 0x60)))
    }

    if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
    if (v < 27) v += 27;
    if (v != 27 && v != 28) return address(0);

    return ecrecover(hash, v, r, s);
  }
}
