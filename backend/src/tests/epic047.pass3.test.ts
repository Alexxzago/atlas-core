import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { Router } from "express";
import { createApp } from "../app.js";
import { CompanyOperationalStatusService } from "../company/services/companyOperationalStatusService.js";
import { AssistantReadinessAssessmentRepository } from "../repositories/assistantReadinessAssessmentRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { markRuntimeReady, markRuntimeShuttingDown, registerRuntimeWorker, resetRuntimeReadinessForTests, runtimeWorkerCycleSucceeded, runtimeWorkerStarted, runtimeWorkersRegistered } from "../config/runtimeReadiness.js";
import { createRequestId, operationalLogger, setOperationalLogSinkForTests, withRequestContext } from "../observability/operationalLogger.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import type { SqlDatabase, SqlResult, SqlValue } from "../config/sqlDatabase.js";
import { createHealthRouter } from "../routes/health.js";

function capture(): { records: Array<Record<string, unknown>>; restore(): void } { const records: Array<Record<string, unknown>> = [], restore = setOperationalLogSinkForTests((line) => records.push(JSON.parse(line) as Record<string, unknown>)); return { records, restore }; }
function listen(app: express.Express): Promise<{ readonly server: ReturnType<express.Express["listen"]>; readonly origin: string }> { const server = app.listen(0, "127.0.0.1"); return new Promise((resolve) => server.once("listening", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))); }
function close(server: ReturnType<express.Express["listen"]>): Promise<void> { return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
function markWorkersHealthy(): void { for (const name of ["billing_reconciliation", "whatsapp_recovery"]) { runtimeWorkerStarted(name); runtimeWorkerCycleSucceeded(name); } }
function readinessApp(probe: (statement: string) => Promise<void>): express.Express { const database: SqlDatabase = { async execute(_statement: string, _args: readonly SqlValue[] = []): Promise<SqlResult> { return { rowsAffected: 0 }; }, async executeScript(_script: string): Promise<void> {}, async query<Row extends Record<string, unknown>>(statement: string, _args: readonly SqlValue[] = []): Promise<Row[]> { await probe(statement); return []; }, async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> { return operation(database); }, async close(): Promise<void> {} }; const app = express(); app.use((_request, _response, next) => withRequestContext(createRequestId(), () => next())); app.use(createHealthRouter(database)); return app; }

test("EPIC047 PASS3 separates liveness from boot readiness and records worker registration", async () => {
  resetRuntimeReadinessForTests();
  const empty = Router(), app = createApp({ authorizedCompaniesRouter: empty, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    assert.equal((await fetch(`${origin}/ready`)).status, 503);
    registerRuntimeWorker("billing_reconciliation"); registerRuntimeWorker("whatsapp_recovery"); markWorkersHealthy(); markRuntimeReady();
    assert.deepEqual(runtimeWorkersRegistered(), ["billing_reconciliation", "whatsapp_recovery"]);
    assert.equal((await fetch(`${origin}/ready`)).status, 200);
    markRuntimeShuttingDown();
    assert.equal((await fetch(`${origin}/health`)).status, 503);
    assert.equal((await fetch(`${origin}/ready`)).status, 503);
  } finally { resetRuntimeReadinessForTests(); await close(server); }
});

test("EPIC047 PASS3 readiness gates configured required workers while optional registrations have no effect", async () => {
  resetRuntimeReadinessForTests();
  const app = createApp({ authorizedCompaniesRouter: Router(), chatRouter: Router(), companiesRouter: Router(), identityRouter: Router(), knowledgeRouter: Router(), publicWebChatRouter: Router(), scrapeRouter: Router(), workspacesRouter: Router() });
  const { server, origin } = await listen(app);
  try {
    markRuntimeReady(); registerRuntimeWorker("voice_transcription"); registerRuntimeWorker("optional_reporting");
    assert.equal((await fetch(`${origin}/ready`)).status, 200);
    registerRuntimeWorker("billing_reconciliation", { required: true }); assert.equal((await fetch(`${origin}/ready`)).status, 503);
    runtimeWorkerStarted("billing_reconciliation"); runtimeWorkerCycleSucceeded("billing_reconciliation"); assert.equal((await fetch(`${origin}/ready`)).status, 200);
    registerRuntimeWorker("whatsapp_recovery", { configured: true, required: true }); assert.equal((await fetch(`${origin}/ready`)).status, 503);
    runtimeWorkerStarted("whatsapp_recovery"); runtimeWorkerCycleSucceeded("whatsapp_recovery"); assert.equal((await fetch(`${origin}/ready`)).status, 200);
  } finally { resetRuntimeReadinessForTests(); await close(server); }
});

test("EPIC047 PASS3 probes SQLite for every ready request and recovers after a database failure", async () => {
  resetRuntimeReadinessForTests(); registerRuntimeWorker("billing_reconciliation"); registerRuntimeWorker("whatsapp_recovery"); markWorkersHealthy(); markRuntimeReady();
  let probes = 0, unavailable = false;
  const app = readinessApp(async (statement) => { assert.equal(statement, "SELECT 1 AS ready"); probes++; if (unavailable) throw new Error("database password=secret"); });
  const { server, origin } = await listen(app);
  try {
    assert.equal((await fetch(`${origin}/ready`)).status, 200);
    assert.equal((await fetch(`${origin}/ready`)).status, 200);
    unavailable = true; assert.equal((await fetch(`${origin}/ready`)).status, 503);
    unavailable = false; assert.equal((await fetch(`${origin}/ready`)).status, 200);
    assert.equal(probes, 4);
  } finally { resetRuntimeReadinessForTests(); await close(server); }
});

test("EPIC047 PASS3 a ready probe performs exactly one database query and no application work", async () => {
  resetRuntimeReadinessForTests(); registerRuntimeWorker("billing_reconciliation"); registerRuntimeWorker("whatsapp_recovery"); markWorkersHealthy(); markRuntimeReady();
  const queries: string[] = [];
  const app = readinessApp(async (statement) => { queries.push(statement); });
  const { server, origin } = await listen(app);
  try { assert.equal((await fetch(`${origin}/ready`)).status, 200); assert.deepEqual(queries, ["SELECT 1 AS ready"]); }
  finally { resetRuntimeReadinessForTests(); await close(server); }
});

test("EPIC047 PASS3 ready performs no provider, migration, checksum, or domain work", async () => {
  resetRuntimeReadinessForTests(); registerRuntimeWorker("billing_reconciliation"); registerRuntimeWorker("whatsapp_recovery"); markWorkersHealthy(); markRuntimeReady();
  const previousFetch = globalThis.fetch;
  let providerCalls = 0, migrationExecutions = 0, checksumRescans = 0, domainQueries = 0, databaseQueries = 0;
  globalThis.fetch = (async () => { providerCalls++; throw new Error("provider must not be called by readiness"); }) as typeof fetch;
  const app = readinessApp(async (statement) => { if (statement === "SELECT 1 AS ready") databaseQueries++; else { domainQueries++; if (statement.includes("schema_migrations")) checksumRescans++; } });
  const { server, origin } = await listen(app);
  try { assert.equal((await previousFetch(`${origin}/ready`)).status, 200); assert.deepEqual({ providerCalls, migrationExecutions, checksumRescans, domainQueries, databaseQueries }, { providerCalls: 0, migrationExecutions: 0, checksumRescans: 0, domainQueries: 0, databaseQueries: 1 }); }
  finally { globalThis.fetch = previousFetch; resetRuntimeReadinessForTests(); await close(server); }
});

test("EPIC047 PASS3 readiness failures are sanitized and correlated with the HTTP request", async () => {
  resetRuntimeReadinessForTests(); registerRuntimeWorker("billing_reconciliation"); registerRuntimeWorker("whatsapp_recovery"); markWorkersHealthy(); markRuntimeReady();
  const logs = capture();
  const app = readinessApp(async (statement) => { assert.equal(statement, "SELECT 1 AS ready"); throw new Error("password=secret@example.test"); });
  const { server, origin } = await listen(app);
  try {
    assert.equal((await fetch(`${origin}/ready`)).status, 503);
    const readiness = logs.records.find((record) => record.event === "readiness_check_failed")!;
    assert.equal(readiness.safeErrorCategory, "database_failure"); assert.equal(readiness.outcome, "database_unavailable"); assert.ok(typeof readiness.requestId === "string"); assert.ok(!JSON.stringify(readiness).includes("secret@example.test"));
  } finally { logs.restore(); resetRuntimeReadinessForTests(); await close(server); }
});

test("EPIC047 PASS3 reads persisted tenant operational state without provider access", async () => {
  const context = createWorkspaceContext({ id: 1, key: "default" } as never), connectionId = "wac_0123456789abcdef0123456789abcdef" as never;
  const service = new CompanyOperationalStatusService({ findById: () => ({ id: 2 }) } as never, { findLatest: () => ({ status: "blocked", evaluatedAt: "2026-09-03T00:00:00.000Z", blockers: ["published_knowledge_missing"] }) } as never, { listByCompany: () => [{ id: connectionId, status: "active" }], findOperationalState: () => ({ validationState: "valid", healthState: "healthy" }) } as never);
  assert.deepEqual(await service.get(context, 2), { assistant: { status: "blocked", evaluatedAt: "2026-09-03T00:00:00.000Z", blockers: ["published_knowledge_missing"] }, whatsApp: [{ connectionId, status: "active", validationState: "valid", healthState: "healthy" }], voice: { status: "unavailable" } });
  const missing = new CompanyOperationalStatusService({ findById: () => null } as never, {} as never, {} as never);
  await assert.rejects(missing.get(context, 2));
});

test("EPIC047 PASS3 serializes only the bounded safe operational projection", async () => {
  const context = createWorkspaceContext({ id: 1, key: "default" } as never), secrets = ["access-token-hostile", "refresh-token-hostile", "api-key-hostile", "Authorization-hostile", "webhook-secret-hostile", "signature-hostile", "person@example.test", "+15555550123", "message-content-hostile", "https://media.example.test/hostile", "provider-payload-hostile", "raw-error-hostile", "stack-hostile", "payer-data-hostile", "metadata-secret-hostile"];
  const connections = Array.from({ length: 25 }, (_, index) => ({ id: `wac_${index.toString().padStart(32, "0")}`, status: "active", accessToken: secrets[0], refreshToken: secrets[1], apiKey: secrets[2], authorization: secrets[3], webhookSecret: secrets[4], signature: secrets[5], email: secrets[6], phone: secrets[7], message: secrets[8], mediaUrl: secrets[9], providerPayload: secrets[10], rawError: secrets[11], stack: secrets[12], payer: secrets[13], metadata: secrets[14] }));
  const service = new CompanyOperationalStatusService({ findById: (_context: unknown, _companyId: number) => ({ id: 2, email: secrets[6] }) } as never, { findLatest: (_context: unknown, _companyId: number) => ({ status: "ready", evaluatedAt: "2026-09-03T00:00:00.000Z", blockers: [], rawPayload: secrets[10] }) } as never, { listByCompany: (_context: unknown, _companyId: number) => connections, findOperationalState: () => ({ validationState: "valid", healthState: "healthy", rawError: secrets[11] }) } as never);
  const app = express(); app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: () => ({ userId: "reader" }), validateCsrf: () => true } as never, users: { findById: () => ({ id: "reader" }) } as never, authorization: { authorize: () => ({ userId: "reader", membershipId: "member", role: "viewer", capabilities: new Set(["company:read"]) }) } as never, resolver: { resolve: () => context } as never, controllers: {} as never, assistantControllers: {} as never, companyOperationalStatusService: service }));
  const { server, origin } = await listen(app), previousFetch = globalThis.fetch; let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; throw new Error("provider must not be called by operational status"); }) as typeof fetch;
  try { const response = await previousFetch(`${origin}/workspaces/wsp_default/companies/2/operational-status`, { headers: { cookie: "atlas=reader" } }), body = await response.json() as Record<string, unknown>, serialized = JSON.stringify(body); assert.equal(response.status, 200); assert.deepEqual(Object.keys(body).sort(), ["assistant", "voice", "whatsApp"]); assert.equal((body.whatsApp as unknown[]).length, 20); assert.equal(providerCalls, 0); assert.ok(secrets.every((secret) => !serialized.includes(secret))); assert.deepEqual(body.voice, { status: "unavailable" }); }
  finally { globalThis.fetch = previousFetch; await close(server); }
});

test("EPIC047 PASS3 operational-status repositories use bounded and tenant-fenced lookups", () => {
  const context = createWorkspaceContext({ id: 7, key: "seven" } as never), readinessSql: string[] = [], whatsAppSql: Array<{ sql: string; values: unknown[] }> = [];
  const readiness = new AssistantReadinessAssessmentRepository({ prepare(sql: string) { readinessSql.push(sql); return { get: () => undefined }; } } as never);
  const whatsApp = new WhatsAppConnectionRepository({ prepare(sql: string) { return { all: (...values: unknown[]) => { whatsAppSql.push({ sql, values }); return []; }, get: (...values: unknown[]) => { whatsAppSql.push({ sql, values }); return undefined; } }; } } as never);
  assert.equal(readiness.findLatest(context, 9, null), null); assert.match(readinessSql[0]!, /ORDER BY evaluated_at DESC,id DESC LIMIT 1/);
  assert.deepEqual(whatsApp.listByCompany(context, 9), []); assert.equal(whatsApp.findOperationalState(context, 9, "wac_0123456789abcdef0123456789abcdef" as never), null);
  assert.ok(whatsAppSql.every(({ sql, values }) => sql.includes("company_id=?") && sql.includes("workspace_id=?") && values.includes(9) && values.includes(7)));
});

test("EPIC047 PASS3 logs unexpected operational-status service failures without data exposure", async () => {
  const logs = capture(), context = createWorkspaceContext({ id: 1, key: "default" } as never);
  try { await assert.rejects(new CompanyOperationalStatusService({ findById: () => { throw new Error("token=secret"); } } as never, {} as never, {} as never).get(context, 2)); const record = logs.records[0]!; assert.equal(record.event, "company_operational_status_failed"); assert.equal(record.safeErrorCategory, "internal_failure"); assert.equal(record.companyId, 2); assert.ok(!JSON.stringify(record).includes("secret")); } finally { logs.restore(); }
});

test("EPIC047 PASS3 operational-status route requires company read authorization", async () => {
  const context = createWorkspaceContext({ id: 1, key: "default" } as never), handler = (_req: unknown, response: { status(code: number): { end(): void } }) => response.status(204).end();
  const app = express(); app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "reader" ? { userId: raw } : null, validateCsrf: () => true } as never, users: { findById: (id: string) => id === "reader" ? { id } : null } as never, authorization: { authorize: (_user: unknown, _workspace: string, permission: string) => { if (permission !== "company:read") throw new Error("denied"); return { userId: "reader", membershipId: "member", role: "viewer", capabilities: new Set([permission]) }; } } as never, resolver: { resolve: () => context } as never, controllers: {} as never, assistantControllers: { list: () => handler, create: () => handler, get: () => handler, update: () => handler, transition: () => handler, preview: () => handler } as never, companyOperationalStatusService: { get: () => ({ assistant: { status: "unavailable", evaluatedAt: null, blockers: [] }, whatsApp: [], voice: { status: "unavailable" } }) } as never }));
  const { server, origin } = await listen(app), path = `${origin}/workspaces/wsp_default/companies/2/operational-status`;
  try { assert.equal((await fetch(path)).status, 404); assert.equal((await fetch(path, { headers: { cookie: "atlas=reader" } })).status, 200); } finally { await close(server); }
});

test("EPIC047 PASS3 operational-status route fences workspace queries and returns canonical 404s", async () => {
  const contexts = new Map([["wsp_one", createWorkspaceContext({ id: 1, key: "one" } as never)], ["wsp_two", createWorkspaceContext({ id: 2, key: "two" } as never)]]), calls: Array<{ operation: string; workspaceId: number; companyId: number }> = [];
  const service = new CompanyOperationalStatusService({ findById: (context: { workspaceId: number }, companyId: number) => { calls.push({ operation: "company", workspaceId: context.workspaceId, companyId }); return context.workspaceId === 1 && companyId === 2 ? { id: 2 } : null; } } as never, { findLatest: (context: { workspaceId: number }, companyId: number) => { calls.push({ operation: "assessment", workspaceId: context.workspaceId, companyId }); return null; } } as never, { listByCompany: (context: { workspaceId: number }, companyId: number) => { calls.push({ operation: "connections", workspaceId: context.workspaceId, companyId }); return []; }, findOperationalState: () => { throw new Error("must not query an empty connection list"); } } as never);
  const app = express(); app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "reader" || raw === "denied" ? { userId: raw } : null, validateCsrf: () => true } as never, users: { findById: (id: string) => ({ id }) } as never, authorization: { authorize: (user: { id: string }, workspace: string) => { if (user.id === "denied") throw new Error("permission denied"); return { userId: user.id, membershipId: "member", workspaceId: workspace, role: "viewer", capabilities: new Set(["company:read"]) }; } } as never, resolver: { resolve: (decision: { workspaceId: string }) => contexts.get(decision.workspaceId) ?? (() => { throw new Error("unknown workspace"); })() } as never, controllers: {} as never, assistantControllers: {} as never, companyOperationalStatusService: service }));
  const { server, origin } = await listen(app);
  const request = async (workspace: string, company: string, cookie = "reader") => fetch(`${origin}/workspaces/${workspace}/companies/${company}/operational-status`, { headers: { cookie: `atlas=${cookie}` } });
  try {
    assert.equal((await request("wsp_one", "2")).status, 200);
    assert.deepEqual(calls, [{ operation: "company", workspaceId: 1, companyId: 2 }, { operation: "assessment", workspaceId: 1, companyId: 2 }, { operation: "connections", workspaceId: 1, companyId: 2 }]);
    calls.length = 0;
    for (const response of [await request("wsp_two", "2"), await request("wsp_one", "999"), await request("wsp_one", "2", "denied")]) { assert.equal(response.status, 404); assert.ok(!(await response.text()).includes("permission denied")); }
    assert.deepEqual(calls, [{ operation: "company", workspaceId: 2, companyId: 2 }, { operation: "company", workspaceId: 1, companyId: 999 }]);
  } finally { await close(server); }
});

test("EPIC047 PASS3 operational-status hostile failures return no provider or repository details", async () => {
  const context = createWorkspaceContext({ id: 1, key: "default" } as never), secret = "token=provider-secret@example.test";
  const app = express(); app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: () => ({ userId: "reader" }), validateCsrf: () => true } as never, users: { findById: () => ({ id: "reader" }) } as never, authorization: { authorize: () => ({ userId: "reader", membershipId: "member", role: "viewer", capabilities: new Set(["company:read"]) }) } as never, resolver: { resolve: () => context } as never, controllers: {} as never, assistantControllers: {} as never, companyOperationalStatusService: new CompanyOperationalStatusService({ findById: () => { throw new Error(secret); } } as never, {} as never, {} as never) }));
  const { server, origin } = await listen(app);
  try { const response = await fetch(`${origin}/workspaces/wsp_default/companies/2/operational-status`, { headers: { cookie: "atlas=reader" } }); assert.equal(response.status, 500); assert.ok(!(await response.text()).includes(secret)); }
  finally { await close(server); }
});
