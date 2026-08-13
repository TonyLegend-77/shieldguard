// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC7579Validator} from "./interfaces/IERC7579Validator.sol";
import {PackedUserOperation} from "./interfaces/PackedUserOperation.sol";

/**
 * @title ShieldGuardValidator7579
 * @notice ERC-7579 validator module requiring TWO valid signatures on every
 * UserOperation: the agent's own signature, AND a ShieldGuard oracle
 * co-signature issued only after the transaction passed simulation +
 * deterministic hard-floor rules + AI advisory review.
 *
 * This is the actual enforcement mechanism — not the SDK's /api/validate
 * call, which an agent can simply not call, or ignore the response of.
 * Here, the EntryPoint will not accept the UserOperation at all unless
 * BOTH signatures recover to the expected addresses. Skipping ShieldGuard
 * means the transaction has no valid oracle signature, which means
 * validateUserOp returns VALIDATION_FAILED, which means the UserOp never
 * executes. There is no code path for the agent to talk its way past this.
 *
 * NOT YET COMPILED OR DEPLOYED. Written against ERC-7579 + ERC-4337 v0.7
 * semantics from spec review, not tested against a live EntryPoint. Before
 * relying on this in production: (1) install a real ERC-4337 EntryPoint +
 * ERC-7579 account (e.g. ZeroDev Kernel, Biconomy Nexus, Safe7579) in a
 * test environment, (2) run the adversarial test suite described in
 * CHANGES-validation-layer.md, (3) get this audited — it is the single
 * highest-consequence piece of code in this codebase; a bug here is a
 * bypassable "hard" gate, which is worse than no gate at all because it
 * looks secure.
 */
contract ShieldGuardValidator7579 is IERC7579Validator {
    uint256 private constant VALIDATION_SUCCESS = 0;
    uint256 private constant VALIDATION_FAILED = 1;
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant ERC1271_FAIL_VALUE = 0xffffffff;

    /// smart account => trusted ShieldGuard oracle signing address
    mapping(address => address) public accountOracle;
    /// smart account => agent's own signing key (EOA or session key)
    mapping(address => address) public accountAgentOwner;

    event ShieldGuardOracleUpdated(address indexed account, address indexed oracle);
    event AgentOwnerUpdated(address indexed account, address indexed agentOwner);

    error InvalidOracle();
    error InvalidAgentOwner();

    function onInstall(bytes calldata data) external override {
        (address _oracle, address _agentOwner) = abi.decode(data, (address, address));
        if (_oracle == address(0)) revert InvalidOracle();
        if (_agentOwner == address(0)) revert InvalidAgentOwner();

        accountOracle[msg.sender] = _oracle;
        accountAgentOwner[msg.sender] = _agentOwner;

        emit ShieldGuardOracleUpdated(msg.sender, _oracle);
        emit AgentOwnerUpdated(msg.sender, _agentOwner);
    }

    function onUninstall(bytes calldata) external override {
        delete accountOracle[msg.sender];
        delete accountAgentOwner[msg.sender];
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == 1; // MODULE_TYPE_VALIDATOR
    }

    /**
     * @notice Validates a UserOperation against BOTH the agent's signature
     * and the ShieldGuard oracle's co-signature. Returns VALIDATION_FAILED
     * (not a revert — per ERC-4337 guidance, validators should return a
     * failure code rather than revert on invalid signatures) if either is
     * missing, malformed, expired, or doesn't recover to the expected
     * address.
     *
     * userOp.signature layout (136 bytes minimum):
     *   [0:65]    agent signature   (r, s, v — 65 bytes)
     *   [65:130]  oracle signature  (r, s, v — 65 bytes)
     *   [130:136] validUntil        (uint48, 6 bytes)
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external view override returns (uint256 validationData) {
        address oracle = accountOracle[userOp.sender];
        address agentOwner = accountAgentOwner[userOp.sender];

        if (oracle == address(0) || agentOwner == address(0)) {
            return VALIDATION_FAILED;
        }

        if (userOp.signature.length < 136) {
            return VALIDATION_FAILED;
        }

        bytes calldata agentSig = userOp.signature[0:65];
        bytes calldata oracleSig = userOp.signature[65:130];
        uint48 validUntil = uint48(bytes6(userOp.signature[130:136]));

        if (block.timestamp > validUntil) {
            return VALIDATION_FAILED;
        }

        bytes32 agentSignedHash = _toEthSignedMessageHash(userOpHash);
        address recoveredAgent = _recover(agentSignedHash, agentSig);
        if (recoveredAgent == address(0) || recoveredAgent != agentOwner) {
            return VALIDATION_FAILED;
        }

        // Oracle signs over (userOpHash, validUntil) — NOT userOpHash alone —
        // so a co-signature can't be replayed against a different expiry, and
        // an expired co-signature can't be reused by extending validUntil
        // without a fresh oracle signature over the new value.
        bytes32 oracleSignableHash = _toEthSignedMessageHash(
            keccak256(abi.encodePacked(userOpHash, validUntil))
        );
        address recoveredOracle = _recover(oracleSignableHash, oracleSig);
        if (recoveredOracle == address(0) || recoveredOracle != oracle) {
            return VALIDATION_FAILED;
        }

        // ERC-4337 validationData packing: bit 0 = sigFailed (0 here, since
        // we returned early above on any failure), bits [160:208] = validUntil.
        return (uint256(validUntil) << 160);
    }

    function isValidSignatureWithSender(
        address sender,
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4) {
        address agentOwner = accountAgentOwner[sender];
        if (agentOwner == address(0)) return ERC1271_FAIL_VALUE;

        address recovered = _recover(_toEthSignedMessageHash(hash), signature);
        return recovered == agentOwner ? ERC1271_MAGIC_VALUE : ERC1271_FAIL_VALUE;
    }

    /// @dev EIP-191 personal-sign prefix, matching what ethers/viem produce
    /// client-side via signMessage on a 32-byte digest.
    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    /// @dev Raw ecrecover with explicit r/s/v split and a signature-length
    /// check. Does not enforce EIP-2098 low-s malleability restrictions —
    /// acceptable here because these signatures authorize, they aren't used
    /// as unique transaction identifiers, so malleability doesn't enable a
    /// replay attack against this contract's own logic. Flagging so it's a
    /// reviewed decision, not an oversight, if this code is audited.
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);

        return ecrecover(digest, v, r, s);
    }
}
