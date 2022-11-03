// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC777.sol";

interface IPrior {
  function unlockETH(address payable recipient, uint256 amount) external;
  function unlockERC777Tokens(address erc777Address, address recipient, uint256 amount) external;
  function unlockERC20Tokens(address erc20Address, address recipient, uint256 amount) external;
}

contract Unlocker {
  address private avn;
  address private owner;
  IPrior private priorInstance;

  constructor(address _avn, IPrior _priorInstance) {
    owner = msg.sender;
    avn = _avn;
    priorInstance = _priorInstance;
  }

  modifier onlyOwner {
    require(msg.sender == owner, "Only owner");
    _;
  }

  function recoverERC777Tokens(address erc777Address, uint256 amount)
    onlyOwner
    external
  {
    priorInstance.unlockERC777Tokens(erc777Address, avn, amount);
  }

  function recoverERC20Tokens(address erc20Address, uint256 amount)
    onlyOwner
    external
  {
    priorInstance.unlockERC20Tokens(erc20Address, avn, amount);
  }

  function recoverETH(uint256 amount)
    onlyOwner
    external
  {
    priorInstance.unlockETH(payable(avn), amount);
  }
}
