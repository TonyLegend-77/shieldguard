// SQLite-backed store for production deployments where restarts happen.
// Swap this in by setting USE_SQLITE=true in your .env
// Requires: npm install better-sqlite3

import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SQLITE_PATH || join(__dirname, "..", "shieldguard.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    tokenAddress TEXT,
    from_addr TEXT,
    to_addr TEXT,
    severity TEXT NOT NULL,
    reason TEXT,
    rules TEXT,
    txHash TEXT,
    signed INTEGER DEFAULT 0,
    hash TEXT,
    verdict TEXT,
    anchored INTEGER DEFAULT 0,
    time TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guardians (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    scanned INTEGER DEFAULT 0,
    flagged INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts(time DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_hash ON alerts(hash);
`);

const MAX_ALERTS = 200;

export function registerGuardian(name, address) {
  db.prepare(`INSERT OR IGNORE INTO guardians (id, name, address, scanned, flagged)
    VALUES (?, ?, ?, 0, 0)`).run(name.toLowerCase(), name, address);
}

export function recordEvent({ token, tokenAddress, from, to, severity, reason, rules, txHash, signed, hash, verdict, anchored }) {
  const g = db.prepare("SELECT * FROM guardians WHERE id = ?").get(token.toLowerCase());
  if (g) {
    db.prepare("UPDATE guardians SET scanned = scanned + 1 WHERE id = ?").run(token.toLowerCase());
    if (severity !== "LOW") {
      db.prepare("UPDATE guardians SET flagged = flagged + 1 WHERE id = ?").run(token.toLowerCase());
    }
  }
  const id = `${txHash || "notx"}-${Date.now()}`;
  db.prepare(`INSERT INTO alerts (id, token, tokenAddress, from_addr, to_addr, severity, reason, rules, txHash, signed, hash, verdict, anchored, time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, token, tokenAddress || null, from || null, to || null, severity, reason || null,
    JSON.stringify(rules || []), txHash || null, signed ? 1 : 0, hash || null, verdict || null, anchored ? 1 : 0, new Date().toISOString()
  );
  const count = db.prepare("SELECT COUNT(*) as c FROM alerts").get().c;
  if (count > MAX_ALERTS) {
    db.prepare("DELETE FROM alerts WHERE id IN (SELECT id FROM alerts ORDER BY time ASC LIMIT ?)").run(count - MAX_ALERTS);
  }
  return { id, token, tokenAddress, from, to, severity, reason, rules: rules || [], txHash, signed: !!signed, hash: hash || null, verdict: verdict || null, anchored: !!anchored, time: new Date().toISOString() };
}

export function getAlerts() {
  return db.prepare("SELECT * FROM alerts ORDER BY time DESC LIMIT ?").all(MAX_ALERTS).map(r => ({
    ...r, rules: JSON.parse(r.rules || "[]"), signed: !!r.signed, anchored: !!r.anchored,
  }));
}

export function getGuardians() {
  return db.prepare("SELECT * FROM guardians").all();
}
