import { createApp } from "./app.js";
import { billingReconciliationRuntime, createProductionAppRouters, mediaRecoveryService, proactiveDueWorkerService, proactiveSemanticRecoveryService, voiceDeferredSemanticRecoveryService, voiceWorkerRecoveryService, whatsAppInboundMediaRecoveryService, whatsAppOutboundDeliveryService, whatsAppWebhookService } from "./composition.js";
import { initializeSqlDatabase, runtimeProductionConfiguration, sqlDatabase } from "./config/database.js";
import { mediaStorageAvailable } from "./config/productionConfiguration.js";
import { setShuttingDown } from "./routes/health.js";
import { markRuntimeReady, markRuntimeShuttingDown, registerRuntimeWorker } from "./config/runtimeReadiness.js";
import { randomUUID } from "node:crypto";
import { normalizeOperationalError, operationalLogger } from "./observability/operationalLogger.js";
import { WhatsAppRecoveryRuntime } from "./whatsapp/services/WhatsAppRecoveryRuntime.js";
import { runWhatsAppRecoveryCycle } from "./whatsapp/services/whatsAppRecoveryCycle.js";
import { migrationHead } from "./config/migrations.js";

const portValue = Number(process.env.PORT ?? "3000");
if (!Number.isSafeInteger(portValue) || portValue < 1 || portValue > 65_535) throw new Error("PORT must be a valid TCP port.");
const mediaRecoveryAvailable = mediaStorageAvailable(runtimeProductionConfiguration);

async function start(): Promise<void> {
await initializeSqlDatabase();
const server = createApp(createProductionAppRouters(), { production: process.env.NODE_ENV === "production" }).listen(portValue, "0.0.0.0", () => {
  operationalLogger.info("process_started", { subsystem: "http", outcome: "started", migrationHead: migrationHead.name, deploymentVersion: process.env.ATLAS_DEPLOYMENT_VERSION ?? "unknown" });
  registerRuntimeWorker("billing_reconciliation", { configured: true, required: true });
  billingReconciliationRuntime.start();
  const whatsAppRecoveryRequired = runtimeProductionConfiguration?.whatsAppWebhookEnabled ?? false;
  registerRuntimeWorker("whatsapp_recovery", { configured: whatsAppRecoveryRequired, required: whatsAppRecoveryRequired });
  markRuntimeReady();
});
const dispatchOwner = `whatsapp-dispatch-${randomUUID()}`;
const mediaRecoveryOwner = `whatsapp-media-recovery-${randomUUID()}`;
const atlasMediaRecoveryOwner = `atlas-media-recovery-${randomUUID()}`;
const proactiveWorkerOwner = `proactive-runtime-${randomUUID()}`;
const voiceRecovery = voiceWorkerRecoveryService;
const voiceRecoveryStages = voiceRecovery === null ? {} : { transcribeVoice: () => voiceRecovery.transcribeAvailable(), synthesizeVoice: () => voiceRecovery.synthesizeAvailable(), uploadVoice: () => voiceRecovery.uploadAvailable() };
  const whatsAppRecoveryRuntime = new WhatsAppRecoveryRuntime((onStage, onSubstage) => runWhatsAppRecoveryCycle(mediaRecoveryAvailable, { executeProactive: () => proactiveDueWorkerService.executeAvailable(proactiveWorkerOwner), recoverInboundMedia: stage => whatsAppInboundMediaRecoveryService.recoverAvailable(mediaRecoveryOwner, 25, stage), recoverAtlasMedia: () => mediaRecoveryService.recoverAvailable(atlasMediaRecoveryOwner), ...voiceRecoveryStages, resumeIncomplete: substage => whatsAppWebhookService.resumeIncomplete(25, substage), dispatchOutbound: () => whatsAppOutboundDeliveryService.dispatchReady(dispatchOwner), recoverVoiceSemantics: () => voiceDeferredSemanticRecoveryService.recoverAvailable(), recoverProactiveSemantics: () => proactiveSemanticRecoveryService.recoverAvailable() }, onStage, onSubstage));
  whatsAppRecoveryRuntime.start();

let isShuttingDown = false;

function gracefulShutdown(reason: string, exitCode: number): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  operationalLogger.info("process_shutdown_started", { subsystem: "process", outcome: reason });

  setShuttingDown(true);
   markRuntimeShuttingDown();
   void whatsAppRecoveryRuntime.stop();

  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }

  // Parse and validate SHUTDOWN_TIMEOUT_MS
  const timeoutEnv = process.env.SHUTDOWN_TIMEOUT_MS;
  let timeoutMs = 10000;
  if (timeoutEnv !== undefined) {
    const parsed = Number(timeoutEnv);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      timeoutMs = parsed;
    }
  }

  const forceTimeout = setTimeout(async () => {
    operationalLogger.error("process_shutdown_timeout", { subsystem: "process", safeErrorCategory: "internal_failure" });
    try {
      await sqlDatabase.close();
      operationalLogger.info("database_closed", { subsystem: "database", outcome: "forced" });
    } catch (error: unknown) {
      operationalLogger.error("database_close_failed", { subsystem: "database", safeErrorCategory: normalizeOperationalError(error) });
    }
    process.exit(exitCode);
  }, timeoutMs);
  forceTimeout.unref();

  server.close(async (err) => {
    if (err) {
      operationalLogger.error("http_server_close_failed", { subsystem: "http", safeErrorCategory: normalizeOperationalError(err) });
    } else {
      operationalLogger.info("http_server_closed", { subsystem: "http", outcome: "completed" });
    }

     await billingReconciliationRuntime.stop();
     await whatsAppRecoveryRuntime.stop();
    clearTimeout(forceTimeout);

    try {
      await sqlDatabase.close();
      operationalLogger.info("database_closed", { subsystem: "database", outcome: "completed" });
    } catch (dbErr: unknown) {
      operationalLogger.error("database_close_failed", { subsystem: "database", safeErrorCategory: normalizeOperationalError(dbErr) });
    }

    process.exit(exitCode);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM", 0));
process.on("SIGINT", () => gracefulShutdown("SIGINT", 0));

process.on("uncaughtException", (error) => {
  operationalLogger.error("process_uncaught_exception", { subsystem: "process", safeErrorCategory: normalizeOperationalError(error) });
  gracefulShutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  operationalLogger.error("process_unhandled_rejection", { subsystem: "process", safeErrorCategory: normalizeOperationalError(reason) });
  gracefulShutdown("unhandledRejection", 1);
});
}

void start().catch(async (error: unknown) => {
  operationalLogger.error("process_start_failed", { subsystem: "process", safeErrorCategory: normalizeOperationalError(error) });
  try { await sqlDatabase.close(); }
  catch (closeError: unknown) { operationalLogger.error("database_close_failed", { subsystem: "database", safeErrorCategory: normalizeOperationalError(closeError) }); }
  process.exitCode = 1;
});
