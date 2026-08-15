import { Contract } from "ethers";

// Shared by connections.js (premium connection upgrades) and webhook.js
// (private-tier contract payments) — both previously hardcoded an "assumed
// 18 decimals" comment instead of actually checking.
//
// Two-tier design:
// - getBotTokenDecimalsStrict: used by the actual payment-verification
//   paths. Fails CLOSED — throws if decimals() can't be resolved, so a
//   payment is rejected rather than checked against a guessed value. Money
//   is on the line here, so "verification unavailable" must not silently
//   become "verification passed against a wrong number."
// - verifyBotTokenDecimalsAtStartup: called once from listener.js's main().
//   Resolves and caches decimals() at boot and logs the result loudly
//   either way, so a misconfigured/unreachable BOT_TOKEN_ADDRESS shows up
//   in the startup logs immediately instead of as a mystery 500 the first
//   time someone tries to pay. Failing here does NOT crash the process —
//   the listener's main job is watching the chain, not payment processing,
//   so a token-decimals problem shouldn't take down monitoring. It just
//   means payment verification will keep failing closed (loudly, per
//   request) until BOT_TOKEN_ADDRESS/RPC_URL are fixed and the server
//   restarts.
let cachedDecimals = null;
let cachedTokenAddress = null;
let startupCheckOk = false;

const DECIMALS_ABI = ["function decimals() view returns (uint8)"];

async function resolveDecimals(provider, tokenAddress) {
  if (!tokenAddress) throw new Error("tokenAddress is required to resolve BOT token decimals");
  const key = tokenAddress.toLowerCase();
  if (cachedDecimals !== null && cachedTokenAddress === key) {
    return cachedDecimals;
  }
  const token = new Contract(tokenAddress, DECIMALS_ABI, provider);
  const decimals = await token.decimals();
  cachedDecimals = Number(decimals);
  cachedTokenAddress = key;
  return cachedDecimals;
}

/**
 * Resolves decimals() for the configured $BOT token contract. Throws if the
 * call fails or the cache is cold and can't be warmed — callers on a
 * payment-verification path should treat that as "reject this payment
 * attempt," not "assume 18 and proceed."
 */
export async function getBotTokenDecimalsStrict(provider, tokenAddress) {
  return resolveDecimals(provider, tokenAddress);
}

/**
 * Call once at server startup (listener.js main()) with BOT_TOKEN_ADDRESS.
 * Warms the cache so the per-request strict calls on the payment paths are
 * fast and don't each independently hit the RPC. Logs the outcome loudly
 * either way. Never throws — a startup problem here shouldn't crash the
 * listener; it should just mean payment verification fails closed later,
 * with a clear reason, until this is fixed.
 */
export async function verifyBotTokenDecimalsAtStartup(provider, tokenAddress) {
  if (!tokenAddress) {
    console.warn("[botToken] BOT_TOKEN_ADDRESS not set — private-tier and premium-connection payment verification will reject everything until it's configured.");
    startupCheckOk = false;
    return;
  }
  if (!provider) {
    console.warn("[botToken] No RPC provider available — cannot verify BOT token decimals() at startup. Payment verification will fail closed until this is resolved.");
    startupCheckOk = false;
    return;
  }
  try {
    const decimals = await resolveDecimals(provider, tokenAddress);
    startupCheckOk = true;
    console.log(`[botToken] ✅ Confirmed BOT token (${tokenAddress}) decimals() = ${decimals}. Payment verification will use this value.`);
  } catch (err) {
    startupCheckOk = false;
    console.error(
      `[botToken] ⚠️  CRITICAL: could not read decimals() from BOT_TOKEN_ADDRESS (${tokenAddress}): ${err.message}. ` +
      `Private-tier and premium-connection payments will be rejected (fail closed) until this resolves and the server restarts — ` +
      `no payment will be silently checked against an assumed decimals value.`
    );
  }
}

/** Whether the startup check succeeded — exposed for /health or diagnostics if useful. */
export function isBotTokenDecimalsVerified() {
  return startupCheckOk;
}

// Test-only escape hatch — lets a test reset the module-level cache between
// cases without needing to restart the process.
export function _resetDecimalsCacheForTests() {
  cachedDecimals = null;
  cachedTokenAddress = null;
  startupCheckOk = false;
}
