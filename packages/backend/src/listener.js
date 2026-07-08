import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { JsonRpcProvider, Contract, ContractFactory, Wallet, formatEther } from "ethers";
import {
  evaluateApproval,
  evaluateApprovalForAll,
  evaluateAdminEvent,
  evaluateTransferSpoof,
  evaluateCall,
} from "./ruleEngine.js";
import { registerGuardian, recordEvent, canMonitorContract } from "./store.js";
import { CONTRACT_TARGETS } from "./contractTargets.js";
import { startServer } from "./server.js";
import { generateVerdict } from "./policyEngine.js";
import { SignatureService } from "./signatureService.js";
import { setupWebhook } from "./webhook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function short(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

// Extended beyond plain ERC-20 Approval/Transfer to also cover:
// - ApprovalForAll (ERC-721/1155 blanket approval — NFT drainer vector)
// - OwnershipTransferred / Paused / Unpaused (admin/owner privileged calls)
// Querying for a fragment a given contract never actually emits is harmless —
// queryFilter matches on topic hash against that contract's logs and simply
// returns zero results, so this is safe to share across every watched
// contract (ERC-20, ERC-721, ERC-1155) without per-type branching.
const ERC20_ABI = [
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "function balanceOf(address account) view returns (uint256)",
];

const TARGETS = [
  { name: "WBOT", address: process.env.WBOT_ADDRESS },
  { name: "USDT", address: process.env.USDT_ADDRESS },
  { name: "bwUSDT", address: "0xAfea2A5e0587615ceD6972e271E5bfe8622ebcA2" },
  { name: "bwETH", address: "0x6916414F7e390af45c29c89b0aC1Aa79c568D09D" },
  { name: "bwUSDC", address: "0x9D55Fba17a37AF9f7ED6d073b2A533Ed3Ed72C03" },
  { name: "tUSDT", address: "0xDAca65D8Dd2621F0e976648386495Be1151A7177" },
  { name: "Mock USDT", address: "0xe6Bd650807ddEdd7Aecdd5083F6bf7ECB6bBCE58" },
  { name: "BOT Governance Token", address: "0x0000000000000000000000000000000000002005" },
  { name: "BOT V2 LP Token", address: "0xBca241D71854da5Bf6E59591701995AB935f2E74" },
  { name: "Stake Val003 Credit", address: "0x4AFc633E7B6bEB8e552ccddbE06Cca3754991E9A" },
  { name: "Rocket Doge", address: "0xf77c188aBFf5A30D560c4242BfdedDb5a33dEa0E" },
  // Skipped — truncated in the source list, need full addresses before adding:
  //   USDT (secondary entry, "0x75edC93310420fe3"), MONEY ("0xd93ad23F751C6E6C"),
  //   Rocket Doge dup ("0x83c56D73C2418F")
];


// Known-good NFT marketplace operator addresses (e.g. Seaport/OpenSea
// conduits) that shouldn't be scored as harshly when granted blanket
// setApprovalForAll — comma-separated in Railway env, empty by default
// since BOT Chain testnet has no canonical marketplace yet.
const KNOWN_NFT_OPERATORS = (process.env.KNOWN_NFT_OPERATORS || "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);

// Per-target memory of "to" addresses this contract has already paid, used
// by the address-poisoning heuristic (evaluateTransferSpoof) to spot
// zero-value transfers from lookalike addresses. Address-only, in-memory —
// same durability tradeoff as the rest of this listener's live state.
const seenAddressesByTarget = new Map(); // key: lowercase token address -> Set<address>

function trackSeenAddress(tokenAddress, addr) {
  const key = tokenAddress.toLowerCase();
  if (!seenAddressesByTarget.has(key)) seenAddressesByTarget.set(key, new Set());
  seenAddressesByTarget.get(key).add(addr);
}

function getSeenAddresses(tokenAddress) {
  return Array.from(seenAddressesByTarget.get(tokenAddress.toLowerCase()) || []);
}

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

// Module-scope state so dynamically-added contracts (via webhook.js ->
// addDynamicWatch) share the exact same provider, receiptRegistry, and
// polling list as the two statically-configured targets (WBOT/USDT).
// These are populated inside main() and read by closures created later,
// so call order doesn't matter as long as addDynamicWatch/removeDynamicWatch
// are only invoked once main() has finished its setup (true in practice,
// since they're only reachable via HTTP routes registered after startup).
let provider = null;
let receiptRegistry = null;
const watched = [];

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
async function rehydrateFromChain(registry) {
  if (!registry) return;

  try {
    console.log("[rehydrate] Reloading flagged history from ReceiptRegistry...");
    const filter = registry.filters.ReceiptAnchored();
    const events = await registry.queryFilter(filter, 0, "latest");
    console.log(`[rehydrate] Found ${events.length} anchored receipt(s) on-chain.`);

    for (const ev of events) {
      try {
        const { contentHash, submitter, metadata } = ev.args;
        const parsed = JSON.parse(metadata);

        recordEvent({
          token: parsed.token || "UNKNOWN",
          tokenAddress: parsed.tokenAddress || null,
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

// Shared verdict -> sign -> anchor -> record pipeline. Any detector (ERC-20
// approval, ApprovalForAll, admin event, spoofed transfer) that produces a
// { risk, matched_rules, reason, ... } result from ruleEngine.js runs through
// this exact same path, so every rule gets identical treatment: an AI
// verdict, a signature, and an on-chain anchored receipt once flagged.
async function processFlaggedResult(target, result, { txHash, from, to }) {
  const gate = canMonitorContract(target.address);

  const record = {
    token: target.name,
    tokenAddress: target.address,
    txHash,
    timestamp: new Date().toISOString(),
    ...result,
  };

  let verdict = null;
  let signatureData = null;
  let anchored = false;

  if (result.risk !== "LOW" && gate.canMonitor) {
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
              tokenAddress: target.address,
              risk: result.risk,
              rules: result.matched_rules,
              reason: result.reason,
              verdict: verdict?.summary || null,
              txHash,
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
  } else if (result.risk !== "LOW" && !gate.canMonitor) {
    console.log(`[${target.name}] FLAGGED but quota exhausted — skipping verdict/sign/anchor: ${gate.reason}`);
  }

  recordEvent({
    token: target.name,
    tokenAddress: target.address,
    from: from ? short(from) : null,
    to: to ? short(to) : null,
    severity: result.risk,
    reason: result.reason,
    rules: result.matched_rules,
    txHash,
    signed: !!signatureData,
    hash: signatureData?.contentHash || null,
    verdict: verdict?.summary || null,
    anchored,
  });

  return { verdict, signatureData, anchored };
}

// Builds the event handlers for one target. Shared by both the static
// TARGETS loop at startup and addDynamicWatch() at runtime, so a contract
// added later via /monitor gets identical treatment (rule engine -> AI
// verdict -> signature -> on-chain anchor -> store) as WBOT/USDT.
function createHandlers(target, contract) {
  const handleApproval = async (owner, spender, value, event) => {
    try {
      const ownerBalance = await contract.balanceOf(owner);
      const result = evaluateApproval({ owner, spender, value, ownerBalance });
      if (result.risk === "LOW") {
        console.log(`[${target.name}] Approval OK — ${short(owner)} -> ${short(spender)}`);
      }
      await processFlaggedResult(target, result, {
        txHash: event.log.transactionHash,
        from: owner,
        to: spender,
      });
    } catch (err) {
      console.error(`[${target.name}] Error (Approval):`, err.message);
    }
  };

  // ERC-721/1155 setApprovalForAll — blanket collection-wide approval.
  // Wired the same way as handleApproval: rule engine result flows straight
  // into the shared verdict/sign/anchor pipeline.
  const handleApprovalForAll = async (owner, operator, approved, event) => {
    try {
      const result = evaluateApprovalForAll({
        owner,
        operator,
        approved,
        knownOperators: KNOWN_NFT_OPERATORS,
      });
      if (result.risk === "LOW") {
        console.log(`[${target.name}] ApprovalForAll OK — ${short(owner)} -> ${short(operator)} (approved=${approved})`);
      }
      await processFlaggedResult(target, result, {
        txHash: event.log.transactionHash,
        from: owner,
        to: operator,
      });
    } catch (err) {
      console.error(`[${target.name}] Error (ApprovalForAll):`, err.message);
    }
  };

  // Admin/owner privileged calls: OwnershipTransferred, Paused, Unpaused.
  // expectedOwner isn't wired to a config source yet (no baseline-owner
  // registry exists) — passed as null so every OwnershipTransferred is
  // scored as A001 (HIGH) rather than A003 (CRITICAL) until that baseline
  // is added.
  const handleAdminEvent = async (eventName, args, event) => {
    try {
      const result = evaluateAdminEvent({ eventName, args, expectedOwner: null });
      console.log(`[${target.name}] Admin event: ${eventName}`, args);
      await processFlaggedResult(target, result, {
        txHash: event.log.transactionHash,
        from: args.previousOwner || args.account || null,
        to: args.newOwner || null,
      });
    } catch (err) {
      console.error(`[${target.name}] Error (${eventName}):`, err.message);
    }
  };

  const handleTransfer = async (from, to, value, event) => {
    console.log(`[${target.name}] Transfer ${short(from)} -> ${short(to)}`);

    // Address-poisoning check runs before this "to" address is remembered,
    // so it's only ever compared against addresses seen on *prior* transfers.
    const result = evaluateTransferSpoof({
      from,
      to,
      value,
      watchAddresses: getSeenAddresses(target.address),
    });
    trackSeenAddress(target.address, to);

    if (result.risk === "LOW") {
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
    } else {
      // Flagged as possible address poisoning (T001) or unsolicited dust
      // (T002) — runs through the full verdict/sign/anchor pipeline like
      // any other detector.
      await processFlaggedResult(target, result, {
        txHash: event.log.transactionHash,
        from,
        to,
      });
    }
  };

  return { handleApproval, handleApprovalForAll, handleAdminEvent, handleTransfer };
}

// Handles one transaction sent to a call-monitored contract (CONTRACT_TARGETS).
// Unlike the event-based handlers above, this is triggered by a function-
// selector match rather than a decoded log — but it feeds into the exact
// same processFlaggedResult pipeline, so a critical call gets an AI verdict,
// a signature, and an on-chain anchor just like any other detector.
function createCallHandler(target) {
  return async function handleCall(tx) {
    const selector = tx.data?.slice(0, 10)?.toLowerCase();
    const functionName = target.functionSelectors[selector];

    if (!functionName) return; // non-critical function, or selector not yet mapped
    if (!target.criticalFunctions.includes(functionName)) return; // known fn, not on this contract's watch list

    try {
      const result = evaluateCall({ contractName: target.name, functionName });
      console.log(`[${target.name}] Critical call: ${functionName}`);
      await processFlaggedResult(target, result, {
        txHash: tx.hash,
        from: tx.from,
        to: target.address,
      });
    } catch (err) {
      console.error(`[${target.name}] Call handler error:`, err.message);
    }
  };
}

// Called by webhook.js when a new contract is registered via /monitor,
// /monitor/private, or /monitor/admin. This is what makes those endpoints
// actually do something, instead of just bookkeeping an address nobody watches.
export async function addDynamicWatch(name, address, options = {}) {
  if (!provider) {
    return { ok: false, reason: "Listener not initialized yet — try again shortly." };
  }

  const key = address.toLowerCase();
  if (watched.some((w) => w.target.address.toLowerCase() === key)) {
    return { ok: false, reason: "This contract is already being monitored." };
  }

  const guardian = registerGuardian(name, address, options);
  const target = { name, address };
  const contract = new Contract(address, ERC20_ABI, provider);
  const { handleApproval, handleApprovalForAll, handleAdminEvent, handleTransfer } = createHandlers(target, contract);

  const lastBlock = await provider.getBlockNumber();
  watched.push({ target, contract, lastBlock, handleApproval, handleApprovalForAll, handleAdminEvent, handleTransfer });

  console.log(`[listener] Now dynamically watching ${name} (${address}) — tier: ${guardian.tier}, limit: ${guardian.txLimit}`);
  return { ok: true, guardian };
}

export function removeDynamicWatch(address) {
  const key = address.toLowerCase();
  const idx = watched.findIndex((w) => w.target.address.toLowerCase() === key);
  if (idx === -1) return false;
  watched.splice(idx, 1);
  return true;
}

async function main() {
  if (!process.env.RPC_URL) {
    console.error("Set RPC_URL in Railway variables. Confirmed testnet: https://rpc.bohr.life");
    process.exit(1);
  }

  provider = new JsonRpcProvider(process.env.RPC_URL);
  provider.pollingInterval = 4000;

  console.log(`ShieldGuard listener on chain ${process.env.CHAIN_ID || "unknown"}...`);
  const app = startServer({ provider });

  receiptRegistry = await ensureReceiptRegistry();

  // Wires POST/GET/DELETE /monitor* routes onto the same Express app, backed
  // by addDynamicWatch/removeDynamicWatch above.
  setupWebhook(app, { addDynamicWatch, removeDynamicWatch, provider });

  const startBlock = await provider.getBlockNumber();

  for (const target of TARGETS) {
    if (!target.address) {
      console.warn(`Skipping ${target.name}: no address in Railway variables`);
      continue;
    }

    const contract = new Contract(target.address, ERC20_ABI, provider);
    console.log(`Watching ${target.name} (${target.address})`);
    registerGuardian(target.name, target.address); // addedBy defaults to 'admin' -> unlimited

    const { handleApproval, handleApprovalForAll, handleAdminEvent, handleTransfer } = createHandlers(target, contract);
    watched.push({ target, contract, lastBlock: startBlock, handleApproval, handleApprovalForAll, handleAdminEvent, handleTransfer });
  }

  await rehydrateFromChain(receiptRegistry);

  const watchedCalls = new Map(); // lowercase address -> handleCall
  for (const target of CONTRACT_TARGETS) {
    registerGuardian(target.name, target.address, {
      tier: target.tier,
      monitorCalls: true,
      criticalFunctions: target.criticalFunctions,
    });
    if (Object.keys(target.functionSelectors).length === 0) {
      console.warn(`[listener] ${target.name} (${target.address}) has no known function selectors yet — registered for visibility, but calls won't be decoded until selectors are added.`);
    }
    watchedCalls.set(target.address.toLowerCase(), createCallHandler(target));
  }

  // Guard against overlapping cycles: if a previous block's anchoring
  // transaction is still confirming when the next block arrives, skip
  // this tick rather than firing a second on-chain tx with the same
  // nonce (which the network rejects as an underpriced replacement).
  let processingBlock = false;

  provider.on("block", async (blockNumber) => {
    if (processingBlock) return;
    processingBlock = true;

    try {
      // watched.length can grow between ticks (new contract added via
      // /monitor) — iterate a snapshot so a concurrent push() is safe.
      for (const w of [...watched]) {
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
            await w.handleTransfer(from, to, value, { log });
          }

          // New: ERC-721/1155 blanket approval. Contracts that never emit
          // this event (plain ERC-20s like WBOT/USDT) simply return zero
          // logs here — harmless no-op, not an error.
          const approvalForAllLogs = await w.contract.queryFilter("ApprovalForAll", fromBlock, blockNumber);
          for (const log of approvalForAllLogs) {
            const { owner, operator, approved } = log.args;
            await w.handleApprovalForAll(owner, operator, approved, { log });
          }

          // New: admin/owner privileged calls. Same no-op-if-absent logic
          // applies to contracts without Ownable/Pausable wired in.
          const ownershipLogs = await w.contract.queryFilter("OwnershipTransferred", fromBlock, blockNumber);
          for (const log of ownershipLogs) {
            const { previousOwner, newOwner } = log.args;
            await w.handleAdminEvent("OwnershipTransferred", { previousOwner, newOwner }, { log });
          }

          const pausedLogs = await w.contract.queryFilter("Paused", fromBlock, blockNumber);
          for (const log of pausedLogs) {
            const { account } = log.args;
            await w.handleAdminEvent("Paused", { account }, { log });
          }

          const unpausedLogs = await w.contract.queryFilter("Unpaused", fromBlock, blockNumber);
          for (const log of unpausedLogs) {
            const { account } = log.args;
            await w.handleAdminEvent("Unpaused", { account }, { log });
          }

          w.lastBlock = blockNumber;
        } catch (err) {
          console.error(`[${w.target.name}] Poll error:`, err.message);
        }
      }

      // Call monitoring has no event to queryFilter — pull the full block
      // (with transactions) once per tick and check each tx's `to` against
      // the watched-contract map, decoding via function selector.
      if (watchedCalls.size > 0) {
        try {
          const block = await provider.getBlock(blockNumber, true);
          for (const tx of block?.prefetchedTransactions || []) {
            if (!tx.to) continue; // contract deployment, no `to`
            const handleCall = watchedCalls.get(tx.to.toLowerCase());
            if (handleCall) await handleCall(tx);
          }
        } catch (err) {
          console.error("[call-monitor] Block fetch/scan error:", err.message);
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
