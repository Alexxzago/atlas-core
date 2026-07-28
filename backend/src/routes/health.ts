import { Router } from "express";
import { database } from "../config/database.js";

const router = Router();
let shuttingDown = false;

export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
}

router.get("/health", (_req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.json({
    status: "online",
    service: "Atlas Core",
    version: "0.0.1",
  });
});

router.get("/ready", (_req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  try {
    database.prepare("SELECT 1 AS ready").get();
    res.json({ status: "ready", database: "available" });
  } catch {
    res.status(503).json({ status: "not_ready", database: "unavailable" });
  }
});

export default router;
