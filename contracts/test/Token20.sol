// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Token20 is ERC20, Ownable {
  constructor(uint256 supply) ERC20("Token20", "20") Ownable(msg.sender) {
    _mint(msg.sender, supply*10**18);
  }

  // Mimic existing AVT token mint
  function mint(uint128 amount) public onlyOwner {
    _mint(msg.sender, amount);
  }

  // Mimic existing AVT token setOwner
  event LogSetOwner (address indexed owner);
  function setOwner(address owner_) public onlyOwner {
    _transferOwnership(owner_);
    emit LogSetOwner(owner_);
  }
}