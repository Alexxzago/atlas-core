import { createApp } from "./app.js";
import { createProductionAppRouters, whatsAppInboundMediaRecoveryService, whatsAppOutboundDeliveryService, whatsAppWebhookService } from "./composition.js";
import { database } from "./config/database.js";
import { setShuttingDown } from "./routes/health.js";
import { randomUUID } from "node:crypto";

const portValue = Number(process.env.PORT ?? "3000");
if (!Number.isSafeInteger(portValue) || portValue < 1 || portValue > 65_535) throw new Error("PORT must be a valid TCP port.");

const server = createApp(createProductionAppRouters(), { production: process.env.NODE_ENV === "production" }).listen(portValue, "0.0.0.0", () => {
  console.log(`Atlas listening on port ${portValue}`);
});
const dispatchOwner = `whatsapp-dispatch-${randomUUID()}`;
const mediaRecoveryOwner = `whatsapp-media-recovery-${randomUUID()}`;
async function recoverWhatsApp(): Promise<void> { try { await whatsAppInboundMediaRecoveryService.recoverAvailable(mediaRecoveryOwner); await whatsAppWebhookService.resumeIncomplete(); await whatsAppOutboundDeliveryService.dispatchReady(dispatchOwner); } catch { console.error("WhatsApp recovery cycle failed."); } }
void recoverWhatsApp();
const recoveryTimer = setInterval(() => { void recoverWhatsApp(); }, 5_000);
recoveryTimer.unref();

let isShuttingDown = false;

function gracefulShutdown(reason: string, exitCode: number): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Initiating graceful shutdown. Reason: ${reason}`);

  setShuttingDown(true);
  clearInterval(recoveryTimer);

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

  const forceTimeout = setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing termination.");
    try {
      database.close();
      console.log("Database closed under timeout force-close.");
    } catch (err) {
      console.error("Error closing database during timeout force-close:", err);
    }
    process.exit(exitCode);
  }, timeoutMs);
  forceTimeout.unref();

  server.close((err) => {
    clearTimeout(forceTimeout);
    if (err) {
      console.error("Error during HTTP server shutdown:", err);
    } else {
      console.log("HTTP server closed successfully.");
    }

    try {
      database.close();
      console.log("Database closed cleanly.");
    } catch (dbErr) {
      console.error("Error closing database cleanly:", dbErr);
    }

    process.exit(exitCode);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM", 0));
process.on("SIGINT", () => gracefulShutdown("SIGINT", 0));

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection", 1);
});
