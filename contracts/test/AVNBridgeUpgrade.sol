// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import '../AVNBridge.sol';

contract AVNBridgeUpgrade is AVNBridge {
  function newFunction() external pure returns (string memory) {
    return 'AVNBridge upgraded';
  }
}
