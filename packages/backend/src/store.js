// In-memory store shared between listener.js (writer) and server.js (reader).
// History for flagged/anchored events survives restarts via chain rehydration
// in listener.js — this store itself is just the live in-process cache.
//
// Guardians are keyed by lowercase contract address (not name) so that
// dynamically-added contracts (via /monitor) and statically-watched ones
// (WBOT/USDT from listener.js) share one identity space.

const MAX_ALERTS = 200;

const FREE_TIER_MAX_CONTRACTS = parseInt(process.env.FREE_TIER_MAX_CONTRACTS || "3", 10);
const PUBLIC_TX_LIMIT = parseInt(process.env.PUBLIC_TX_LIMIT || "20", 10);
const PRIVATE_TX_LIMIT = parseInt(process.env.PRIVATE_TX_LIMIT || "50", 10);

const state = {
  alerts: [],
  guardians: new Map(), // key: lowercase contract address
  users: new Map(), // key: lowercase wallet address
};

function keyFor(address) {
  return address ? address.toLowerCase() : null;
}

function trackUserContract(wallet, contractAddress, tier) {
  const key = keyFor(wallet);
  if (!key) return;
  if (!state.users.has(key)) {
    state.users.set(key, { wallet, contractsAdded: [], joinedAt: new Date().toISOString() });
  }
  state.users.get(key).contractsAdded.push({
    address: keyFor(contractAddress),
    tier,
    addedAt: new Date().toISOString(),
  });
}

// options.addedBy: 'admin' | 'user' | 'agent' (defaults to 'admin' so the two
// statically-watched targets in listener.js — WBOT/USDT — keep working
// unchanged and stay unlimited).
export function registerGuardian(name, address, options = {}) {
  const key = keyFor(address);
  if (!key) return null;
  if (state.guardians.has(key)) return state.guardians.get(key);

  const { addedBy = "admin", addedByAddress = null, paymentTx = null, monitorCalls = false, criticalFunctions = [] } = options;
  const tier = options.tier || (addedBy === "admin" ? "admin" : "public");
  const txLimit = addedBy === "admin" ? Infinity : tier === "private" ? PRIVATE_TX_LIMIT : PUBLIC_TX_LIMIT;

  const guardian = {
    id: key,
    name,
    address,
    addedBy,
    addedByAddress: addedByAddress ? keyFor(addedByAddress) : null,
    tier,
    paymentTx,
    monitorCalls,
    criticalFunctions,
    txCount: 0, // count of actually signed + anchored transactions
    txLimit,
    scanned: 0,
    flagged: 0,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  state.guardians.set(key, guardian);
  if (addedByAddress) trackUserContract(addedByAddress, address, tier);
  return guardian;
}

export function removeGuardian(address) {
  return state.guardians.delete(keyFor(address));
}

// Free-tier abuse guard: without this, one wallet could add unlimited public
// contracts at 20 free tx each. Private (paid) contracts don't count against it.
export function canUserAddMoreContracts(wallet) {
  const user = state.users.get(keyFor(wallet));
  if (!user) return { allowed: true };
  const publicCount = user.contractsAdded.filter((c) => c.tier === "public").length;
  if (publicCount >= FREE_TIER_MAX_CONTRACTS) {
    return {
      allowed: false,
      reason: `Free tier limit reached (${publicCount}/${FREE_TIER_MAX_CONTRACTS} public contracts). Add a private (paid) contract instead.`,
    };
  }
  return { allowed: true };
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
  const g = state.guardians.get(keyFor(tokenAddress));

  if (g && g.isActive) {
    g.scanned += 1;

    // Only count transactions that were actually signed by ShieldGuard AND
    // anchored on-chain — this is the one true measure of "used" quota.
    if (signed && anchored) {
      g.txCount += 1;
      if (g.addedBy !== "admin" && g.txCount >= g.txLimit) {
        g.isActive = false;
        console.log(
          `⚠️ [store] ${g.name} (${g.address}) hit its tx limit (${g.txCount}/${g.txLimit}). Auto-deactivated.`
        );
      }
    }

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
  return entry;
}

export function canMonitorContract(address) {
  const g = state.guardians.get(keyFor(address));
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
  const g = state.guardians.get(keyFor(address));
  if (!g) return null;
  return {
    ...g,
    txLimit: g.txLimit === Infinity ? "unlimited" : g.txLimit,
    remaining: g.txLimit === Infinity ? "unlimited" : Math.max(0, g.txLimit - g.txCount),
  };
}

export function getAlerts() {
  return state.alerts;
}

export function getGuardians() {
  return Array.from(state.guardians.values()).map((g) => ({
    ...g,
    txLimit: g.txLimit === Infinity ? -1 : g.txLimit, // -1 == unlimited over the wire
  }));
}

export function getUserContracts(wallet) {
  const user = state.users.get(keyFor(wallet));
  if (!user) return [];
  return user.contractsAdded
    .map((c) => state.guardians.get(c.address))
    .filter(Boolean);
}

export function getUserAlerts(wallet) {
  const addrs = new Set(getUserContracts(wallet).map((c) => keyFor(c.address)));
  return state.alerts.filter((a) => addrs.has(keyFor(a.tokenAddress)));
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
