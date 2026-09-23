import { Router } from "express";
import { sqlDatabase } from "../config/database.js";
import type { SqlDatabase } from "../config/sqlDatabase.js";
import { markRuntimeBooting, markRuntimeShuttingDown, runtimeMissingRequiredWorkers, runtimeReadinessStatus, runtimeWorkerHealth, type RuntimeWorkerHealth } from "../config/runtimeReadiness.js";
import { operationalLogger } from "../observability/operationalLogger.js";

export function setShuttingDown(value: boolean): void {
  if (value) markRuntimeShuttingDown(); else markRuntimeBooting();
}

const readinessWorkerLogIntervalMilliseconds = 60_000;
let lastWorkerFailureSignature: string | null = null, lastWorkerFailureLoggedAt = 0;

function logUnavailableWorkers(names: readonly string[]): void {
  const health = runtimeWorkerHealth(names[0]!)!, workerHealth = safeWorkerHealth(health), unavailableWorkerHealth = JSON.stringify(names.map(name => ({ worker: name, ...safeWorkerHealth(runtimeWorkerHealth(name)!) }))), signature = JSON.stringify({ names, unavailableWorkerHealth }), at = Date.now();
  if (signature === lastWorkerFailureSignature && at - lastWorkerFailureLoggedAt < readinessWorkerLogIntervalMilliseconds) return;
  lastWorkerFailureSignature = signature; lastWorkerFailureLoggedAt = at;
  operationalLogger.warn("readiness_check_failed", { subsystem: "readiness", safeErrorCategory: "internal_failure", outcome: "workers_unavailable", unavailableWorkers: names.join(":"), unavailableWorkerHealth, worker: names[0]!, ...workerHealth });
}

function safeWorkerHealth(health: RuntimeWorkerHealth): Record<"started" | "running" | "currentStage" | "currentSubstage" | "lastSuccessfulCycleAt" | "lastFailedCycleAt" | "lastErrorCategory" | "lastFailedStage" | "lastFailedSubstage" | "consecutiveFailures" | "lastActivityAt" | "backlogUnsafe" | "staleLease", string> { return { started: String(health.started), running: String(health.running), currentStage: health.currentStage ?? "none", currentSubstage: health.currentSubstage ?? "none", lastSuccessfulCycleAt: String(health.lastSuccessfulCycleAt ?? "none"), lastFailedCycleAt: String(health.lastFailedCycleAt ?? "none",), lastErrorCategory: health.lastErrorCategory ?? "none", lastFailedStage: health.lastFailedStage ?? "none", lastFailedSubstage: health.lastFailedSubstage ?? "none", consecutiveFailures: String(health.consecutiveFailures), lastActivityAt: String(health.lastActivityAt ?? "none"), backlogUnsafe: String(health.backlogUnsafe), staleLease: String(health.staleLease) }; }

export function resetReadinessDiagnosticsForTests(): void { lastWorkerFailureSignature = null; lastWorkerFailureLoggedAt = 0; }

export function createHealthRouter(runtimeDatabase: SqlDatabase): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    if (runtimeReadinessStatus() === "shutting_down") {
      res.status(503).json({ status: "shutting_down" });
      return;
    }
    res.json({ status: "online" });
  });

  router.get("/ready", async (_req, res) => {
    const status = runtimeReadinessStatus();
    if (status !== "ready") {
      operationalLogger.warn("readiness_check_failed", { subsystem: "readiness", safeErrorCategory: "internal_failure", outcome: status });
      res.status(503).json({ status });
      return;
    }
    const unavailableWorkers = runtimeMissingRequiredWorkers();
    if (unavailableWorkers.length > 0) {
      logUnavailableWorkers(unavailableWorkers);
      res.status(503).json({ status: "not_ready" });
      return;
    }
    try { await runtimeDatabase.query("SELECT 1 AS ready"); }
    catch {
      operationalLogger.warn("readiness_check_failed", { subsystem: "readiness", safeErrorCategory: "database_failure", outcome: "database_unavailable" });
      res.status(503).json({ status: "not_ready", database: "unavailable" });
      return;
    }
    res.json({ status: "ready", database: "available" });
  });
  return router;
}

const router = createHealthRouter(sqlDatabase);

export default router;
