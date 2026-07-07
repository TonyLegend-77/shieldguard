import express from "express";
import { verifyOnChain } from "./chainVerify.js";
import cors from "cors";
import { getAlerts, getGuardians } from "./store.js";

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

  app.get("/verify/:hash", (req, res) => {
    const alert = getAlerts().find((a) => a.hash === req.params.hash);
    if (!alert) return res.status(404).json({ error: "Not found" });
    res.json(alert);
  });

  app.get("/signature/address", (req, res) => {
    res.json({ address: process.env.SIGNER_ADDRESS || null });
  });

  app.listen(port, () => {
    console.log(`ShieldGuard API on http://localhost:${port}`);
    console.log(`  GET /alerts    — all events`);
    console.log(`  GET /guardians — watched tokens`);
    console.log(`  GET /health    — status + config`);
    console.log(`  GET /verify/:hash — lookup by receipt hash`);
  });

  return app;
}
