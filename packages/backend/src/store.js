// In-memory store shared between listener.js (writer) and server.js (reader).
// Good enough for hackathon / single-process deployment.

const MAX_ALERTS = 200;

const state = {
  alerts: [],
  guardians: new Map(), // key: token name -> { name, address, scanned, flagged }
};

export function registerGuardian(name, address) {
  if (!state.guardians.has(name)) {
    state.guardians.set(name, {
      id: name.toLowerCase(),
      name,
      address,
      scanned: 0,
      flagged: 0,
    });
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
  const g = state.guardians.get(token);
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
  return entry;
}

export function getAlerts() {
  return state.alerts;
}

export function getGuardians() {
  return Array.from(state.guardians.values());
}
