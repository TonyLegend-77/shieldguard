// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ReceiptRegistry
 * @notice Anchors ShieldGuard signature hashes on-chain for verifiable audit trail.
 * @dev Each contentHash can only be anchored once. The submitter is recorded.
 */
contract ReceiptRegistry {
    struct Receipt {
        bytes32 contentHash;
        string metadata;
        uint256 timestamp;
        address submitter;
    }

    mapping(bytes32 => Receipt) public receipts;

    event ReceiptAnchored(
        bytes32 indexed contentHash,
        uint256 timestamp,
        string metadata,
        address submitter
    );

    /**
     * @notice Anchor a new receipt. Reverts if already anchored.
     * @param contentHash keccak256 hash of the signed payload
     * @param metadata JSON string: {token, risk, rules}
     */
    function anchorReceipt(bytes32 contentHash, string calldata metadata) external {
        require(receipts[contentHash].timestamp == 0, "ReceiptRegistry: already anchored");

        receipts[contentHash] = Receipt({
            contentHash: contentHash,
            metadata: metadata,
            timestamp: block.timestamp,
            submitter: msg.sender
        });

        emit ReceiptAnchored(contentHash, block.timestamp, metadata, msg.sender);
    }

    /**
     * @notice Verify a receipt by its content hash.
     * @param contentHash The hash to look up
     * @return The full Receipt struct (timestamp 0 if not found)
     */
    function verifyReceipt(bytes32 contentHash) external view returns (Receipt memory) {
        return receipts[contentHash];
    }

    /**
     * @notice Check if a receipt has been anchored.
     */
    function isAnchored(bytes32 contentHash) external view returns (bool) {
        return receipts[contentHash].timestamp != 0;
    }
}
