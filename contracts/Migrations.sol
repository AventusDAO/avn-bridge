// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./Owned.sol";

contract Migrations is Owned {

  uint public last_completed_migration;

  function setCompleted(uint _completed)
    onlyOwner
    public
  {
    last_completed_migration = _completed;
  }

  function upgrade(address _newAddress)
    onlyOwner
    public
  {
    Migrations upgraded = Migrations(_newAddress);
    upgraded.setCompleted(last_completed_migration);
  }
}