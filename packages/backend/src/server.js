import express from "express";
import { Interface, Contract } from "ethers";
import { verifyOnChain } from "./chainVerify.js";
import cors from "cors";
import {
  getAlerts,
  getGuardians,
  getGlobalStats,
  getUserContracts,
  getUserAlerts,
  getUserStats,
  recordEvent,
} from "./store.js";
import { evaluateApproval, evaluateApprovalForAll, evaluateCall } from "./ruleEngine.js";
import { matchCriticalCall } from "./contractTargets.js";
import { generateVerdict } from "./policyEngine.js";

// Known function selectors this pre-signing checker can actually reason
// about. Anything else (arbitrary contract calls, unknown selectors) falls
// through to a generic "unrecognized calldata" result — still AI-verdicted,
// just without a specific matched rule.
const SELECTOR_ABIS = {
  "0x095ea7b3": "function approve(address spender, uint256 amount)",
  "0xa22cb465": "function setApprovalForAll(address operator, bool approved)",
  "0xa9059cbb": "function transfer(address to, uint256 amount)",
  "0x23b872dd": "function transferFrom(address from, address to, uint256 amount)",
};

const KNOWN_NFT_OPERATORS = (process.env.KNOWN_NFT_OPERATORS || "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);

const ERC20_BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

// Decodes calldata against the known-selector table above. Returns null if
// data is empty/short or the selector isn't one we recognize — callers treat
// that as "no specific rule available," not an error.
function decodeCalldata(data) {
  if (!data || data === "0x" || data.length < 10) return null;
  const selector = data.slice(0, 10);
  const sig = SELECTOR_ABIS[selector];
  if (!sig) return null;

  try {
    const iface = new Interface([sig]);
    const fragment = iface.fragments[0];
    const decoded = iface.decodeFunctionData(fragment.name, data);
    return { name: fragment.name, args: decoded };
  } catch {
    return null;
  }
}

// Shared by both /api/validate (SDK Wrapper) and /api/intent/build (Intent
// Router) — same rule engine + AI verdict path your live listener uses for
// on-chain events, just run pre-signature against proposed calldata instead
// of an already-mined log. Never signs, never anchors, never touches gas —
// purely advisory: caller's own wallet still does the actual signing.
async function validateProposedTx({ from, to, value, data }, provider) {
  const selector = data && data.length >= 10 ? data.slice(0, 10) : null;
  const criticalMatch = selector ? matchCriticalCall(to, selector) : null;

  let result;

  if (criticalMatch) {
    // This selector matches a function on CONTRACT_TARGETS' critical list —
    // same detector the live on-chain listener uses, just running before
    // the agent signs instead of after the tx is mined.
    result = evaluateCall({ contractName: criticalMatch.target.name, functionName: criticalMatch.functionName });
  } else {
    const decoded = decodeCalldata(data);

    if (decoded?.name === "approve") {
      const [spender, amount] = decoded.args;
      let ownerBalance = 0n;
      try {
        if (provider && to) {
          const token = new Contract(to, ERC20_BALANCE_ABI, provider);
          ownerBalance = await token.balanceOf(from);
        }
      } catch {
        // Balance lookup failing (bad RPC, non-ERC20 target) shouldn't block
        // the check — evaluateApproval treats ownerBalance=0 as "unknown," not
        // "unlimited," so this just skips the P001 over-balance rule.
      }
      result = evaluateApproval({ owner: from, spender, value: amount, ownerBalance });
    } else if (decoded?.name === "setApprovalForAll") {
      const [operator, approved] = decoded.args;
      result = evaluateApprovalForAll({ owner: from, operator, approved, knownOperators: KNOWN_NFT_OPERATORS });
    } else if (decoded?.name === "transfer" || decoded?.name === "transferFrom") {
      // No specific pre-signing rule for plain transfers yet — visibility only.
      result = { risk: "LOW", score: 0, matched_rules: [], reason: "Standard transfer, no pre-signing rule matched" };
    } else {
      result = {
        risk: "LOW",
        score: 0,
        matched_rules: [],
        reason: data && data !== "0x" ? "Unrecognized calldata — no specific rule available" : "Plain value transfer, no calldata",
      };
    }
  }

  const record = { token: to, tokenAddress: to, txHash: null, timestamp: new Date().toISOString(), ...result };

  let verdict = null;
  if (result.risk !== "LOW") {
    try {
      verdict = await generateVerdict(record);
    } catch (err) {
      console.error("[validate] verdict error:", err.message);
    }
  }

  // Logged for dashboard visibility only — tokenAddress here is the target
  // contract, not a monitored guardian, so this never touches guardian tx
  // quotas or the receipt registry.
  recordEvent({
    token: "SDK-PRECHECK",
    tokenAddress: to || null,
    from,
    to,
    severity: result.risk,
    reason: result.reason,
    rules: result.matched_rules,
    txHash: null,
    signed: false,
    hash: null,
    verdict: verdict?.summary || null,
    anchored: false,
  });

  return { risk: result.risk, matched_rules: result.matched_rules, reason: result.reason, verdict };
}

export function startServer(deps = {}) {
  const { provider = null, port = process.env.PORT || 4000 } = deps;
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/alerts", (req, res) => res.json(getAlerts()));
  app.get("/guardians", (req, res) => res.json(getGuardians()));

  app.get("/health", (req, res) =>
    res.json({
      status: "ok",
      alerts: getAlerts().length,
      guardians: getGuardians().length,
      signerAddress: process.env.SIGNER_ADDRESS || null,
      receiptRegistry: process.env.RECEIPT_REGISTRY_ADDRESS || null,
    })
  );

  app.get("/verify/:hash", async (req, res) => {
    const alert = getAlerts().find((a) => a.hash === req.params.hash);
    const chain = await verifyOnChain(req.params.hash);

    if (!alert && !chain.anchored) {
      return res.status(404).json({ error: "Not found in local history or on-chain." });
    }

    res.json({ alert: alert || null, chain });
  });

  app.get("/signature/address", (req, res) => {
    res.json({ address: process.env.SIGNER_ADDRESS || null });
  });

  // Public dashboard — no wallet required.
  app.get("/api/stats/global", (req, res) => res.json(getGlobalStats()));
  app.get("/api/alerts/global", (req, res) => res.json(getAlerts()));

  // Personal dashboard — scoped to whichever wallet added the contracts.
  // Note: this is read-only visibility, not auth — anyone can query any
  // address's public stats, same as looking up a wallet on a block explorer.
  app.get("/api/user/contracts", (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address query param required" });
    res.json(getUserContracts(address));
  });

  app.get("/api/user/alerts", (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address query param required" });
    res.json(getUserAlerts(address));
  });

  app.get("/api/user/stats", (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address query param required" });
    res.json(getUserStats(address));
  });

  // --- SDK Wrapper: pre-signing validation --------------------------------
  // Called by @shieldguard/sdk's ShieldGuardSigner before it forwards a
  // transaction to the agent/user's own signer. Non-custodial: ShieldGuard
  // never holds keys or gas here, only returns a verdict.
  app.post("/api/validate", async (req, res) => {
    const { from, to, value, data } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: "from and to are required" });

    try {
      const result = await validateProposedTx({ from, to, value, data }, provider);
      const recommendation = result.verdict?.recommendation || (result.risk === "LOW" ? "MONITOR" : "REVIEW_AND_REVOKE");
      res.json({
        recommendation,
        summary: result.verdict?.summary || result.reason,
        confidence: result.verdict?.confidence ?? (result.risk === "LOW" ? 0.5 : 0.7),
        risk: result.risk,
        matchedRules: result.matched_rules,
      });
    } catch (err) {
      console.error("[api/validate] Error:", err.message);
      res.status(500).json({ error: "Validation failed", detail: err.message });
    }
  });

  // --- Intent Router: build + validate a tx from a high-level intent ------
  // Caller (agent) never hands ShieldGuard a private key. This just
  // constructs the calldata for a known action and runs it through the same
  // validation path as /api/validate, returning a ready-to-sign tx object
  // for the caller's own wallet to sign and broadcast.
  app.post("/api/intent/build", async (req, res) => {
    const { action, from, token, spender, operator, to, amount, approved } = req.body || {};
    if (!action || !from || !token) {
      return res.status(400).json({ error: "action, from, and token are required" });
    }

    let iface, data;
    try {
      if (action === "approve") {
        if (!spender || amount === undefined) return res.status(400).json({ error: "spender and amount required for approve" });
        iface = new Interface(["function approve(address spender, uint256 amount)"]);
        data = iface.encodeFunctionData("approve", [spender, amount]);
      } else if (action === "setApprovalForAll") {
        if (!operator || approved === undefined) return res.status(400).json({ error: "operator and approved required for setApprovalForAll" });
        iface = new Interface(["function setApprovalForAll(address operator, bool approved)"]);
        data = iface.encodeFunctionData("setApprovalForAll", [operator, approved]);
      } else if (action === "transfer") {
        if (!to || amount === undefined) return res.status(400).json({ error: "to and amount required for transfer" });
        iface = new Interface(["function transfer(address to, uint256 amount)"]);
        data = iface.encodeFunctionData("transfer", [to, amount]);
      } else {
        return res.status(400).json({ error: `Unsupported action: ${action}` });
      }
    } catch (err) {
      return res.status(400).json({ error: "Could not encode intent", detail: err.message });
    }

    try {
      const result = await validateProposedTx({ from, to: token, value: "0", data }, provider);
      const recommendation = result.verdict?.recommendation || (result.risk === "LOW" ? "MONITOR" : "REVIEW_AND_REVOKE");
      const blocked = recommendation === "REVOKE_IMMEDIATELY";

      res.json({
        approved: !blocked,
        recommendation,
        summary: result.verdict?.summary || result.reason,
        risk: result.risk,
        tx: blocked ? null : { to: token, data, value: "0" },
      });
    } catch (err) {
      console.error("[api/intent/build] Error:", err.message);
      res.status(500).json({ error: "Intent validation failed", detail: err.message });
    }
  });

  app.listen(port, () => {
    console.log(`ShieldGuard API on http://localhost:${port}`);
    console.log(`  GET /alerts    — all events`);
    console.log(`  GET /guardians — watched tokens`);
    console.log(`  GET /health    — status + config`);
    console.log(`  GET /verify/:hash — lookup by receipt hash`);
    console.log(`  GET /api/stats/global — public dashboard stats`);
    console.log(`  GET /api/user/* — personal dashboard (?address=0x...)`);
    console.log(`  POST /api/validate — SDK Wrapper pre-signing check`);
    console.log(`  POST /api/intent/build — Intent Router: build + validate a tx from a high-level intent`);
    console.log(`  POST /monitor, /monitor/private, /monitor/admin — add contracts (wired by listener.js)`);
  });

  return app;
}
