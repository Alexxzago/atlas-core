import { Router } from "express";
import { database } from "../config/database.js";
import { markRuntimeBooting, markRuntimeShuttingDown, runtimeMissingRequiredWorkers, runtimeReadinessStatus } from "../config/runtimeReadiness.js";
import { operationalLogger } from "../observability/operationalLogger.js";

const router = Router();

export function setShuttingDown(value: boolean): void {
  if (value) markRuntimeShuttingDown(); else markRuntimeBooting();
}

router.get("/health", (_req, res) => {
  if (runtimeReadinessStatus() === "shutting_down") {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.json({ status: "online" });
});

router.get("/ready", (_req, res) => {
  const status = runtimeReadinessStatus();
  if (status !== "ready") {
    operationalLogger.warn("readiness_check_failed", { subsystem: "readiness", safeErrorCategory: "internal_failure", outcome: status });
    res.status(503).json({ status });
    return;
  }
  if (runtimeMissingRequiredWorkers().length > 0) {
    operationalLogger.warn("readiness_check_failed", { subsystem: "readiness", safeErrorCategory: "internal_failure", outcome: "workers_unavailable" });
    res.status(503).json({ status: "not_ready" });
    return;
  }
  try { database.prepare("SELECT 1 AS ready").get(); }
  catch {
    operationalLogger.warn("readiness_check_failed", { subsystem: "readiness", safeErrorCategory: "database_failure", outcome: "database_unavailable" });
    res.status(503).json({ status: "not_ready", database: "unavailable" });
    return;
  }
  res.json({ status: "ready", database: "available" });
});

export default router;
