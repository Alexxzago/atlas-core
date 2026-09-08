import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";
import { BillingReconciliationRuntime } from "../billing/services/billingReconciliationRuntime.js";
import { createRequestId, createRunId, currentOperationalContext, normalizeOperationalError, operationalLogger, setOperationalLogSinkForTests, withRequestContext, withRunContext } from "../observability/operationalLogger.js";

function capture(): { records: Array<Record<string, unknown>>; restore(): void } { const records: Array<Record<string, unknown>> = [], restore = setOperationalLogSinkForTests((line) => records.push(JSON.parse(line) as Record<string, unknown>)); return { records, restore }; }

test("EPIC047 PASS2 generates server-owned request IDs and propagates them through async work", async () => {
  const logs = capture(); try { const first = createRequestId(), second = createRequestId(); assert.notEqual(first, second); await withRequestContext(first, async () => { await Promise.resolve(); operationalLogger.info("context_probe", { provider: "test" }); }); assert.equal(logs.records[0]?.requestId, first); } finally { logs.restore(); }
});

test("EPIC047 PASS2 logger is allowlisted, bounded, and never serializes arbitrary secrets", () => {
  const logs = capture(); try { operationalLogger.error("provider_call_failed", { provider: "stripe", safeErrorCategory: normalizeOperationalError(new Error("password=secret@example.test token=abc")), operation: "x".repeat(500), unknown: "password=secret@example.test" } as never); const line = JSON.stringify(logs.records[0]); assert.ok(Buffer.byteLength(line, "utf8") <= 4_096); assert.ok(!line.includes("secret@example.test")); assert.ok(!line.includes("unknown")); assert.equal(logs.records[0]?.safeErrorCategory, "internal_failure"); assert.equal(normalizeOperationalError({ status: 404 }), "not_found"); } finally { logs.restore(); }
});

test("EPIC047 PASS2 HTTP completion ignores client request IDs and logs a controlled route", async () => {
  const logs = capture(), router = Router(); router.get("/probe", async (_request, response) => { await Promise.resolve(); response.status(204).end(); }); const app = createApp({ authorizedCompaniesRouter: Router(), chatRouter: Router(), companiesRouter: Router(), identityRouter: Router(), knowledgeRouter: Router(), publicWebChatRouter: Router(), scrapeRouter: router, workspacesRouter: Router() }); const server = app.listen(0, "127.0.0.1");
  try { await new Promise<void>((resolve) => server.once("listening", resolve)); const address = server.address() as AddressInfo; await fetch(`http://127.0.0.1:${address.port}/probe?proof=secret`, { headers: { "x-request-id": "attacker-controlled" } }); const record = logs.records.find((value) => value.event === "http_request_completed")!; assert.equal(record.httpMethod, "GET"); assert.equal(record.httpStatus, 204); assert.equal(record.routePattern, "/other"); assert.ok(typeof record.requestId === "string" && record.requestId !== "attacker-controlled"); assert.ok(!JSON.stringify(record).includes("proof")); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); logs.restore(); }
});

test("EPIC047 PASS2 worker cycles receive unique non-durable run IDs", async () => {
  const logs = capture(); let scheduled: (() => void) | null = null; const runtime = new BillingReconciliationRuntime({ async runBatch() { return ["applied"] as never; } } as never, { intervalMilliseconds: 1_000, batchSize: 1 }, { schedule: (callback) => { scheduled = callback; return { unref() {} }; }, clear: () => {}, reportError: () => {} });
  try { const one = createRunId(), two = createRunId(); assert.notEqual(one, two); await withRunContext(one, async () => { operationalLogger.info("worker_probe", { worker: "test" }); }); runtime.start(); await new Promise<void>((resolve) => setImmediate(resolve)); scheduled!(); await new Promise<void>((resolve) => setImmediate(resolve)); await runtime.stop(); const runs = logs.records.filter((value) => value.event === "worker_cycle_started").map((value) => value.runId); assert.ok(runs.length >= 1); assert.ok(runs.every((value) => typeof value === "string" && String(value).startsWith("run_"))); assert.equal(currentOperationalContext().runId, undefined); } finally { logs.restore(); }
});
