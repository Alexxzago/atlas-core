import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { BillingReconciliationRuntime } from "../billing/services/billingReconciliationRuntime.js";
import { markRuntimeReady, registerRuntimeWorker, resetRuntimeReadinessForTests, runtimeWorkerCycleFailed, runtimeWorkerCycleSucceeded, runtimeWorkerHealth, runtimeWorkerStarted } from "../config/runtimeReadiness.js";
import type { SqlDatabase, SqlResult, SqlValue } from "../config/sqlDatabase.js";
import { createHealthRouter } from "../routes/health.js";
import { WhatsAppRecoveryRuntime } from "../whatsapp/services/WhatsAppRecoveryRuntime.js";

class ProbeDatabase implements SqlDatabase {
  public probes = 0; public unavailable = false;
  public async execute(_sql: string, _args: readonly SqlValue[] = []): Promise<SqlResult> { return { rowsAffected: 0 }; }
  public async executeScript(_sql: string): Promise<void> {}
  public async query<Row extends Record<string, unknown>>(sql: string, _args: readonly SqlValue[] = []): Promise<Row[]> { this.probes++; if (this.unavailable) throw new Error("token=unsafe"); assert.equal(sql, "SELECT 1 AS ready"); return []; }
  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> { return operation(this); }
  public async close(): Promise<void> {}
}
async function healthApp(database: ProbeDatabase): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> { const app = express(); app.use(createHealthRouter(database)); const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address() as import("node:net").AddressInfo; return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) }; }
function succeed(name: "billing_reconciliation" | "whatsapp_recovery"): void { runtimeWorkerStarted(name); runtimeWorkerCycleSucceeded(name); }

test("EPIC054 PASS5B readiness gates required worker first success, failure recovery, stale activity, optional WhatsApp, and database probes", async () => {
  resetRuntimeReadinessForTests(); const database = new ProbeDatabase(), app = await healthApp(database), originalNow = Date.now; let clock = 1_000;
  Date.now = () => clock;
  try {
    registerRuntimeWorker("billing_reconciliation", { required: true }); registerRuntimeWorker("whatsapp_recovery", { required: false }); markRuntimeReady();
    assert.equal((await fetch(`${app.origin}/health`)).status, 200); assert.equal(database.probes, 0);
    assert.equal((await fetch(`${app.origin}/ready`)).status, 503);
    succeed("billing_reconciliation"); assert.equal((await fetch(`${app.origin}/ready`)).status, 200);
    registerRuntimeWorker("whatsapp_recovery", { configured: true, required: true }); assert.equal((await fetch(`${app.origin}/ready`)).status, 503);
    succeed("whatsapp_recovery"); assert.equal((await fetch(`${app.origin}/ready`)).status, 200);
    runtimeWorkerCycleFailed("billing_reconciliation", "provider_failure"); assert.equal((await fetch(`${app.origin}/ready`)).status, 503);
    runtimeWorkerCycleSucceeded("billing_reconciliation"); assert.equal((await fetch(`${app.origin}/ready`)).status, 200);
    clock += 15_001; assert.equal((await fetch(`${app.origin}/ready`)).status, 503);
    runtimeWorkerCycleSucceeded("billing_reconciliation"); database.unavailable = true; assert.equal((await fetch(`${app.origin}/ready`)).status, 503);
  } finally { Date.now = originalNow; resetRuntimeReadinessForTests(); await app.close(); }
});

test("EPIC054 PASS5B configured WhatsApp and billing reconciliation publish the shared worker health contract", async () => {
  resetRuntimeReadinessForTests(); registerRuntimeWorker("billing_reconciliation", { required: true }); const callback = { value: null as (() => void) | null };
  const billing = new BillingReconciliationRuntime({ runBatch: async () => [] } as never, { intervalMilliseconds: 1_000, batchSize: 1 }, { schedule: scheduled => { callback.value = scheduled; return { unref() {} }; }, clear: () => {}, reportError: () => {} });
  billing.start(); await new Promise<void>(resolve => setImmediate(resolve)); assert.notEqual(runtimeWorkerHealth("billing_reconciliation")?.lastSuccessfulCycleAt, null); await billing.stop();
  registerRuntimeWorker("whatsapp_recovery", { required: true }); let calls = 0, release: (() => void) | null = null; const gate = new Promise<void>(resolve => { release = resolve; }), timer = { value: null as (() => void) | null };
  const whatsApp = new WhatsAppRecoveryRuntime(async () => { calls++; await gate; }, { schedule: callback => { timer.value = callback; return { unref() {} }; }, clear: () => {} });
  whatsApp.start(); timer.value!(); timer.value!(); assert.equal(calls, 1); const stopping = whatsApp.stop(); timer.value!(); assert.equal(calls, 1); release!(); await stopping; assert.equal(runtimeWorkerHealth("whatsapp_recovery")?.running, false); resetRuntimeReadinessForTests();
});
