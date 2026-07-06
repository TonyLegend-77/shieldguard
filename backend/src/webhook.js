import express from "express";
import { registerGuardian } from "./store.js";

const MONITORED = new Map();

export function setupWebhook(app) {
  app.use(express.json());

  app.post("/monitor", (req, res) => {
    const { address, name, abi, webhook } = req.body;
    if (!address || !name) return res.status(400).json({ error: "address and name required" });
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: "Invalid address" });
    MONITORED.set(address.toLowerCase(), { name, abi: abi || null, webhook: webhook || null, addedAt: new Date().toISOString() });
    registerGuardian(name, address);
    res.json({ success: true, address, name, monitoredCount: MONITORED.size });
  });

  app.get("/monitor", (req, res) => {
    res.json({ monitored: Array.from(MONITORED.entries()).map(([addr, data]) => ({ address: addr, ...data })) });
  });

  app.delete("/monitor/:address", (req, res) => {
    res.json({ success: MONITORED.delete(req.params.address.toLowerCase()) });
  });
}

export function getMonitoredAddresses() {
  return Array.from(MONITORED.keys());
}
