import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { markRuntimeReady, registerRuntimeWorker, resetRuntimeReadinessForTests, runtimeWorkerHealth, runtimeWorkerIsHealthy } from "../config/runtimeReadiness.js";
import type { SqlDatabase, SqlResult, SqlValue } from "../config/sqlDatabase.js";
import { setOperationalLogSinkForTests } from "../observability/operationalLogger.js";
import { createHealthRouter, resetReadinessDiagnosticsForTests } from "../routes/health.js";
import { WhatsAppRecoveryRuntime } from "../whatsapp/services/WhatsAppRecoveryRuntime.js";
import { runWhatsAppRecoveryCycle } from "../whatsapp/services/whatsAppRecoveryCycle.js";

function capture(): { readonly records: Array<Record<string, unknown>>; readonly restore: () => void } { const records: Array<Record<string, unknown>> = [], restore = setOperationalLogSinkForTests(line => records.push(JSON.parse(line) as Record<string, unknown>)); return { records, restore }; }
function wait(): Promise<void> { return new Promise(resolve => setImmediate(resolve)); }
function database(): SqlDatabase { return { async execute(_sql: string, _args: readonly SqlValue[] = []): Promise<SqlResult> { return { rowsAffected: 0 }; }, async executeScript(_sql: string): Promise<void> {}, async query<Row extends Record<string, unknown>>(_sql: string, _args: readonly SqlValue[] = []): Promise<Row[]> { return []; }, async transaction<T>(operation: (value: SqlDatabase) => Promise<T>): Promise<T> { return operation(this); }, async close(): Promise<void> {} }; }

test("EPIC056 recovery failure logs its exact safe stage and a later success clears health", async () => {
  resetRuntimeReadinessForTests(); const logs = capture(), callbacks: Array<() => void> = []; let fail = true;
  const runtime = new WhatsAppRecoveryRuntime(async stage => { stage("resume_incomplete_executions"); if (fail) throw new Error("token=secret"); stage(null); }, { schedule: callback => { callbacks.push(callback); return { unref() {} }; }, clear: () => {} });
  try {
    runtime.start(); await wait();
    const failure = logs.records.find(record => record.event === "whatsapp_recovery_cycle_failed")!;
    assert.equal(failure.worker, "whatsapp_recovery"); assert.equal(failure.stage, "resume_incomplete_executions"); assert.equal(failure.safeErrorCategory, "internal_failure"); assert.equal(typeof failure.runId, "string"); assert.equal(JSON.stringify(failure).includes("secret"), false);
    assert.equal(runtimeWorkerHealth("whatsapp_recovery")?.lastFailedStage, "resume_incomplete_executions");
    fail = false; callbacks[0]!(); await wait();
    assert.equal(runtimeWorkerHealth("whatsapp_recovery")?.lastErrorCategory, null); assert.equal(runtimeWorkerHealth("whatsapp_recovery")?.consecutiveFailures, 0); assert.equal(logs.records.filter(record => record.event === "whatsapp_recovery_recovered").length, 1);
  } finally { await runtime.stop(); logs.restore(); resetRuntimeReadinessForTests(); }
});

test("EPIC056 readiness logs WhatsApp worker diagnostics once per unchanged failure and preserves its response", async () => {
  resetRuntimeReadinessForTests(); resetReadinessDiagnosticsForTests(); const logs = capture(), originalNow = Date.now; let clock = 1_000;
  Date.now = () => clock;
  const app = express(); app.use(createHealthRouter(database())); const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address() as import("node:net").AddressInfo;
  try {
    registerRuntimeWorker("billing_reconciliation", { required: false }); registerRuntimeWorker("whatsapp_recovery", { required: true }); markRuntimeReady();
    const first = await fetch(`http://127.0.0.1:${address.port}/ready`), second = await fetch(`http://127.0.0.1:${address.port}/ready`);
    assert.equal(first.status, 503); assert.deepEqual(await first.json(), { status: "not_ready" }); assert.equal(second.status, 503); assert.deepEqual(await second.json(), { status: "not_ready" });
    const failures = logs.records.filter(record => record.event === "readiness_check_failed" && record.outcome === "workers_unavailable");
    assert.equal(failures.length, 1); assert.equal(failures[0]?.unavailableWorkers, "whatsapp_recovery"); assert.equal(failures[0]?.worker, "whatsapp_recovery"); assert.equal(failures[0]?.started, "false"); assert.equal(failures[0]?.currentStage, "none");
    clock += 60_000; await fetch(`http://127.0.0.1:${address.port}/ready`); assert.equal(logs.records.filter(record => record.event === "readiness_check_failed" && record.outcome === "workers_unavailable").length, 2);
  } finally { Date.now = originalNow; logs.restore(); resetRuntimeReadinessForTests(); resetReadinessDiagnosticsForTests(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("EPIC056 a WhatsApp cycle running longer than 15 seconds makes readiness unavailable", async () => {
  resetRuntimeReadinessForTests(); resetReadinessDiagnosticsForTests(); const originalNow = Date.now; let clock = 1_000, release: (() => void) | null = null;
  Date.now = () => clock;
  const blocked = new Promise<void>(resolve => { release = resolve; }), app = express(); app.use(createHealthRouter(database())); const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address() as import("node:net").AddressInfo;
  const runtime = new WhatsAppRecoveryRuntime(async stage => { stage("dispatch_ready_outbound"); await blocked; }, { schedule: () => ({ unref() {} }), clear: () => {} });
  try {
    registerRuntimeWorker("billing_reconciliation", { required: true, staleAfterMilliseconds: 120_000 }); registerRuntimeWorker("whatsapp_recovery", { required: true });
    const { runtimeWorkerCycleSucceeded, runtimeWorkerStarted } = await import("../config/runtimeReadiness.js"); runtimeWorkerStarted("billing_reconciliation"); runtimeWorkerCycleSucceeded("billing_reconciliation"); markRuntimeReady(); runtime.start();
    clock += 15_001; const response = await fetch(`http://127.0.0.1:${address.port}/ready`); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { status: "not_ready" });
  } finally { release!(); await runtime.stop(); Date.now = originalNow; resetRuntimeReadinessForTests(); resetReadinessDiagnosticsForTests(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("EPIC056 stage instrumentation preserves the base recovery order and covers every operation", async () => {
  const operations: string[] = [], stages: Array<string | null> = [];
  await runWhatsAppRecoveryCycle(true, { executeProactive: async () => { operations.push("proactive"); }, recoverInboundMedia: async onStage => { operations.push("inbound"); onStage?.("recompute_media_gates"); operations.push("gates"); onStage?.(null); }, recoverAtlasMedia: async () => { operations.push("durable-media"); }, transcribeVoice: async () => { operations.push("transcribe"); }, resumeIncomplete: async () => { operations.push("resume"); }, synthesizeVoice: async () => { operations.push("synthesize"); }, uploadVoice: async () => { operations.push("upload"); }, dispatchOutbound: async () => { operations.push("dispatch"); }, recoverVoiceSemantics: async () => { operations.push("voice-semantics"); }, recoverProactiveSemantics: async () => { operations.push("proactive-semantics"); } }, stage => stages.push(stage));
  assert.deepEqual(operations, ["proactive", "inbound", "gates", "durable-media", "transcribe", "resume", "synthesize", "upload", "dispatch", "voice-semantics", "proactive-semantics"]);
  assert.deepEqual(stages.filter((stage): stage is string => stage !== null), ["proactive_execution", "recover_inbound_media", "recompute_media_gates", "recover_durable_media", "voice_transcription", "resume_incomplete_executions", "voice_synthesis", "voice_upload", "dispatch_ready_outbound", "voice_semantics", "proactive_semantics"]);
});

test("EPIC056 stage transitions do not refresh whole-cycle freshness", async () => {
  resetRuntimeReadinessForTests(); const originalNow = Date.now; let clock = 1_000, advance: (() => void) | null = null, release: (() => void) | null = null;
  Date.now = () => clock; const transitioned = new Promise<void>(resolve => { advance = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  const runtime = new WhatsAppRecoveryRuntime(async stage => { stage("proactive_execution"); await transitioned; stage("dispatch_ready_outbound"); await blocked; }, { schedule: () => ({ unref() {} }), clear: () => {} });
  try { runtime.start(); clock = 14_000; advance!(); await wait(); clock = 16_001; assert.equal(runtimeWorkerHealth("whatsapp_recovery")?.lastActivityAt, 1_000); assert.equal(runtimeWorkerIsHealthy("whatsapp_recovery", clock), false); }
  finally { release!(); await runtime.stop(); Date.now = originalNow; resetRuntimeReadinessForTests(); }
});

test("EPIC056 readiness includes safe health for every unavailable worker", async () => {
  resetRuntimeReadinessForTests(); resetReadinessDiagnosticsForTests(); const logs = capture(), app = express(); app.use(createHealthRouter(database())); const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address() as import("node:net").AddressInfo;
  try { registerRuntimeWorker("billing_reconciliation", { required: true }); registerRuntimeWorker("whatsapp_recovery", { required: true }); markRuntimeReady(); assert.equal((await fetch(`http://127.0.0.1:${address.port}/ready`)).status, 503); const record = logs.records.find(value => value.outcome === "workers_unavailable")!, health = JSON.parse(String(record.unavailableWorkerHealth)) as Array<Record<string, string>>; assert.equal(record.unavailableWorkers, "billing_reconciliation:whatsapp_recovery"); assert.deepEqual(health.map(value => value.worker), ["billing_reconciliation", "whatsapp_recovery"]); assert.equal(health.every(value => value.started === "false" && value.currentStage === "none"), true); }
  finally { logs.restore(); resetRuntimeReadinessForTests(); resetReadinessDiagnosticsForTests(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
