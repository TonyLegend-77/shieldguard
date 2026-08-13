// Single import point for listener.js/server.js/webhook.js. Picks the
// in-memory store (default — no setup required, resets on every restart)
// or the SQLite-backed store (set USE_SQLITE=true in Railway variables —
// survives restarts, requires SQLITE_PATH to point at a persistent volume
// if you want it to survive a full redeploy, not just a process restart).
const impl = process.env.USE_SQLITE === "true" ? await import("./store.sqlite.js") : await import("./store.js");

export const {
  registerGuardian,
  removeGuardian,
  canUserAddMoreContracts,
  recordEvent,
  canMonitorContract,
  getGuardianStats,
  getAlerts,
  getGuardians,
  getUserContracts,
  getUserAlerts,
  getUserStats,
  getGlobalStats,
} = impl;
