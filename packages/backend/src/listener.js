import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { JsonRpcProvider, Contract, ContractFactory, Wallet, formatEther } from "ethers";
import { evaluateApproval } from "./ruleEngine.js";
import { registerGuardian, recordEvent } from "./store.js";
import { startServer } from "./server.js";
import { generateVerdict } from "./policyEngine.js";
import { SignatureService } from "./signatureService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function short(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

const ERC20_ABI = [
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address account) view returns (uint256)",
];

const TARGETS = [
  { name: "WBOT", address: process.env.WBOT_ADDRESS },
  { name: "USDT", address: process.env.USDT_ADDRESS },
];

let signatureService = null;
if (process.env.SIGNER_PRIVATE_KEY) {
  signatureService = new SignatureService(process.env.SIGNER_PRIVATE_KEY);
}

let signer = null;
if (process.env.SIGNER_PRIVATE_KEY && process.env.RPC_URL) {
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  signer = new Wallet(process.env.SIGNER_PRIVATE_KEY, provider);
  console.log("[listener] Signer address:", signer.address);
}

async function ensureReceiptRegistry() {
  if (!signer) {
    console.log("[listener] ReceiptRegistry disabled — set SIGNER_PRIVATE_KEY and RPC_URL to enable.");
    return null;
  }

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
    console.error("[listener] Could not load ReceiptRegistry artifact — did the build run 'hardhat compile'?", err.message);
    return null;
  }

  if (process.env.RECEIPT_REGISTRY_ADDRESS) {
    console.log("[listener] Using existing ReceiptRegistry:", process.env.RECEIPT_REGISTRY_ADDRESS);
    return new Contract(process.env.RECEIPT_REGISTRY_ADDRESS, artifact.abi, signer);
  }

  console.log("[deploy] No RECEIPT_REGISTRY_ADDRESS set — deploying a new ReceiptRegistry...");
  const balance = await signer.provider.getBalance(signer.address);
  console.log("[deploy] Deployer:", signer.address, "| Balance:", formatEther(balance), "BOT");

  if (balance === 0n) {
    console.error("[deploy] Deployer wallet has 0 balance. Send testnet BOT to", signer.address, "then redeploy.");
    return null;
  }

  try {
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();

    console.log("[deploy] ✅ ReceiptRegistry deployed to:", address);
    console.log("[deploy] Add RECEIPT_REGISTRY_ADDRESS=" + address + " to Railway variables, then redeploy.");

    return contract;
  } catch (err) {
    console.error("[deploy] Failed:", err.message);
    return null;
  }
}

// Since this server has no persistent disk, we rebuild the flagged/anchored
// history on every restart by reading it straight back off the chain —
// the chain is the durable copy, not this process's memory.
async function rehydrateFromChain(receiptRegistry) {
  if (!receiptRegistry) return;

  try {
    console.log("[rehydrate] Reloading flagged history from ReceiptRegistry...");
    const filter = receiptRegistry.filters.ReceiptAnchored();
    const events = await receiptRegistry.queryFilter(filter, 0, "latest");
    console.log(`[rehydrate] Found ${events.length} anchored receipt(s) on-chain.`);

    for (const ev of events) {
      try {
        const { contentHash, submitter, metadata } = ev.args;
        const parsed = JSON.parse(metadata);

        recordEvent({
          token: parsed.token || "UNKNOWN",
          tokenAddress: null,
          from: submitter,
          to: null,
          severity: parsed.risk || "HIGH",
          reason: parsed.reason || "Recovered from on-chain receipt",
          rules: parsed.rules || [],
          txHash: parsed.txHash || ev.transactionHash,
          signed: true,
          hash: contentHash,
          verdict: parsed.verdict || null,
          anchored: true,
        });
      } catch (err) {
        console.error("[rehydrate] Could not parse one receipt:", err.message);
      }
    }

    console.log("[rehydrate] Done.");
  } catch (err) {
    console.error("[rehydrate] Failed to query past events:", err.message);
  }
}

async function main() {
  if (!process.env.RPC_URL) {
    console.error("Set RPC_URL in Railway variables. Confirmed testnet: https://rpc.bohr.life");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(process.env.RPC_URL);
  provider.pollingInterval = 4000;

  console.log(`ShieldGuard listener on chain ${process.env.CHAIN_ID || "unknown"}...`);
  startServer();

  const receiptRegistry = await ensureReceiptRegistry();

  const watched = [];
  const startBlock = await provider.getBlockNumber();

  for (const target of TARGETS) {
    if (!target.address) {
      console.warn(`Skipping ${target.name}: no address in Railway variables`);
      continue;
    }

    const contract = new Contract(target.address, ERC20_ABI, provider);
    console.log(`Watching ${target.name} (${target.address})`);
    registerGuardian(target.name, target.address);

    const handleApproval = async (owner, spender, value, event) => {
      try {
        const ownerBalance = await contract.balanceOf(owner);
        const result = evaluateApproval({ owner, spender, value, ownerBalance });

        const record = {
          token: target.name,
          tokenAddress: target.address,
          txHash: event.log.transactionHash,
          timestamp: new Date().toISOString(),
          ...result,
        };

        let verdict = null;
        let signatureData = null;
        let anchored = false;

        if (result.risk !== "LOW") {
          console.log("🚨 FLAGGED:", JSON.stringify(record, null, 2));

          try {
            verdict = await generateVerdict(record);
            console.log("[verdict]", verdict.summary);
          } catch (err) {
            console.error("[verdict] Error:", err.message);
          }

          if (signatureService && verdict) {
            try {
              signatureData = await signatureService.signVerdict(record, verdict);
              console.log("[signed] By:", signatureData.signerAddress);
            } catch (err) {
              console.error("[signed] Error:", err.message);
            }
          }

          if (receiptRegistry && signatureData) {
            try {
              const alreadyAnchored = await receiptRegistry.isAnchored(signatureData.contentHash);
              if (!alreadyAnchored) {
                const tx = await receiptRegistry.anchorReceipt(
                  signatureData.contentHash,
                  JSON.stringify({
                    token: target.name,
                    risk: result.risk,
                    rules: result.matched_rules,
                    reason: result.reason,
                    verdict: verdict?.summary || null,
                    txHash: record.txHash,
                  })
                );
                await tx.wait();
                anchored = true;
                console.log("[anchor] ✅ Anchored:", signatureData.contentHash.slice(0, 20) + "...");
              } else {
                console.log("[anchor] Already anchored:", signatureData.contentHash.slice(0, 20) + "...");
              }
            } catch (err) {
              console.error("[anchor] Error:", err.message);
            }
          }
        } else {
          console.log(`[${target.name}] Approval OK — ${short(owner)} -> ${short(spender)}`);
        }

        recordEvent({
          token: target.name,
          tokenAddress: target.address,
          from: short(owner),
          to: short(spender),
          severity: result.risk,
          reason: result.reason,
          rules: result.matched_rules,
          txHash: event.log.transactionHash,
          signed: !!signatureData,
          hash: signatureData?.contentHash || null,
          verdict: verdict?.summary || null,
          anchored,
        });
      } catch (err) {
        console.error(`[${target.name}] Error:`, err.message);
      }
    };

    const handleTransfer = (from, to, value, event) => {
      console.log(`[${target.name}] Transfer ${short(from)} -> ${short(to)}`);
      recordEvent({
        token: target.name,
        tokenAddress: target.address,
        from: short(from),
        to: short(to),
        severity: "LOW",
        reason: "Standard transfer, no risk signals",
        rules: [],
        txHash: event.log.transactionHash,
        signed: false,
        hash: null,
        verdict: null,
        anchored: false,
      });
    };

    watched.push({ target, contract, lastBlock: startBlock, handleApproval, handleTransfer });
  }

  await rehydrateFromChain(receiptRegistry);

  // Guard against overlapping cycles: if a previous block's anchoring
  // transaction is still confirming when the next block arrives, skip
  // this tick rather than firing a second on-chain tx with the same
  // nonce (which the network rejects as an underpriced replacement).
  let processingBlock = false;

  provider.on("block", async (blockNumber) => {
    if (processingBlock) return;
    processingBlock = true;

    try {
      for (const w of watched) {
        const fromBlock = w.lastBlock + 1;
        if (fromBlock > blockNumber) continue;

        try {
          const approvalLogs = await w.contract.queryFilter("Approval", fromBlock, blockNumber);
          for (const log of approvalLogs) {
            const { owner, spender, value } = log.args;
            await w.handleApproval(owner, spender, value, { log });
          }

          const transferLogs = await w.contract.queryFilter("Transfer", fromBlock, blockNumber);
          for (const log of transferLogs) {
            const { from, to, value } = log.args;
            w.handleTransfer(from, to, value, { log });
          }

          w.lastBlock = blockNumber;
        } catch (err) {
          console.error(`[${w.target.name}] Poll error:`, err.message);
        }
      }
    } finally {
      processingBlock = false;
    }
  });

  console.log("Listening (polling every 4s via block-range queries)... leave this running.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
