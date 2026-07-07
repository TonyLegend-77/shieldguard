import express from "express";
import { verifyOnChain } from "./chainVerify.js";
import cors from "cors";
import {
  getAlerts,
  getGuardians,
  getGlobalStats,
  getUserContracts,
  getUserAlerts,
  getUserStats,
} from "./store.js";

export function startServer(port = process.env.PORT || 4000) {
  const app = express();
  app.use(cors());

  app.get("/alerts", (req, res) => res.json(getAlerts()));
  app.get("/guardians", (req, res) => res.json(getGuardians()));

  app.get("/health", (req, res) =>
    res.json({
      status: "ok",
      alerts: getAlerts().length,
      guardians: getGuardians().length,
      signerAddress: process.env.SIGNER_ADDRESS || null,
      receiptRegistry: process.env.RECEIPT_REGISTRY_ADDRESS || null,
    })
  );

  app.get("/verify/:hash", async (req, res) => {
    const alert = getAlerts().find((a) => a.hash === req.params.hash);
    const chain = await verifyOnChain(req.params.hash);

    if (!alert && !chain.anchored) {
      return res.status(404).json({ error: "Not found in local history or on-chain." });
    }

    res.json({ alert: alert || null, chain });
  });

  app.get("/signature/address", (req, res) => {
    res.json({ address: process.env.SIGNER_ADDRESS || null });
  });

  // Public dashboard — no wallet required.
  app.get("/api/stats/global", (req, res) => res.json(getGlobalStats()));
  app.get("/api/alerts/global", (req, res) => res.json(getAlerts()));

  // Personal dashboard — scoped to whichever wallet added the contracts.
  // Note: this is read-only visibility, not auth — anyone can query any
  // address's public stats, same as looking up a wallet on a block explorer.
  app.get("/api/user/contracts", (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address query param required" });
    res.json(getUserContracts(address));
  });

  app.get("/api/user/alerts", (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address query param required" });
    res.json(getUserAlerts(address));
  });

  app.get("/api/user/stats", (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address query param required" });
    res.json(getUserStats(address));
  });

  app.listen(port, () => {
    console.log(`ShieldGuard API on http://localhost:${port}`);
    console.log(`  GET /alerts    — all events`);
    console.log(`  GET /guardians — watched tokens`);
    console.log(`  GET /health    — status + config`);
    console.log(`  GET /verify/:hash — lookup by receipt hash`);
    console.log(`  GET /api/stats/global — public dashboard stats`);
    console.log(`  GET /api/user/* — personal dashboard (?address=0x...)`);
    console.log(`  POST /monitor, /monitor/private, /monitor/admin — add contracts (wired by listener.js)`);
  });

  return app;
}
