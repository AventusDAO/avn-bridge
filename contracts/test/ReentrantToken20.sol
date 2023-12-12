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

  // Override for testing - peforms a standard transfer (called from within lower()) before attempting to re-enter via a lift()
  function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
    _transfer(msg.sender, recipient, amount);
    bytes memory someT2PublicKey;
    uint256 someOtherAmount = 1;
    IAVNBridge(_bridge).lift(address(this), someT2PublicKey, someOtherAmount);
    return true;
  }
}