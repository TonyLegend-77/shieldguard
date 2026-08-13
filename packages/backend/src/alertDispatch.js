import crypto from "node:crypto";

// Outbound alert/webhook dispatch. This is intentionally a separate module
// from webhook.js — that file wires up POST /monitor, /monitor/private,
// /monitor/admin (contract registration), it does not send anything out.
// This module is the thing that actually POSTs to a downstream URL (Slack,
// PagerDuty, a partner's incident system, etc.) when something happens.
//
// Config (env):
//   ALERT_WEBHOOK_URLS   comma-separated list of destination URLs (required to send anything)
//   ALERT_WEBHOOK_SECRET shared HMAC signing secret (required to send anything)
//
// If either is unset, dispatch() is a no-op — logs once and returns. This
// keeps ShieldGuard's core detection/anchoring path fully decoupled from
// whether alerting is configured; a missing webhook secret should never be
// able to affect detection, signing, or anchoring.

const URLS = (process.env.ALERT_WEBHOOK_URLS || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const SECRET = process.env.ALERT_WEBHOOK_SECRET || null;

const REPLAY_TOLERANCE_NOTE =
  "Receiver should reject any signature whose t= timestamp is more than 300s old.";

const RETRY_DELAYS_MS = [1000, 5000, 25000, 120000]; // 1s, 5s, 25s, 2m — then dead-letter
const DEAD_LETTER_MAX = 500;

let warnedNoConfig = false;
const deadLetterQueue = [];

/**
 * Signs a raw JSON string. Timestamp is bound INTO the signature
 * (t + "." + rawBody), not the body alone — a receiver must reject a
 * request whose timestamp doesn't match what was actually signed, which
 * closes the gap where a captured payload gets replayed with a fresh
 * timestamp slapped on top.
 */
function sign(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const signature = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/** Exposed for anyone building a receiver/test harness against this dispatcher. */
export function verify(secret, rawBody, signatureHeader, toleranceSec = 300, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!signatureHeader) return { valid: false, reason: "missing_signature_header" };
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=").map((s) => s.trim())));
  const timestamp = Number(parts.t);
  const receivedSig = parts.v1;
  if (!timestamp || !receivedSig) return { valid: false, reason: "malformed_signature_header" };
  if (Math.abs(nowSeconds - timestamp) > toleranceSec) return { valid: false, reason: "stale_timestamp" };

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expBuf = Buffer.from(expected, "utf8");
  const recBuf = Buffer.from(receivedSig, "utf8");
  if (expBuf.length !== recBuf.length) return { valid: false, reason: "signature_mismatch" };
  return crypto.timingSafeEqual(expBuf, recBuf) ? { valid: true } : { valid: false, reason: "signature_mismatch" };
}

async function deliverOnce(url, rawBody, header) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ShieldGuard-Signature": header,
      "X-ShieldGuard-Event-Id": JSON.parse(rawBody).id,
    },
    body: rawBody,
  });
  if (!res.ok) throw new Error(`webhook POST ${url} returned ${res.status}`);
}

async function deliverWithRetry(url, rawBody, header) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await deliverOnce(url, rawBody, header);
      return;
    } catch (err) {
      if (attempt === RETRY_DELAYS_MS.length) {
        deadLetterQueue.push({ url, rawBody, header, failedAt: new Date().toISOString(), error: err.message });
        if (deadLetterQueue.length > DEAD_LETTER_MAX) deadLetterQueue.shift();
        console.error(`[alertDispatch] Giving up on ${url} after ${attempt} retries: ${err.message}`);
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`[alertDispatch] Delivery to ${url} failed (${err.message}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Fire an alert event. Fire-and-forget: never throws, never blocks the
 * caller on delivery — signing + queueing happens synchronously, actual
 * HTTP delivery (with retries) happens in the background. Detection,
 * verdict, signing, and anchoring must never be gated on whether an
 * alert successfully delivers.
 *
 * @param {string} type - e.g. "transaction.flagged", "transaction.blocked",
 *   "quota.threshold-reached", "ai.fallback-triggered"
 * @param {object} data - event-specific payload
 */
export function dispatchAlert(type, data) {
  if (!URLS.length || !SECRET) {
    if (!warnedNoConfig) {
      console.warn(
        "[alertDispatch] ALERT_WEBHOOK_URLS / ALERT_WEBHOOK_SECRET not configured — alerts are logged locally only."
      );
      warnedNoConfig = true;
    }
    console.log(`[alertDispatch] (unconfigured) ${type}:`, JSON.stringify(data));
    return;
  }

  const event = {
    id: `evt_${crypto.randomUUID()}`,
    type,
    created_at: new Date().toISOString(),
    data,
  };
  const rawBody = JSON.stringify(event);
  const header = sign(SECRET, rawBody);

  for (const url of URLS) {
    // Intentionally not awaited — see fire-and-forget note above.
    deliverWithRetry(url, rawBody, header).catch((err) => {
      console.error(`[alertDispatch] Unexpected error delivering to ${url}:`, err.message);
    });
  }
}

/** For an ops endpoint / manual replay — not wired to a route yet. */
export function getDeadLetterQueue() {
  return deadLetterQueue.slice();
}

export const _internal = { sign, RETRY_DELAYS_MS, REPLAY_TOLERANCE_NOTE };
