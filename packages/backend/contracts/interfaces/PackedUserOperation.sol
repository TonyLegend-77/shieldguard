// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @dev ERC-4337 v0.7 PackedUserOperation, defined locally rather than pulled
 * from @account-abstraction/contracts — that package isn't in this repo's
 * dependencies yet. Add it (or eth-infinitism's account-abstraction package)
 * before compiling for real; this struct is a drop-in match for the
 * standard shape so swapping to the canonical import later is a no-op.
 */
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits; // packed: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
    uint256 preVerificationGas;
    bytes32 gasFees; // packed: maxPriorityFeePerGas (16 bytes) | maxFeePerGas (16 bytes)
    bytes paymasterAndData;
    bytes signature;
}
