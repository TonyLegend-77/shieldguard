import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "node:crypto";

// Personal dashboard connections: a wallet owner registers wallets/agents
// they want watched, links a Telegram account, and gets alerts routed to
// them when something they're watching gets flagged elsewhere in the
// system (listener.js / server.js / validationOracle.js).
//
// This is a SEPARATE concept from CONTRACT_TARGETS (contracts ShieldGuard
// monitors globally) and from Guardians (store.js's tiered contract
// registration for the public monitoring dashboard) — this is end users
// subscribing to alerts about specific addresses they care about.

export const FREE_CONNECTION_LIMIT = 1;
export const PREMIUM_CONNECTION_LIMIT = 20;
export const PREMIUM_PRICE_BOT = 1n * 10n ** 18n; // 1 BOT token, assuming 18 decimals — VERIFY against the real WBOT contract's decimals() before relying on this in production, not assumed here.

const __dirname = dirname(fileURLToPath(import.meta.url));
const USE_SQLITE = process.env.USE_SQLITE === "true";
const DB_PATH = process.env.SQLITE_PATH || join(__dirname, "..", "shieldguard.db");

// --- Storage backend ---
// In-memory by default (resets on restart, fine for dev/demo). If
// USE_SQLITE=true, persists to the same SQLite file store.sqlite.js uses,
// in its own table — consistent with how this repo already handles the
// dev/production storage split for guardians and alerts.

let db = null;
if (USE_SQLITE) {
  const { default: Database } = await import("better-sqlite3");
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS connection_owners (
      ownerAddress TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      premiumPaymentTx TEXT,
      telegramChatId TEXT,
      telegramLinkCode TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watched_addresses (
      id TEXT PRIMARY KEY,
      ownerAddress TEXT NOT NULL,
      watchAddress TEXT NOT NULL,
      type TEXT NOT NULL,
      addedAt TEXT NOT NULL,
      UNIQUE(ownerAddress, watchAddress)
    );
  `);
}

// In-memory fallback structures (used directly when USE_SQLITE is off;
// also used as the read path is written identically either way below via
// small helper functions, so callers don't need to branch).
const memOwners = new Map(); // ownerAddress(lowercase) -> { tier, premiumPaymentTx, telegramChatId, telegramLinkCode, createdAt }
const memWatched = new Map(); // ownerAddress(lowercase) -> Map(watchAddress(lowercase) -> { type, addedAt })

function getOwner(ownerAddress) {
  const key = ownerAddress.toLowerCase();
  if (USE_SQLITE) {
    return db.prepare("SELECT * FROM connection_owners WHERE ownerAddress = ?").get(key) || null;
  }
  return memOwners.get(key) ? { ownerAddress: key, ...memOwners.get(key) } : null;
}

function ensureOwner(ownerAddress) {
  const key = ownerAddress.toLowerCase();
  const existing = getOwner(key);
  if (existing) return existing;

  const record = { tier: "free", premiumPaymentTx: null, telegramChatId: null, telegramLinkCode: null, createdAt: new Date().toISOString() };
  if (USE_SQLITE) {
    db.prepare(
      "INSERT INTO connection_owners (ownerAddress, tier, premiumPaymentTx, telegramChatId, telegramLinkCode, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(key, record.tier, record.premiumPaymentTx, record.telegramChatId, record.telegramLinkCode, record.createdAt);
  } else {
    memOwners.set(key, record);
  }
  return { ownerAddress: key, ...record };
}

function listWatched(ownerAddress) {
  const key = ownerAddress.toLowerCase();
  if (USE_SQLITE) {
    return db.prepare("SELECT watchAddress, type, addedAt FROM watched_addresses WHERE ownerAddress = ? ORDER BY addedAt ASC").all(key);
  }
  const m = memWatched.get(key);
  return m ? [...m.entries()].map(([watchAddress, v]) => ({ watchAddress, ...v })) : [];
}

function limitFor(tier) {
  return tier === "premium" ? PREMIUM_CONNECTION_LIMIT : FREE_CONNECTION_LIMIT;
}

/**
 * @returns {{ ok: boolean, reason?: string, connections?: object[] }}
 */
export function addConnection(ownerAddress, watchAddress, type = "wallet") {
  if (!ownerAddress || !watchAddress) return { ok: false, reason: "ownerAddress and watchAddress are required" };
  if (!["wallet", "agent"].includes(type)) return { ok: false, reason: "type must be 'wallet' or 'agent'" };

  const owner = ensureOwner(ownerAddress);
  const current = listWatched(ownerAddress);
  const limit = limitFor(owner.tier);

  if (current.some((c) => c.watchAddress.toLowerCase() === watchAddress.toLowerCase())) {
    return { ok: false, reason: "Already connected" };
  }
  if (current.length >= limit) {
    return {
      ok: false,
      reason:
        owner.tier === "free"
          ? `Free tier allows ${FREE_CONNECTION_LIMIT} connection. Upgrade to premium (1 BOT) for up to ${PREMIUM_CONNECTION_LIMIT}.`
          : `Premium tier limit (${PREMIUM_CONNECTION_LIMIT}) reached.`,
    };
  }

  const key = ownerAddress.toLowerCase();
  const addedAt = new Date().toISOString();
  if (USE_SQLITE) {
    db.prepare("INSERT INTO watched_addresses (id, ownerAddress, watchAddress, type, addedAt) VALUES (?, ?, ?, ?, ?)").run(
      crypto.randomUUID(),
      key,
      watchAddress.toLowerCase(),
      type,
      addedAt
    );
  } else {
    if (!memWatched.has(key)) memWatched.set(key, new Map());
    memWatched.get(key).set(watchAddress.toLowerCase(), { type, addedAt });
  }

  return { ok: true, connections: listWatched(ownerAddress) };
}

export function removeConnection(ownerAddress, watchAddress) {
  const key = ownerAddress.toLowerCase();
  if (USE_SQLITE) {
    db.prepare("DELETE FROM watched_addresses WHERE ownerAddress = ? AND watchAddress = ?").run(key, watchAddress.toLowerCase());
  } else {
    memWatched.get(key)?.delete(watchAddress.toLowerCase());
  }
  return { ok: true, connections: listWatched(ownerAddress) };
}

export function getConnectionSummary(ownerAddress) {
  const owner = ensureOwner(ownerAddress);
  const connections = listWatched(ownerAddress);
  return {
    ownerAddress: owner.ownerAddress,
    tier: owner.tier,
    limit: limitFor(owner.tier),
    used: connections.length,
    telegramLinked: !!owner.telegramChatId,
    connections,
  };
}

export function generateTelegramLinkCode(ownerAddress) {
  const owner = ensureOwner(ownerAddress);
  const code = crypto.randomBytes(4).toString("hex"); // short, human-typeable into Telegram as /start <code>
  const key = ownerAddress.toLowerCase();
  if (USE_SQLITE) {
    db.prepare("UPDATE connection_owners SET telegramLinkCode = ? WHERE ownerAddress = ?").run(code, key);
  } else {
    memOwners.set(key, { ...memOwners.get(key), telegramLinkCode: code });
  }
  return code;
}

/**
 * Called from the Telegram webhook handler when a user sends /start <code>.
 * Returns the ownerAddress that was linked, or null if the code didn't match.
 */
export function linkTelegramByCode(code, chatId) {
  let ownerAddress = null;
  if (USE_SQLITE) {
    const row = db.prepare("SELECT ownerAddress FROM connection_owners WHERE telegramLinkCode = ?").get(code);
    if (row) {
      ownerAddress = row.ownerAddress;
      db.prepare("UPDATE connection_owners SET telegramChatId = ?, telegramLinkCode = NULL WHERE ownerAddress = ?").run(String(chatId), ownerAddress);
    }
  } else {
    for (const [addr, rec] of memOwners.entries()) {
      if (rec.telegramLinkCode === code) {
        ownerAddress = addr;
        memOwners.set(addr, { ...rec, telegramChatId: String(chatId), telegramLinkCode: null });
        break;
      }
    }
  }
  return ownerAddress;
}

/**
 * Returns [{ ownerAddress, telegramChatId }] for every owner currently
 * watching the given address AND who has a linked Telegram chat — this is
 * what tells the alert layer who to actually message.
 */
export function findWatchersOf(address) {
  const target = address.toLowerCase();
  const results = [];

  if (USE_SQLITE) {
    const rows = db
      .prepare(
        `SELECT o.ownerAddress, o.telegramChatId FROM watched_addresses w
         JOIN connection_owners o ON o.ownerAddress = w.ownerAddress
         WHERE w.watchAddress = ? AND o.telegramChatId IS NOT NULL`
      )
      .all(target);
    return rows.map((r) => ({ ownerAddress: r.ownerAddress, telegramChatId: r.telegramChatId }));
  }

  for (const [ownerAddress, watched] of memWatched.entries()) {
    if (watched.has(target)) {
      const owner = memOwners.get(ownerAddress);
      if (owner?.telegramChatId) results.push({ ownerAddress, telegramChatId: owner.telegramChatId });
    }
  }
  return results;
}

/**
 * Verifies an on-chain payment of >= 1 BOT token to the treasury address
 * before upgrading a connection owner to premium. Requires WBOT_ADDRESS
 * and TREASURY_ADDRESS env vars, and an ethers provider.
 *
 * NOT RUNTIME TESTED — no network access in the environment this was
 * written in to verify against a real transaction or confirm WBOT's actual
 * decimals(). Verify decimals() on the real WBOT contract before trusting
 * PREMIUM_PRICE_BOT's 18-decimals assumption.
 */
export async function verifyAndUpgrade(ownerAddress, paymentTxHash, provider) {
  const { ethers } = await import("ethers");
  // Uses BOT_TOKEN_ADDRESS, not WBOT_ADDRESS — matching webhook.js's existing
  // private-tier payment verification (see canVerifyPayment there). WBOT is
  // the wrapped-BOT contract used for monitoring rules elsewhere in this
  // codebase; BOT_TOKEN_ADDRESS is the actual $BOT payment token. Using the
  // wrong one here would mean premium upgrades verify against the wrong
  // contract entirely.
  const botTokenAddress = process.env.BOT_TOKEN_ADDRESS;
  const treasuryAddress = process.env.TREASURY_ADDRESS;
  if (!botTokenAddress || !treasuryAddress) {
    return { ok: false, reason: "BOT_TOKEN_ADDRESS / TREASURY_ADDRESS not configured on the server" };
  }

  const receipt = await provider.getTransactionReceipt(paymentTxHash);
  if (!receipt || receipt.status !== 1) {
    return { ok: false, reason: "Transaction not found or not confirmed successfully" };
  }

  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

  const matchingLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === botTokenAddress.toLowerCase() &&
      log.topics[0] === transferTopic
  );
  if (!matchingLog) {
    return { ok: false, reason: "No BOT token Transfer event found in this transaction" };
  }

  const parsed = iface.parseLog(matchingLog);
  const { to, value } = parsed.args;
  if (to.toLowerCase() !== treasuryAddress.toLowerCase()) {
    return { ok: false, reason: "Transfer was not sent to the ShieldGuard treasury address" };
  }
  if (value < PREMIUM_PRICE_BOT) {
    return { ok: false, reason: `Transfer amount below required 1 BOT (assuming 18 decimals — verify this)` };
  }

  const key = ownerAddress.toLowerCase();
  ensureOwner(key);
  if (USE_SQLITE) {
    db.prepare("UPDATE connection_owners SET tier = 'premium', premiumPaymentTx = ? WHERE ownerAddress = ?").run(paymentTxHash, key);
  } else {
    memOwners.set(key, { ...memOwners.get(key), tier: "premium", premiumPaymentTx: paymentTxHash });
  }

  return { ok: true, summary: getConnectionSummary(key) };
}
