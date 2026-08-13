// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {PackedUserOperation} from "./PackedUserOperation.sol";

/**
 * @dev Minimal subset of ERC-7579's validator module interface — only what
 * ShieldGuardValidator7579 actually implements. Defined locally for the
 * same reason as PackedUserOperation.sol: no external ERC-7579 package is
 * in this repo's dependencies yet. Swap for the canonical interface
 * (rhinestonewtf/modulekit or the reference implementation) before
 * compiling for real.
 */
interface IERC7579Validator {
    function onInstall(bytes calldata data) external;

    function onUninstall(bytes calldata data) external;

    function isModuleType(uint256 moduleTypeId) external pure returns (bool);

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256 validationData);

    function isValidSignatureWithSender(
        address sender,
        bytes32 hash,
        bytes calldata signature
    ) external view returns (bytes4);
}
