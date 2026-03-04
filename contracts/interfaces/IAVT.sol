// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

interface IAVT {
  function balanceOf(address src) external view returns (uint256);
  function burn(uint128 wad) external;
  function mint(uint128 wad) external;
  function totalSupply() external view returns (uint256);
}
