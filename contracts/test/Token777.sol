// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC777/ERC777.sol";

contract Token777 is ERC777 {
  address[] private empty;
  constructor(uint256 supply) ERC777("Token777", "777", empty) {
    _mint(msg.sender, supply*10**18, "", "");
  }
}