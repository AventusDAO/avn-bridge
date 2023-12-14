// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "../interfaces/IAVNBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ReentrantToken20 is ERC20 {
  address private _bridge;

  constructor(uint256 supply, address bridge) ERC20("RToken20", "R20") {
    _mint(msg.sender, supply*10**18);
    _bridge = bridge;
  }

  // Overridden for testing - peforms a standard transfer (triggered within lower()) before attempting re-entry via lift()
  function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
    super.transfer(recipient, amount);
    bytes memory someBytes;
    uint256 someAmount = 1;
    IAVNBridge(_bridge).lift(address(this), someBytes, someAmount);
    return true;
  }
}