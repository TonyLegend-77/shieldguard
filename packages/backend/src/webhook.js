import express from "express";
import { Interface } from "ethers";
import {
  getGuardians,
  getGuardianStats,
  canUserAddMoreContracts,
} from "./storeAdapter.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TRANSFER_ABI = ["event Transfer(address indexed from, address indexed to, uint256 value)"];

// Prevents the same $BOT payment tx from being used to "buy" private tier
// more than once. In-memory only — fine for now since paymentTx + address
// pairs are also visible on the guardian record for manual audit.
const usedPaymentTxs = new Set();

// Verifies a real on-chain $BOT transfer to the treasury before granting
// private tier. This replaces the "return true; // simplified" stub from
// the earlier draft — that stub would let anyone claim private tier for free.
async function verifyBotPayment(provider, txHash, expectedFromAddress) {
  const treasury = (process.env.TREASURY_ADDRESS || "").toLowerCase();
  const botToken = (process.env.BOT_TOKEN_ADDRESS || "").toLowerCase();
  const requiredAmount = parseFloat(process.env.PRIVATE_TIER_PRICE_BOT || "5");

  if (!treasury || !botToken) {
    return { valid: false, reason: "TREASURY_ADDRESS or BOT_TOKEN_ADDRESS not configured on the server" };
  }
  if (!provider) {
    return { valid: false, reason: "Chain provider not initialized" };
  }

  let receipt;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (err) {
    return { valid: false, reason: `Could not fetch transaction: ${err.message}` };
  }

  if (!receipt || receipt.status !== 1) {
    return { valid: false, reason: "Transaction not found or failed" };
  }

  const iface = new Interface(TRANSFER_ABI);

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== botToken) continue;
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue; // not a Transfer event on this token
    }
    if (!parsed) continue;

    const { from, to, value } = parsed.args;
    if (to.toLowerCase() !== treasury) continue;
    if (expectedFromAddress && from.toLowerCase() !== expectedFromAddress.toLowerCase()) continue;

    // $BOT assumed 18 decimals, matching other BOT Chain ERC20s in this repo.
    const amount = Number(value) / 1e18;
    if (amount >= requiredAmount) {
      return { valid: true, from, to, amount };
    }
  }

  return { valid: false, reason: `No qualifying ${requiredAmount} $BOT transfer to treasury found in tx ${txHash}` };
}

// deps: { addDynamicWatch, removeDynamicWatch, provider } — injected from
// listener.js at startup (not imported directly) to avoid a circular import,
// since listener.js is also the module that imports this one.
export function setupWebhook(app, deps) {
  const { addDynamicWatch, removeDynamicWatch, provider } = deps;

  app.use(express.json());

  // Public tier: free, capped at PUBLIC_TX_LIMIT tx, max FREE_TIER_MAX_CONTRACTS
  // per wallet if a wallet is provided (agents without a wallet aren't capped
  // per-wallet but still get the per-contract public limit).
  app.post("/monitor", async (req, res) => {
    const { address, name, wallet } = req.body;
    if (!address || !name) return res.status(400).json({ error: "address and name required" });
    if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: "Invalid contract address" });
    if (wallet && !ADDRESS_RE.test(wallet)) return res.status(400).json({ error: "Invalid wallet address" });

    if (wallet) {
      const check = canUserAddMoreContracts(wallet);
      if (!check.allowed) return res.status(429).json(check);
    }

    const result = await addDynamicWatch(name, address, {
      addedBy: wallet ? "user" : "agent",
      addedByAddress: wallet || null,
      tier: "public",
    });

    if (!result.ok) return res.status(409).json({ error: result.reason });
    res.json({ success: true, address, name, tier: "public", txLimit: result.guardian.txLimit, guardian: result.guardian });
  });

  // Private tier: requires a verified 5 $BOT (default) payment to the
  // treasury, in exchange for a higher tx cap.
  app.post("/monitor/private", async (req, res) => {
    const { address, name, wallet, paymentTx } = req.body;
    if (!address || !name || !wallet || !paymentTx) {
      return res.status(400).json({ error: "address, name, wallet, and paymentTx are all required" });
    }
    if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: "Invalid contract address" });
    if (!ADDRESS_RE.test(wallet)) return res.status(400).json({ error: "Invalid wallet address" });

    if (usedPaymentTxs.has(paymentTx.toLowerCase())) {
      return res.status(409).json({ error: "This payment transaction has already been used" });
    }

    const verification = await verifyBotPayment(provider, paymentTx, wallet);
    if (!verification.valid) {
      return res.status(402).json({ error: `Payment verification failed: ${verification.reason}` });
    }
    usedPaymentTxs.add(paymentTx.toLowerCase());

    const result = await addDynamicWatch(name, address, {
      addedBy: "user",
      addedByAddress: wallet,
      tier: "private",
      paymentTx,
    });

    if (!result.ok) {
      usedPaymentTxs.delete(paymentTx.toLowerCase()); // don't burn the payment if the watch failed
      return res.status(409).json({ error: result.reason });
    }
    res.json({ success: true, address, name, tier: "private", txLimit: result.guardian.txLimit, guardian: result.guardian });
  });

  // Admin tier: unlimited, gated on a server-side secret header.
  app.post("/monitor/admin", async (req, res) => {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_API_KEY || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { address, name } = req.body;
    if (!address || !name) return res.status(400).json({ error: "address and name required" });
    if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: "Invalid contract address" });

    const result = await addDynamicWatch(name, address, { addedBy: "admin", tier: "admin" });
    if (!result.ok) return res.status(409).json({ error: result.reason });
    res.json({ success: true, address, name, tier: "admin", txLimit: "unlimited", guardian: result.guardian });
  });

  app.get("/monitor", (req, res) => {
    res.json({ monitored: getGuardians() });
  });

  app.get("/monitor/stats/:address", (req, res) => {
    const stats = getGuardianStats(req.params.address);
    if (!stats) return res.status(404).json({ error: "Contract not found" });
    res.json(stats);
  });

  app.get("/monitor/limits", (req, res) => {
    res.json({
      contracts: getGuardians().map((g) => ({
        address: g.address,
        name: g.name,
        addedBy: g.addedBy,
        tier: g.tier,
        txCount: g.txCount,
        txLimit: g.txLimit,
        remaining: g.txLimit === -1 ? "unlimited" : Math.max(0, g.txLimit - g.txCount),
        isActive: g.isActive,
      })),
    });
  });

  app.delete("/monitor/:address", (req, res) => {
    if (!ADDRESS_RE.test(req.params.address)) return res.status(400).json({ error: "Invalid address" });
    const removed = removeDynamicWatch(req.params.address);
    res.json({ success: removed });
  });
}
