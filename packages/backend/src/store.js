// In-memory store shared between listener.js (writer) and server.js (reader),
// persisted to disk so history survives redeploys/restarts (requires a
// Railway Volume mounted at /data — see project notes).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const DATA_PATH = process.env.STATE_PATH || "/data/shieldguard-state.json";
const MAX_ALERTS = 200;

const state = {
  alerts: [],
  guardians: [],
};

function loadState() {
  try {
    if (existsSync(DATA_PATH)) {
      const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
      state.alerts = raw.alerts || [];
      state.guardians = raw.guardians || [];
      console.log(`[store] Loaded ${state.alerts.length} past alerts from disk.`);
    } else {
      console.log("[store] No persisted state found yet — starting fresh.");
    }
  } catch (err) {
    console.error("[store] Could not load persisted state:", err.message);
  }
}

function saveState() {
  try {
    mkdirSync(dirname(DATA_PATH), { recursive: true });
    writeFileSync(DATA_PATH, JSON.stringify(state));
  } catch (err) {
    console.error("[store] Could not persist state (is the Volume mounted at /data?):", err.message);
  }
}

loadState();

export function registerGuardian(name, address) {
  if (!state.guardians.find((g) => g.name === name)) {
    state.guardians.push({
      id: name.toLowerCase(),
      name,
      address,
      scanned: 0,
      flagged: 0,
    });
    saveState();
  }
}

export function recordEvent({
  token,
  tokenAddress,
  from,
  to,
  severity,
  reason,
  rules,
  txHash,
  signed,
  hash,
  verdict,
  anchored,
}) {
  const g = state.guardians.find((g) => g.name === token);
  if (g) {
    g.scanned += 1;
    if (severity !== "LOW") g.flagged += 1;
  }

  const entry = {
    id: `${txHash || "notx"}-${Date.now()}`,
    token,
    tokenAddress,
    from,
    to,
    severity,
    reason,
    rules: rules || [],
    time: new Date().toISOString(),
    signed: !!signed,
    hash: hash || null,
    verdict: verdict || null,
    anchored: !!anchored,
  };

  state.alerts.unshift(entry);
  if (state.alerts.length > MAX_ALERTS) state.alerts.length = MAX_ALERTS;
  saveState();
  return entry;
}

export function getAlerts() {
  return state.alerts;
}

export function getGuardians() {
  return state.guardians;
}
