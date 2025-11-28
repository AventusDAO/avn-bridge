// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import '../interfaces/IAVNBridge.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/interfaces/IERC777Recipient.sol';

contract ReentrantToken is ERC20 {
  enum ReentryPoint {
    ClaimLower,
    RevertLower,
    ERC20Lift,
    ERC777Lift
  }

  ReentryPoint private _reentryPoint;
  address private _bridge;
  address private _address;
  bytes private _bytes;
  bytes32 private _bytes32;
  uint256 private _uint256;

  constructor(address bridge) ERC20('R20', 'R20') {
    _mint(msg.sender, 100000000000000000);
    _bridge = bridge;
  }

  function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
    super.transferFrom(sender, recipient, amount);
    _attemptReentry();
    return true;
  }

  function setReentryPoint(ReentryPoint reentryPoint) external {
    _reentryPoint = reentryPoint;
  }

  function _attemptReentry() private {
    if (_reentryPoint == ReentryPoint.ClaimLower) IAVNBridge(_bridge).claimLower(_bytes);
    else if (_reentryPoint == ReentryPoint.RevertLower) IAVNBridge(_bridge).revertLower(_bytes);
    else if (_reentryPoint == ReentryPoint.ERC20Lift) IAVNBridge(_bridge).lift(_address, _bytes32, _uint256);
    else if (_reentryPoint == ReentryPoint.ERC777Lift) IERC777Recipient(_bridge).tokensReceived(_address, _address, _address, _uint256, _bytes, _bytes);
  }
}
