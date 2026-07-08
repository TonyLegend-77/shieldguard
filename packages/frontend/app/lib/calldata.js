// Minimal calldata encoders for the SDK tester panel. Same convention as
// erc20.js: no ethers/viem dependency on the frontend, hand-encoded ABI.

const APPROVE_SELECTOR = '095ea7b3';
const SET_APPROVAL_FOR_ALL_SELECTOR = 'a22cb465';
const TRANSFER_SELECTOR = 'a9059cbb';

export const MAX_UINT256 = (2n ** 256n) - 1n;

function padAddress(address) {
  return address.toLowerCase().replace('0x', '').padStart(64, '0');
}

function padUint256(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function padBool(value) {
  return (value ? '1' : '0').padStart(64, '0');
}

export function encodeApprove(spender, amount) {
  return '0x' + APPROVE_SELECTOR + padAddress(spender) + padUint256(amount);
}

export function encodeApprovalForAll(operator, approved) {
  return '0x' + SET_APPROVAL_FOR_ALL_SELECTOR + padAddress(operator) + padBool(approved);
}

export function encodeTransfer(to, amount) {
  return '0x' + TRANSFER_SELECTOR + padAddress(to) + padUint256(amount);
}
