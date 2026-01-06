// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import '../AVNBridge.sol';

contract AVNBridgeUpgrade is AVNBridge {
  constructor(address avt_) AVNBridge(avt_) {}

  function newFunction() external pure returns (string memory) {
    return 'AVNBridge upgraded';
  }
}
