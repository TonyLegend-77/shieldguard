import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(__dirname, "..", "..", "..", "bot_chain_threats.jsonl");

let corpus = [];
try {
  const data = readFileSync(CORPUS_PATH, "utf-8");
  corpus = data.split("\n").filter(Boolean).map(JSON.parse);
} catch (e) {
  console.warn("[policyEngine] Corpus not loaded:", e.message);
}

function getContext(ruleIds) {
  return corpus.filter((c) => ruleIds.includes(c.id));
}

function templateVerdict(record) {
  const { risk, matched_rules, reason, token } = record;
  const isUnlimited =
    record.value === "115792089237316195423570985008687907853269984665640564039457584007913129639935";

  let summary = "";
  if (risk === "CRITICAL") {
    summary = `CRITICAL: This ${token} approval grants ${isUnlimited ? "unlimited" : "excessive"} spending power. ${reason}. Immediate revocation is strongly recommended.`;
  } else if (risk === "HIGH") {
    summary = `HIGH RISK: ${reason} on ${token}. Review this approval before proceeding with any further transactions.`;
  } else {
    summary = `Review recommended: ${reason} on ${token}. Monitor for follow-up activity.`;
  }

  return {
    summary,
    recommendation:
      risk === "CRITICAL"
        ? "REVOKE_IMMEDIATELY"
        : risk === "HIGH"
        ? "REVIEW_AND_REVOKE"
        : "MONITOR",
    confidence: risk === "CRITICAL" ? 0.95 : risk === "HIGH" ? 0.85 : 0.65,
    matchedRules: matched_rules,
    context: corpus
      .filter((c) => matched_rules.includes(c.id))
      .map((c) => ({ id: c.id, category: c.category, reasoning: c.reasoning })),
  };
}

async function openAIVerdict(record) {
  const ctx = getContext(record.matched_rules);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are ShieldGuard, a blockchain security analyst. Analyze the flagged approval and return ONLY a JSON object with keys: summary (1 sentence), recommendation (REVOKE_IMMEDIATELY, REVIEW_AND_REVOKE, or MONITOR), confidence (0.0-1.0), explanation (2 sentences max).",
        },
        {
          role: "user",
          content: `Flagged record: ${JSON.stringify(record)}\nRelevant patterns: ${JSON.stringify(
            ctx.map((c) => ({ id: c.id, reasoning: c.reasoning }))
          )}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function anthropicVerdict(record) {
  const ctx = getContext(record.matched_rules);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `Analyze this flagged blockchain approval and return JSON with keys: summary, recommendation, confidence, explanation.\n\nRecord: ${JSON.stringify(
            record
          )}\nPatterns: ${JSON.stringify(ctx.map((c) => ({ id: c.id, reasoning: c.reasoning })))}`,
        },
      ],
    }),
  });
  const data = await res.json();
  const text = data.content[0].text;
  const json = text.match(/\{[\s\S]*\}/);
  return JSON.parse(json ? json[0] : text);
}

export async function generateVerdict(record) {
  if (process.env.OPENAI_API_KEY) return openAIVerdict(record);
  if (process.env.ANTHROPIC_API_KEY) return anthropicVerdict(record);
  return templateVerdict(record);
}
