// Implements POLICY_RULE entries P001–P002 (ERC-20 approvals), N001–N002
// (ERC-721/1155 setApprovalForAll), A001–A003 (admin/owner privileged calls),
// and T001–T002 (spoofed/dust "address poisoning" transfers) from
// bot_chain_threats.jsonl. ShieldGuard-defined thresholds, not claims about
// documented exploits.

export const MAX_UINT256 = (2n ** 256n) - 1n;

export function evaluateApproval({ owner, spender, value, ownerBalance }) {
  const matched = [];
  let score = 0;

  // P002 — unlimited approval
  if (value === MAX_UINT256) {
    matched.push("P002");
    score += 30;
  }

  // P001 — approval far exceeds owner's balance
  if (ownerBalance > 0n && value > ownerBalance * 10n) {
    matched.push("P001");
    score += 30;
  }

  let risk = "LOW";
  if (score >= 50) risk = "CRITICAL";
  else if (score >= 30) risk = "HIGH";
  else if (score >= 15) risk = "MEDIUM";

  const reasonParts = [];
  if (matched.includes("P002")) reasonParts.push("Unlimited (max uint256) approval granted");
  if (matched.includes("P001")) {
    reasonParts.push(`Approval exceeds 10x owner balance`);
  }

  return {
    risk,
    score,
    matched_rules: matched,
    reason: reasonParts.length ? reasonParts.join("; ") : "No rule triggered",
    owner,
    spender,
    value: value.toString(),
  };
}

// ERC-721/1155 setApprovalForAll — the NFT equivalent of an unlimited ERC-20
// approve(). A single call hands the operator control over the owner's
// *entire* collection, not just one token — the mechanism behind most
// OpenSea-style drainer kits (the victim signs one "list your NFT" tx that is
// actually a blanket setApprovalForAll to the attacker's contract).
//
// knownOperators: optional lowercase allowlist (e.g. real marketplace conduit
// addresses) so legitimate marketplace approvals aren't flagged at the same
// severity as an unknown/attacker operator.
export function evaluateApprovalForAll({ owner, operator, approved, knownOperators = [] }) {
  const matched = [];
  let score = 0;
  const isKnown = knownOperators.map((a) => a.toLowerCase()).includes((operator || "").toLowerCase());

  if (approved && !isKnown) {
    // N001 — blanket collection-wide approval granted to an operator not on
    // the known-marketplace allowlist. HIGH by default since the blast
    // radius (entire collection) is inherently large.
    matched.push("N001");
    score += 35;
  } else if (approved && isKnown) {
    // N002 — approval to a recognized marketplace operator. Still logged
    // (visibility), scored low since this is expected, routine activity.
    matched.push("N002");
    score += 5;
  }

  let risk = "LOW";
  if (score >= 50) risk = "CRITICAL";
  else if (score >= 30) risk = "HIGH";
  else if (score >= 15) risk = "MEDIUM";

  const reasonParts = [];
  if (matched.includes("N001")) {
    reasonParts.push("Blanket setApprovalForAll granted to an unrecognized operator — full collection at risk");
  }
  if (matched.includes("N002")) {
    reasonParts.push("setApprovalForAll granted to a known marketplace operator");
  }

  return {
    risk,
    score,
    matched_rules: matched,
    reason: reasonParts.length ? reasonParts.join("; ") : "No rule triggered",
    owner,
    operator,
    approved,
  };
}

// Admin/owner privileged-function monitoring — protocol-level risk
// (compromised owner keys, unexpected ownership handoffs, contract paused/
// unpaused outside expected maintenance windows), distinct from the
// user-wallet risk covered by the rules above.
//
// eventName: one of "OwnershipTransferred" | "Paused" | "Unpaused"
// expectedOwner: optional lowercase address ShieldGuard believes should be
// the legitimate owner/pauser, so a transfer *away* from it scores higher
// than routine, expected admin activity.
export function evaluateAdminEvent({ eventName, args = {}, expectedOwner = null }) {
  const matched = [];
  let score = 0;
  const exp = expectedOwner ? expectedOwner.toLowerCase() : null;

  if (eventName === "OwnershipTransferred") {
    const from = (args.previousOwner || "").toLowerCase();
    if (exp && from === exp) {
      // A003 — ownership moved away from the address ShieldGuard expects to
      // hold it. CRITICAL: the single highest-impact event a monitored
      // contract can emit.
      matched.push("A003");
      score += 50;
    } else {
      // A001 — ownership transfer observed with no expected-owner baseline
      // configured yet. Still notable, scored HIGH pending confirmation.
      matched.push("A001");
      score += 30;
    }
  } else if (eventName === "Paused" || eventName === "Unpaused") {
    // A002 — contract paused/unpaused. Routine if scheduled, but since
    // ShieldGuard has no maintenance-window concept yet, every occurrence
    // is flagged for human review.
    matched.push("A002");
    score += 20;
  }

  let risk = "LOW";
  if (score >= 50) risk = "CRITICAL";
  else if (score >= 30) risk = "HIGH";
  else if (score >= 15) risk = "MEDIUM";

  const reasonParts = [];
  if (matched.includes("A003")) reasonParts.push("Ownership transferred away from the expected owner address");
  if (matched.includes("A001")) reasonParts.push("Ownership transfer observed (no expected-owner baseline configured)");
  if (matched.includes("A002")) reasonParts.push(`Contract ${eventName.toLowerCase()} by ${args.account || "unknown"}`);

  return {
    risk,
    score,
    matched_rules: matched,
    reason: reasonParts.length ? reasonParts.join("; ") : "No rule triggered",
    eventName,
    args,
  };
}

// Spoofed/dust token transfer heuristic — "address poisoning." Scammers send
// a zero-value (or dust) transfer from a wallet crafted to share the same
// leading/trailing characters as one the victim regularly pays, hoping the
// victim later copies the poisoned address from their tx history instead of
// the real one. Detectable purely from transfer logs — no contract-age or
// verification lookup required.
//
// watchAddresses: lowercase addresses ShieldGuard already has on file for
// this user/guardian (e.g. previously-seen "to" addresses) to compare
// against for lookalike matches.
export function evaluateTransferSpoof({ from, to, value, watchAddresses = [] }) {
  const matched = [];
  let score = 0;

  if (value === 0n) {
    const fromLc = (from || "").toLowerCase();
    const lookalike = watchAddresses.some((addr) => {
      const a = addr.toLowerCase();
      return a !== fromLc && a.slice(0, 6) === fromLc.slice(0, 6) && a.slice(-4) === fromLc.slice(-4);
    });

    if (lookalike) {
      // T001 — zero-value transfer from an address crafted to resemble one
      // already in this user's transaction history.
      matched.push("T001");
      score += 40;
    } else {
      // T002 — zero-value transfer with no lookalike match. Lower severity:
      // could still be routine dust/spam, not necessarily targeted.
      matched.push("T002");
      score += 10;
    }
  }

  let risk = "LOW";
  if (score >= 50) risk = "CRITICAL";
  else if (score >= 30) risk = "HIGH";
  else if (score >= 15) risk = "MEDIUM";

  const reasonParts = [];
  if (matched.includes("T001")) {
    reasonParts.push("Zero-value transfer from an address disguised to resemble a known contact — likely address poisoning");
  }
  if (matched.includes("T002")) {
    reasonParts.push("Zero-value transfer detected (unsolicited dust)");
  }

  return {
    risk,
    score,
    matched_rules: matched,
    reason: reasonParts.length ? reasonParts.join("; ") : "No rule triggered",
    from,
    to,
    value: value.toString(),
  };
}
