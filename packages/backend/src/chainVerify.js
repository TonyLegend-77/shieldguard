  // Read-only, no-signer connection to ReceiptRegistry — used purely to verify
// receipts directly on-chain, independent of this server's own memory/uptime.
// This is what makes a "verified" badge actually mean something: anyone,
// including this server after a restart, gets the same answer straight
// from the chain.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { JsonRpcProvider, Contract } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));

let registry = null;

function getRegistry() {
  if (registry) return registry;
  if (!process.env.RECEIPT_REGISTRY_ADDRESS || !process.env.RPC_URL) return null;

  const artifactPath = join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "ReceiptRegistry.sol",
    "ReceiptRegistry.json"
  );

  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  } catch (err) {
    console.error("[chainVerify] Could not load ReceiptRegistry artifact:", err.message);
    return null;
  }

  const provider = new JsonRpcProvider(process.env.RPC_URL);
  registry = new Contract(process.env.RECEIPT_REGISTRY_ADDRESS, artifact.abi, provider);
  return registry;
}

export async function verifyOnChain(contentHash) {
  const contract = getRegistry();
  if (!contract) {
    return { available: false, reason: "ReceiptRegistry not configured on this server." };
  }

  try {
    const anchored = await contract.isAnchored(contentHash);
    if (!anchored) {
      return { available: true, anchored: false };
    }

    const receipt = await contract.verifyReceipt(contentHash);

    let txHash = null;
    try {
      const filter = contract.filters.ReceiptAnchored(contentHash);
      const events = await contract.queryFilter(filter, 0, "latest");
      if (events.length > 0) txHash = events[events.length - 1].transactionHash;
    } catch (err) {
      console.error("[chainVerify] Could not fetch anchor tx hash:", err.message);
    }

    return {
      available: true,
      anchored: true,
      contentHash: receipt.contentHash,
      metadata: receipt.metadata,
      timestamp: Number(receipt.timestamp),
      submitter: receipt.submitter,
      registryAddress: process.env.RECEIPT_REGISTRY_ADDRESS,
      txHash,
      explorerUrl: txHash
        ? `https://scan.bohr.life/tx/${txHash}`
        : `https://scan.bohr.life/address/${process.env.RECEIPT_REGISTRY_ADDRESS}`,
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}
