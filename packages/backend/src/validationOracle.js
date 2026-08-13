import { ethers } from "ethers";
import { matchCriticalCall } from "./contractTargets.js";
import { generateVerdict } from "./policyEngine.js";
import { MAX_UINT256 } from "./ruleEngine.js";
import { StateDiffExtractor } from "./stateDiffExtractor.js";
import { dispatchAlert } from "./alertDispatch.js";

// This is the actual enforcement decision-maker. Its output feeds
// ShieldGuardValidator7579.sol on-chain: if this module returns a
// co-signature, the UserOp CAN be validated on-chain. If it returns null,
// there's no signature, and the on-chain validator has no code path to
// accept the operation anyway — that's the whole point of moving
// enforcement here instead of leaving it to the SDK/agent.
//
// Decision matrix (deterministic rules are a hard floor — AI can escalate
// a PASS to BLOCK, but can never override a hard-rule BLOCK to ALLOW):
//
//   Hard rules        AI advisory       Final
//   ─────────────────────────────────────────────
//   BLOCK              (irrelevant)      BLOCK
//   PASS                BLOCK            BLOCK
//   PASS                FLAG             FLAG_REVIEW
//   PASS                ALLOW            ALLOW

const DEFAULT_VALID_WINDOW_SECONDS = 60;

export class ValidationOracle {
  /**
   * @param {object} opts
   * @param {string} opts.oraclePrivateKey - REQUIRED. Should be a dedicated
   *   key, not SIGNER_PRIVATE_KEY reused from anchoring/deployment. If this
   *   key is compromised, an attacker can forge co-signatures for ANY
   *   transaction on ANY account that trusts this oracle address — treat
   *   it with at least the same care as a mainnet deployer key, arguably
   *   more, since this one actively authorizes live transactions rather
   *   than just deploying contracts.
   * @param {string} opts.rpcUrl
   */
  constructor({ oraclePrivateKey, rpcUrl }) {
    if (!oraclePrivateKey) {
      throw new Error(
        "ORACLE_PRIVATE_KEY is required — this is the key that co-signs every " +
          "allowed transaction. Do not default this to SIGNER_PRIVATE_KEY."
      );
    }
    this.wallet = new ethers.Wallet(oraclePrivateKey);
    this.stateDiff = new StateDiffExtractor(rpcUrl);
    console.log("[ValidationOracle] Oracle signing address:", this.wallet.address);
  }

  getOracleAddress() {
    return this.wallet.address;
  }

  /**
   * @param {object} params
   * @param {string} params.userOpHash - the UserOperation hash the on-chain
   *   validator will check the co-signature against.
   * @param {string} params.sender - the smart account address.
   * @param {string} params.to - call target.
   * @param {string} params.data - calldata.
   * @param {bigint} [params.value] - native value.
   * @param {object} [params.context] - optional extra context (token symbol,
   *   agent id, etc.) passed through to the AI advisory step and to alerts.
   * @returns {Promise<{decision: string, oracleSignature?: string, validUntil?: number, reason: string, stage: string}>}
   */
  async evaluate({ userOpHash, sender, to, data, value = 0n, context = {} }) {
    const selector = data && data.length >= 10 ? data.slice(0, 10) : null;
    const criticalMatch = selector ? matchCriticalCall(to, selector) : null;

    // --- Stage 1: deterministic hard-floor rules ---
    const hardFloor = this._evaluateHardFloor({ to, data, criticalMatch });

    if (hardFloor.decision === "BLOCK") {
      this._alert("transaction.blocked", { sender, to, selector, reason: hardFloor.reason, stage: "hard_floor", context });
      return { decision: "BLOCK", reason: hardFloor.reason, stage: "hard_floor" };
    }

    // --- Stage 2: simulation (best-effort — see stateDiffExtractor.js
    // caveat about trace_call support being unverified on BOT Chain) ---
    let simResult = null;
    try {
      simResult = await this.stateDiff.extractStateDiff({ from: sender, to, data, value });
    } catch (err) {
      console.error("[ValidationOracle] Simulation failed:", err.message);
      // Simulation failing is NOT the same as the transaction being safe.
      // Fail toward caution: if we can't see what it does, treat it as
      // unverified rather than silently skipping to AI/allow.
      simResult = { mode: "simulation_failed", reverted: null, storageMutations: [] };
    }

    if (simResult.mode !== "eth_call_fallback" && simResult.mode !== "simulation_failed") {
      const proxyUpgrade = simResult.storageMutations?.find((m) => m.isEIP1967ImplementationSlot);
      if (proxyUpgrade && !(criticalMatch && context.allowProxyUpgrade)) {
        const reason = `Simulation detected a write to the EIP-1967 implementation slot on ${proxyUpgrade.contract} — proxy upgrade`;
        this._alert("transaction.blocked", { sender, to, selector, reason, stage: "simulation", context });
        return { decision: "BLOCK", reason, stage: "simulation", simulationMode: simResult.mode };
      }
    }

    // --- Stage 3: AI advisory (never overrides the hard floor above; can
    // only escalate PASS toward BLOCK/FLAG) ---
    let verdict = null;
    try {
      verdict = await generateVerdict({
        token: context.tokenName || (criticalMatch ? criticalMatch.target.name : to),
        txHash: null,
        risk: criticalMatch ? "HIGH" : "LOW",
        matched_rules: criticalMatch ? [`C001:${criticalMatch.functionName}`] : [],
        reason: criticalMatch ? `Critical function call: ${criticalMatch.functionName}` : "No rule triggered",
        simulation: simResult,
      });
      if (verdict._provider === "template") {
        this._alert("ai.fallback-triggered", { sender, to, reason: "AI providers unavailable — oracle decision used template only", context });
      }
    } catch (err) {
      console.error("[ValidationOracle] AI advisory failed, proceeding on hard-floor result only:", err.message);
    }

    if (verdict?.recommendation === "REVOKE_IMMEDIATELY") {
      const reason = verdict.summary || "AI advisory flagged this transaction as critical risk";
      this._alert("transaction.blocked", { sender, to, selector, reason, stage: "ai_advisory", context });
      return { decision: "BLOCK", reason, stage: "ai_advisory", simulationMode: simResult.mode };
    }

    if (verdict?.recommendation === "REVIEW_AND_REVOKE") {
      const reason = verdict.summary || "AI advisory flagged this transaction for review";
      this._alert("transaction.flagged", { sender, to, selector, reason, stage: "ai_advisory", context });
      return { decision: "FLAG_REVIEW", reason, stage: "ai_advisory", simulationMode: simResult.mode };
    }

    // --- Stage 4: ALLOW — issue the co-signature ---
    const coSigned = await this._coSign(userOpHash);
    return { ...coSigned, simulationMode: simResult.mode };
  }

  _evaluateHardFloor({ to, data, criticalMatch }) {
    // Unlimited approve() — approve(address,uint256) selector 0x095ea7b3,
    // amount is the second 32-byte word.
    if (data && data.startsWith("0x095ea7b3") && data.length >= 138) {
      const amountHex = "0x" + data.slice(74, 138);
      try {
        if (BigInt(amountHex) === MAX_UINT256) {
          return { decision: "BLOCK", reason: "Unlimited approval (type(uint256).max) — hard floor rule, no override" };
        }
      } catch {
        /* malformed calldata, fall through to other checks */
      }
    }

    // Unlimited setApprovalForAll(address,bool) doesn't have an "amount" to
    // check — the risk is binary (approved = true grants full operator
    // rights over the whole collection), so any true value is critical.
    if (data && data.startsWith("0xa22cb465") && data.length >= 138) {
      const approvedFlag = data.slice(-64);
      if (approvedFlag.endsWith("1")) {
        return { decision: "BLOCK", reason: "setApprovalForAll(true) — full operator approval, hard floor rule" };
      }
    }

    // NOTE: no address blocklist exists in this codebase yet. If/when one
    // is built, the check belongs here — a poisoned/blacklisted `to` or
    // decoded spender/recipient should hard-BLOCK regardless of AI verdict,
    // same as the approval checks above.

    // matchCriticalCall() returns { target, functionName } — there's no
    // riskClass field on that result (the mainnet critical-function
    // classifier tags contracts with a flat criticalFunctions[] list, not
    // per-function risk classes). Match by name against the same
    // ownership-transfer pattern set used when that list was built.
    const OWNERSHIP_TRANSFER_NAMES = new Set([
      "transferOwnership",
      "renounceOwnership",
      "acceptOwnership",
      "changeOwner",
      "setOwner",
    ]);
    if (criticalMatch && OWNERSHIP_TRANSFER_NAMES.has(criticalMatch.functionName)) {
      return { decision: "BLOCK", reason: `Ownership-transfer function called: ${criticalMatch.functionName} — hard floor rule` };
    }

    return { decision: "PASS", reason: "No hard-floor rule matched" };
  }

  async _coSign(userOpHash, validWindowSeconds = DEFAULT_VALID_WINDOW_SECONDS) {
    const validUntil = Math.floor(Date.now() / 1000) + validWindowSeconds;

    // Must match ShieldGuardValidator7579.sol's oracleSignableHash exactly:
    // keccak256(abi.encodePacked(userOpHash, validUntil)), then EIP-191
    // personal-sign prefixed — ethers' wallet.signMessage on raw bytes does
    // that prefixing automatically, matching the contract's
    // _toEthSignedMessageHash. validUntil is packed as uint48 (6 bytes) to
    // match abi.encodePacked(bytes32, uint48) on the Solidity side.
    const packed = ethers.solidityPacked(["bytes32", "uint48"], [userOpHash, validUntil]);
    const digest = ethers.keccak256(packed);
    const oracleSignature = await this.wallet.signMessage(ethers.getBytes(digest));

    return {
      decision: "ALLOW",
      reason: "Passed hard-floor rules and AI advisory",
      stage: "co_signed",
      oracleSignature,
      validUntil,
      oracleAddress: this.wallet.address,
    };
  }

  _alert(type, data) {
    try {
      dispatchAlert(type, data);
    } catch (err) {
      console.error("[ValidationOracle] Alert dispatch failed (non-fatal):", err.message);
    }
  }
}
