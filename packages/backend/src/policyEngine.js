import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(__dirname, "..", "bot_chain_threats.jsonl");

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

// Primary provider for mainnet: fast + free-tier friendly. Falls back to
// a secondary Gemini model, then OpenAI, then Anthropic, then the local
// template if all of those error or aren't configured.

// Tries a single Gemini model with 503 backoff retries. Throws on final failure.
async function callGeminiModel(model, record, ctx, maxRetries = 2) {
  const prompt = `You are ShieldGuard, a blockchain security analyst. Analyze the flagged approval and return ONLY a JSON object (no markdown fences, no prose) with keys: summary (1 sentence), recommendation (REVOKE_IMMEDIATELY, REVIEW_AND_REVOKE, or MONITOR), confidence (0.0-1.0), explanation (2 sentences max).

Flagged record: ${JSON.stringify(record)}
Relevant patterns: ${JSON.stringify(ctx.map((c) => ({ id: c.id, reasoning: c.reasoning })))}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });

  // Gemini's free-tier Flash models occasionally return 503 UNAVAILABLE under
  // load spikes — this is transient, not a config/quota problem, so a couple
  // of short backoff retries recover most of these before we give up.
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error(`Empty Gemini response (${model})`);
      // Gemini sometimes wraps output in markdown fences even with JSON mode set.
      const cleanText = text.replace(/^```json\s*|\s*```$/g, "").trim();
      return JSON.parse(cleanText);
    }

    const errText = await res.text();
    lastErr = new Error(`Gemini API (${model}) returned ${res.status}: ${errText}`);

    if (res.status === 503 && attempt < maxRetries) {
      const waitMs = 500 * 2 ** attempt + Math.random() * 250;
      console.warn(`[policyEngine] Gemini ${model} 503, retrying in ${Math.round(waitMs)}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    throw lastErr;
  }

  throw lastErr;
}

// Tries gemini-3.5-flash first (primary, exhausts its own retries), then
// falls back to gemini-2.5-flash as a secondary model before this whole
// function throws and control passes to OpenAI/Anthropic/template.
async function geminiVerdict(record) {
  const ctx = getContext(record.matched_rules);

  try {
    return await callGeminiModel("gemini-3.5-flash", record, ctx);
  } catch (err) {
    console.warn("[policyEngine] gemini-3.5-flash exhausted, trying gemini-2.5-flash:", err.message);
    return await callGeminiModel("gemini-2.5-flash", record, ctx);
  }
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
  if (process.env.GEMINI_API_KEY) {
    try {
      return await geminiVerdict(record);
    } catch (err) {
      console.error("[policyEngine] Gemini failed, falling back:", err.message);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      return await openAIVerdict(record);
    } catch (err) {
      console.error("[policyEngine] OpenAI failed, falling back:", err.message);
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await anthropicVerdict(record);
    } catch (err) {
      console.error("[policyEngine] Anthropic failed, falling back:", err.message);
    }
  }
  return templateVerdict(record);
}
