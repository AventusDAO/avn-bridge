// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

interface AvtToken {
  function owner() external view returns (address);
}

contract AVTAuthority {
  bytes4 internal constant BURN_SIG = bytes4(keccak256('burn(uint128)'));
  bytes4 internal constant MINT_SIG = bytes4(keccak256('mint(uint128)'));

  mapping(address => bool) public canBurn;
  mapping(address => bool) public canMint;

  event CanBurn(address indexed src, bool isAllowed);
  event CanMint(address indexed src, bool isAllowed);

  address public immutable avt;

  constructor(address token) {
    if (token == address(0)) revert();
    avt = token;
  }

  modifier onlyOwner() {
    if (msg.sender != AvtToken(avt).owner()) revert();
    _;
  }

  function allowBurning(address src) external onlyOwner {
    if (canBurn[src]) revert();
    canBurn[src] = true;
    emit CanBurn(src, true);
  }

  function revokeBurning(address src) external onlyOwner {
    if (!canBurn[src]) revert();
    canBurn[src] = false;
    emit CanBurn(src, false);
  }

  function allowMinting(address src) external onlyOwner {
    if (canMint[src]) revert();
    canMint[src] = true;
    emit CanMint(src, true);
  }

  function revokeMinting(address src) external onlyOwner {
    if (!canMint[src]) revert();
    canMint[src] = false;
    emit CanMint(src, false);
  }

  function canCall(address src, address dst, bytes4 sig) external view returns (bool) {
    return dst == avt && ((sig == BURN_SIG && canBurn[src]) || (sig == MINT_SIG && canMint[src]));
  }
}
