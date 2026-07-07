// Implements POLICY_RULE entries P001–P002 from bot_chain_threats.jsonl.
// ShieldGuard-defined thresholds, not claims about documented exploits.

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
