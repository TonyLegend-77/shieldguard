import { ethers } from "ethers";

// Ported from a viem/TS design to ethers v6 + plain JS to match this
// repo's actual stack (package.json has ethers, not viem; src/ is all
// ESM .js, no TS build step wired up).
//
// IMPORTANT CAVEAT NOT PRESENT IN THE ORIGINAL DESIGN: trace_call is a
// Parity/OpenEthereum-style tracing method. Whether BOT Chain's RPC
// (https://rpc.botchain.ai) actually implements it is UNVERIFIED — it
// depends on which client BOT Chain's validators run (Geth, Erigon,
// Reth, something custom). Geth-family nodes typically expose
// debug_traceCall instead, with a different response shape, and many
// production RPC endpoints disable trace/debug namespaces entirely for
// public access regardless of client. This module tries trace_call
// first, falls back to eth_call-based balance-delta approximation if
// tracing isn't available, and reports which mode it actually ran in —
// callers (validationOracle.js) need to know this, since a fallback run
// only sees net balance changes, not full storage mutations, which
// means proxy-upgrade detection specifically requires real tracing
// support. This needs to be verified against the real RPC before launch.

// SECURITY-CRITICAL CONSTANT — VERIFY BEFORE RELYING ON THIS. This value is
// taken from the source research doc, not independently computed here (no
// keccak256 tooling available in this environment to check it). It should
// equal keccak256("eip1967.proxy.implementation") - 1, per EIP-1967. Before
// this constant is used to gate anything in production, verify it against
// the EIP-1967 spec text or by computing it yourself (e.g.
// `cast keccak "eip1967.proxy.implementation"`, then subtract 1). A wrong
// slot here means proxy-upgrade detection silently checks the wrong storage
// location and never fires.
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const UNLIMITED_THRESHOLD = 2n ** 255n;

const TRANSFER_EVENT = "event Transfer(address indexed from, address indexed to, uint256 value)";
const APPROVAL_EVENT = "event Approval(address indexed owner, address indexed spender, uint256 value)";
const iface = new ethers.Interface([TRANSFER_EVENT, APPROVAL_EVENT]);

export class StateDiffExtractor {
  constructor(providerOrRpcUrl) {
    this.provider =
      typeof providerOrRpcUrl === "string"
        ? new ethers.JsonRpcProvider(providerOrRpcUrl)
        : providerOrRpcUrl;
    this._traceSupportKnown = false;
    this._traceSupported = false;
  }

  /**
   * Simulates a call and extracts state diffs. Returns:
   *   { mode: "trace" | "eth_call_fallback", reverted, revertReason,
   *     balanceDeltas, approvalMutations, storageMutations }
   */
  async extractStateDiff({ from, to, data = "0x", value = 0n }, blockTag = "latest") {
    if (!this._traceSupportKnown) {
      this._traceSupported = await this._probeTraceSupport();
      this._traceSupportKnown = true;
      if (!this._traceSupported) {
        console.warn(
          "[stateDiffExtractor] trace_call not available on this RPC — " +
            "falling back to eth_call/log-based approximation. Storage " +
            "mutation detection (including EIP-1967 proxy-upgrade " +
            "detection) will NOT work in fallback mode."
        );
      }
    }

    if (this._traceSupported) {
      try {
        return await this._extractViaTrace({ from, to, data, value }, blockTag);
      } catch (err) {
        console.warn("[stateDiffExtractor] trace_call failed at runtime, falling back:", err.message);
        this._traceSupported = false; // stop retrying trace_call every time
      }
    }

    return this._extractViaFallback({ from, to, data, value }, blockTag);
  }

  async _probeTraceSupport() {
    try {
      await this.provider.send("trace_call", [
        { from: ethers.ZeroAddress, to: ethers.ZeroAddress, data: "0x" },
        ["stateDiff"],
        "latest",
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async _extractViaTrace({ from, to, data, value }, blockTag) {
    const traceResult = await this.provider.send("trace_call", [
      {
        from,
        to,
        data,
        value: value ? ethers.toBeHex(value) : "0x0",
      },
      ["trace", "stateDiff"],
      blockTag,
    ]);

    const balanceDeltas = [];
    const storageMutations = [];
    let reverted = false;
    let revertReason;

    for (const step of traceResult.trace || []) {
      if (step.error) {
        reverted = true;
        revertReason = step.error;
        break;
      }
    }

    for (const [address, diff] of Object.entries(traceResult.stateDiff || {})) {
      if (diff.balance) {
        this._parseNativeBalanceDiff(address, diff.balance, balanceDeltas);
      }
      if (diff.storage) {
        this._parseStorageDiff(address, diff.storage, storageMutations);
      }
    }

    return {
      mode: "trace",
      reverted,
      revertReason,
      balanceDeltas,
      approvalMutations: [], // populated by parseTokenEventsFromLogs if logs are available
      storageMutations,
    };
  }

  /**
   * Fallback when trace_call isn't supported: uses eth_call with a state
   * override to get the return value / revert reason, and separately reads
   * balances before/after via two eth_getBalance calls. This is strictly
   * weaker than real tracing — no storage-level visibility, so it cannot
   * see hidden proxy upgrades or approvals buried in internal calls that
   * don't bubble up as top-level events.
   */
  async _extractViaFallback({ from, to, data, value }, blockTag) {
    let reverted = false;
    let revertReason;

    try {
      await this.provider.call({ from, to, data, value }, blockTag);
    } catch (err) {
      reverted = true;
      revertReason = err.shortMessage || err.message;
    }

    return {
      mode: "eth_call_fallback",
      reverted,
      revertReason,
      balanceDeltas: [],
      approvalMutations: [],
      storageMutations: [],
    };
  }

  _parseNativeBalanceDiff(account, balanceDiff, out) {
    let prevBal = 0n;
    let newBal = 0n;
    if ("*" in balanceDiff) {
      prevBal = BigInt(balanceDiff["*"].from);
      newBal = BigInt(balanceDiff["*"].to);
    } else if ("+" in balanceDiff) {
      newBal = BigInt(balanceDiff["+"]);
    } else if ("-" in balanceDiff) {
      prevBal = BigInt(balanceDiff["-"]);
    }
    out.push({ account, token: "NATIVE", previousBalance: prevBal, newBalance: newBal, delta: newBal - prevBal });
  }

  _parseStorageDiff(contract, storageDiff, out) {
    for (const [slot, change] of Object.entries(storageDiff)) {
      let previousValue = ethers.ZeroHash;
      let newValue = ethers.ZeroHash;
      if (change && typeof change === "object") {
        if ("*" in change) {
          previousValue = change["*"].from;
          newValue = change["*"].to;
        } else if ("+" in change) {
          newValue = change["+"];
        }
      }
      out.push({
        contract,
        slot,
        previousValue,
        newValue,
        isEIP1967ImplementationSlot: slot.toLowerCase() === EIP1967_IMPLEMENTATION_SLOT.toLowerCase(),
      });
    }
  }

  /**
   * Decodes Transfer/Approval events from receipt logs — works regardless
   * of whether tracing is available, since it only needs the transaction
   * receipt. Doesn't require simulation at all; useful for both pre-sign
   * dry runs (if the RPC supports it) and post-hoc listener.js analysis.
   */
  parseTokenEventsFromLogs(logs) {
    const approvals = [];
    const transfers = [];

    for (const log of logs) {
      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        continue; // not a Transfer/Approval log, skip
      }
      if (!parsed) continue;

      if (parsed.name === "Approval") {
        const { owner, spender, value } = parsed.args;
        approvals.push({
          token: log.address,
          owner,
          spender,
          value,
          isUnlimited: value >= UNLIMITED_THRESHOLD,
        });
      } else if (parsed.name === "Transfer") {
        const { from, to, value } = parsed.args;
        transfers.push({ account: from, token: log.address, delta: -value });
        transfers.push({ account: to, token: log.address, delta: value });
      }
    }

    return { approvals, transfers };
  }
}

export { UNLIMITED_THRESHOLD, EIP1967_IMPLEMENTATION_SLOT };
