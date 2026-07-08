// SQLite-backed store for production deployments where restarts happen.
// Full functional parity with store.js — same exported function signatures,
// same return shapes — so swapping this in changes nothing except that
// guardians/alerts/user data now survive a Railway redeploy.
//
// Enable by setting USE_SQLITE=true in Railway variables (see storeAdapter.js).
// Requires: better-sqlite3 (already in package.json dependencies).
//
// Guardians are keyed by lowercase contract ADDRESS (not name) — matching
// store.js. Several watched contracts share a name (two MultiSigWallets, two
// NyxBatchAuctions, two "Money" tokens, two RKTDOGEs), so keying by name
// would silently collide and drop one of each pair.

import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SQLITE_PATH || join(__dirname, "..", "shieldguard.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS guardians (
    id TEXT PRIMARY KEY,              -- lowercase contract address
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    addedBy TEXT NOT NULL DEFAULT 'admin',
    addedByAddress TEXT,
    tier TEXT NOT NULL,
    paymentTx TEXT,
    monitorCalls INTEGER NOT NULL DEFAULT 0,
    criticalFunctions TEXT NOT NULL DEFAULT '[]',
    txCount INTEGER NOT NULL DEFAULT 0,
    txLimit INTEGER,                  -- NULL means unlimited
    scanned INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    isActive INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    wallet TEXT PRIMARY KEY,          -- lowercase
    joinedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_contracts (
    wallet TEXT NOT NULL,
    address TEXT NOT NULL,
    tier TEXT NOT NULL,
    addedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_contracts_wallet ON user_contracts(wallet);

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    tokenAddress TEXT,
    from_addr TEXT,
    to_addr TEXT,
    severity TEXT NOT NULL,
    reason TEXT,
    rules TEXT NOT NULL DEFAULT '[]',
    txHash TEXT,
    signed INTEGER NOT NULL DEFAULT 0,
    hash TEXT,
    verdict TEXT,
    anchored INTEGER NOT NULL DEFAULT 0,
    time TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts(time DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_hash ON alerts(hash);
`);

const MAX_ALERTS = 200;
const FREE_TIER_MAX_CONTRACTS = parseInt(process.env.FREE_TIER_MAX_CONTRACTS || "3", 10);
const PUBLIC_TX_LIMIT = parseInt(process.env.PUBLIC_TX_LIMIT || "20", 10);
const PRIVATE_TX_LIMIT = parseInt(process.env.PRIVATE_TX_LIMIT || "50", 10);

function keyFor(address) {
  return address ? address.toLowerCase() : null;
}

// --- row <-> object mapping ------------------------------------------------

function rowToGuardian(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    addedBy: row.addedBy,
    addedByAddress: row.addedByAddress,
    tier: row.tier,
    paymentTx: row.paymentTx,
    monitorCalls: !!row.monitorCalls,
    criticalFunctions: JSON.parse(row.criticalFunctions || "[]"),
    txCount: row.txCount,
    txLimit: row.txLimit === null ? Infinity : row.txLimit,
    scanned: row.scanned,
    flagged: row.flagged,
    isActive: !!row.isActive,
    createdAt: row.createdAt,
  };
}

function rowToAlert(row) {
  return {
    id: row.id,
    token: row.token,
    tokenAddress: row.tokenAddress,
    from: row.from_addr,
    to: row.to_addr,
    severity: row.severity,
    reason: row.reason,
    rules: JSON.parse(row.rules || "[]"),
    time: row.time,
    signed: !!row.signed,
    hash: row.hash,
    verdict: row.verdict,
    anchored: !!row.anchored,
  };
}

function getGuardianRow(address) {
  return db.prepare("SELECT * FROM guardians WHERE id = ?").get(keyFor(address));
}

// --- writers ---------------------------------------------------------------

function trackUserContract(wallet, contractAddress, tier) {
  const key = keyFor(wallet);
  if (!key) return;

  db.prepare(`INSERT OR IGNORE INTO users (wallet, joinedAt) VALUES (?, ?)`).run(key, new Date().toISOString());
  db.prepare(`INSERT INTO user_contracts (wallet, address, tier, addedAt) VALUES (?, ?, ?, ?)`).run(
    key,
    keyFor(contractAddress),
    tier,
    new Date().toISOString()
  );
}

// options.addedBy: 'admin' | 'user' | 'agent' (defaults to 'admin' so the two
// statically-watched targets in listener.js — WBOT/USDT — keep working
// unchanged and stay unlimited).
export function registerGuardian(name, address, options = {}) {
  const key = keyFor(address);
  if (!key) return null;

  const existing = getGuardianRow(key);
  if (existing) return rowToGuardian(existing);

  const { addedBy = "admin", addedByAddress = null, paymentTx = null, monitorCalls = false, criticalFunctions = [] } = options;
  const tier = options.tier || (addedBy === "admin" ? "admin" : "public");
  const txLimit = addedBy === "admin" ? null : tier === "private" ? PRIVATE_TX_LIMIT : PUBLIC_TX_LIMIT;

  db.prepare(
    `INSERT INTO guardians (id, name, address, addedBy, addedByAddress, tier, paymentTx, monitorCalls, criticalFunctions, txCount, txLimit, scanned, flagged, isActive, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 1, ?)`
  ).run(
    key,
    name,
    address,
    addedBy,
    addedByAddress ? keyFor(addedByAddress) : null,
    tier,
    paymentTx,
    monitorCalls ? 1 : 0,
    JSON.stringify(criticalFunctions),
    txLimit,
    new Date().toISOString()
  );

  if (addedByAddress) trackUserContract(addedByAddress, address, tier);
  return rowToGuardian(getGuardianRow(key));
}

export function removeGuardian(address) {
  const info = db.prepare("DELETE FROM guardians WHERE id = ?").run(keyFor(address));
  return info.changes > 0;
}

// Free-tier abuse guard: without this, one wallet could add unlimited public
// contracts at 20 free tx each. Private (paid) contracts don't count against it.
export function canUserAddMoreContracts(wallet) {
  const key = keyFor(wallet);
  const user = db.prepare("SELECT 1 FROM users WHERE wallet = ?").get(key);
  if (!user) return { allowed: true };

  const { c: publicCount } = db
    .prepare("SELECT COUNT(*) as c FROM user_contracts WHERE wallet = ? AND tier = 'public'")
    .get(key);

  if (publicCount >= FREE_TIER_MAX_CONTRACTS) {
    return {
      allowed: false,
      reason: `Free tier limit reached (${publicCount}/${FREE_TIER_MAX_CONTRACTS} public contracts). Add a private (paid) contract instead.`,
    };
  }
  return { allowed: true };
}

export function recordEvent({ token, tokenAddress, from, to, severity, reason, rules, txHash, signed, hash, verdict, anchored }) {
  const key = keyFor(tokenAddress);
  const g = key ? getGuardianRow(key) : null;

  if (g && g.isActive) {
    db.prepare("UPDATE guardians SET scanned = scanned + 1 WHERE id = ?").run(key);

    // Only count transactions that were actually signed by ShieldGuard AND
    // anchored on-chain — this is the one true measure of "used" quota.
    if (signed && anchored) {
      const newCount = g.txCount + 1;
      db.prepare("UPDATE guardians SET txCount = ? WHERE id = ?").run(newCount, key);

      if (g.addedBy !== "admin" && g.txLimit !== null && newCount >= g.txLimit) {
        db.prepare("UPDATE guardians SET isActive = 0 WHERE id = ?").run(key);
        console.log(`⚠️ [store] ${g.name} (${g.address}) hit its tx limit (${newCount}/${g.txLimit}). Auto-deactivated.`);
      }
    }

    if (severity !== "LOW") {
      db.prepare("UPDATE guardians SET flagged = flagged + 1 WHERE id = ?").run(key);
    }
  }

  const id = `${txHash || "notx"}-${Date.now()}`;
  const time = new Date().toISOString();

  db.prepare(
    `INSERT INTO alerts (id, token, tokenAddress, from_addr, to_addr, severity, reason, rules, txHash, signed, hash, verdict, anchored, time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    token,
    tokenAddress || null,
    from || null,
    to || null,
    severity,
    reason || null,
    JSON.stringify(rules || []),
    txHash || null,
    signed ? 1 : 0,
    hash || null,
    verdict || null,
    anchored ? 1 : 0,
    time
  );

  const { c: count } = db.prepare("SELECT COUNT(*) as c FROM alerts").get();
  if (count > MAX_ALERTS) {
    db.prepare("DELETE FROM alerts WHERE id IN (SELECT id FROM alerts ORDER BY time ASC LIMIT ?)").run(count - MAX_ALERTS);
  }

  return { id, token, tokenAddress, from, to, severity, reason, rules: rules || [], txHash, signed: !!signed, hash: hash || null, verdict: verdict || null, anchored: !!anchored, time };
}

// --- readers -----------------------------------------------------------

export function canMonitorContract(address) {
  const g = rowToGuardian(getGuardianRow(address));
  if (!g) return { canMonitor: true, reason: "Not monitored yet" };
  if (!g.isActive) {
    return {
      canMonitor: false,
      reason: `Transaction limit reached (${g.txCount}/${g.txLimit})`,
      upgradeAvailable: g.addedBy !== "admin" && g.tier === "public",
    };
  }
  return { canMonitor: true, reason: "Active" };
}

export function getGuardianStats(address) {
  const g = rowToGuardian(getGuardianRow(address));
  if (!g) return null;
  return {
    ...g,
    txLimit: g.txLimit === Infinity ? "unlimited" : g.txLimit,
    remaining: g.txLimit === Infinity ? "unlimited" : Math.max(0, g.txLimit - g.txCount),
  };
}

export function getAlerts() {
  return db.prepare("SELECT * FROM alerts ORDER BY time DESC LIMIT ?").all(MAX_ALERTS).map(rowToAlert);
}

export function getGuardians() {
  return db
    .prepare("SELECT * FROM guardians")
    .all()
    .map(rowToGuardian)
    .map((g) => ({ ...g, txLimit: g.txLimit === Infinity ? -1 : g.txLimit })); // -1 == unlimited over the wire
}

export function getUserContracts(wallet) {
  const key = keyFor(wallet);
  const rows = db.prepare("SELECT address FROM user_contracts WHERE wallet = ?").all(key);
  return rows.map((r) => rowToGuardian(getGuardianRow(r.address))).filter(Boolean);
}

export function getUserAlerts(wallet) {
  const addrs = new Set(getUserContracts(wallet).map((c) => keyFor(c.address)));
  return getAlerts().filter((a) => addrs.has(keyFor(a.tokenAddress)));
}

export function getUserStats(wallet) {
  const contracts = getUserContracts(wallet);
  const totalTxUsed = contracts.reduce((sum, c) => sum + c.txCount, 0);
  const totalTxLimit = contracts.reduce((sum, c) => sum + (c.txLimit === Infinity ? 0 : c.txLimit), 0);
  return {
    wallet,
    tier: contracts.some((c) => c.tier === "private") ? "private" : "public",
    contractsCount: contracts.length,
    totalTxUsed,
    totalTxLimit,
    remainingTx: Math.max(0, totalTxLimit - totalTxUsed),
  };
}

export function getGlobalStats() {
  const guardians = getGuardians();
  return {
    totalContracts: guardians.length,
    totalScanned: guardians.reduce((s, g) => s + g.scanned, 0),
    totalFlagged: guardians.reduce((s, g) => s + g.flagged, 0),
    activeContracts: guardians.filter((g) => g.isActive).length,
  };
}
