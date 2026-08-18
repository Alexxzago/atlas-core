import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "../assistant/application/toolRegistry.js";
import { productionAssistantCapabilityCatalog } from "../assistant/domain/assistantCapability.js";
import { ToolExecutionService } from "../assistant/services/toolExecutionService.js";
import { createDatabase } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { liveDataReadToolDefinition } from "../liveData/application/liveDataReadToolDefinition.js";
import type { LiveDataObservationRepositoryPort, LiveDataProviderOutcome, LiveDataProviderPort } from "../liveData/application/ports.js";
import type { LiveDataObservation } from "../liveData/domain/liveData.js";
import { FakeLiveDataProvider } from "../liveData/infrastructure/fakeLiveDataProvider.js";
import { LiveDataService } from "../liveData/services/liveDataService.js";
import { LiveDataToolAvailabilityPolicy } from "../liveData/services/liveDataToolAvailabilityPolicy.js";
import { LiveDataObservationRepository } from "../repositories/liveDataObservationRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

class Clock { public now(): string { return "2026-08-18T00:00:00.000Z"; } }
const traceId = "ttr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const readiness = (ready: boolean) => ({ isReadyForTool: async (_context: { readonly workspaceId: number }, _companyId: number, provider: string, kind: string) => ready && provider === "live_data" && kind === "observation" });

class MemoryObservations implements LiveDataObservationRepositoryPort {
  public readonly values: LiveDataObservation[] = [];
  public async create(_context: { readonly workspaceId: number }, observation: LiveDataObservation): Promise<LiveDataObservation> { this.values.push(observation); return observation; }
  public async findLatest(): Promise<null> { return null; }
  public async findById(): Promise<null> { return null; }
}

test("EPIC035 migrates trace-linked, append-only, workspace-scoped live data observations", () => {
  const database = createDatabase(":memory:");
  try {
    assert.equal((database.prepare("SELECT name FROM schema_migrations WHERE id=41").get() as { name: string }).name, "0041_live_data_observations");
    const schema = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='live_data_observations'").get() as { sql: string }).sql;
    assert.match(schema, /tool_trace_id TEXT NOT NULL UNIQUE/);
    assert.match(schema, /resource_type TEXT NOT NULL/);
    assert.match(schema, /safe_payload_json TEXT NOT NULL CHECK\(json_valid\(safe_payload_json\)\)/);
    assert.doesNotMatch(schema, /query TEXT/);
    assert.match((database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='live_data_observations_no_update'").get() as { sql: string }).sql, /append-only/);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});

test("EPIC035 gates integration readiness before the provider and normalizes safe outcomes", async () => {
  const context = { workspaceId: 1, workspaceKey: "default" };
  let calls = 0;
  const provider: LiveDataProviderPort = { read: async () => { calls += 1; return { status: "confirmed", summary: "Two appointments remain.", source: "fixture", expiresAt: "2026-08-18T01:00:00.000Z" }; } };
  const unavailable = new LiveDataService(new MemoryObservations(), readiness(false), provider, new Clock());
  assert.equal((await unavailable.read(context, 1, { kind: "observation", query: "availability", toolTraceId: traceId }, new AbortController().signal)).status, "unavailable");
  assert.equal(calls, 0);

  const observations = new MemoryObservations(), service = new LiveDataService(observations, readiness(true), provider, new Clock());
  const confirmed = await service.read(context, 1, { kind: "observation", query: "availability", toolTraceId: traceId }, new AbortController().signal);
  assert.deepEqual(confirmed, { status: "confirmed", summary: "Two appointments remain.", source: "fixture", observedAt: "2026-08-18T00:00:00.000Z", fetchedAt: "2026-08-18T00:00:00.000Z", expiresAt: "2026-08-18T01:00:00.000Z", freshness: "fresh" });
  assert.equal(observations.values.length, 1);

  for (const result of [
    { status: "empty", expiresAt: "2026-08-18T01:00:00.000Z" },
    { status: "not_found", expiresAt: "2026-08-18T01:00:00.000Z" },
    { status: "confirmed", summary: "x".repeat(8_001), source: "fixture", expiresAt: "2026-08-18T01:00:00.000Z" },
    { status: "confirmed", summary: "valid", source: "fixture", expiresAt: "2026-08-20T00:00:00.000Z" },
    { status: "unknown", expiresAt: "2026-08-18T01:00:00.000Z" } as unknown as LiveDataProviderOutcome,
  ] as LiveDataProviderOutcome[]) {
    const outcome = await new LiveDataService(new MemoryObservations(), readiness(true), { read: async () => result }, new Clock()).read(context, 1, { kind: "observation", query: "availability", toolTraceId: traceId }, new AbortController().signal);
    assert.equal(outcome.status, result.status === "empty" || result.status === "not_found" ? result.status : "unavailable");
    assert.equal(outcome.observedAt, "2026-08-18T00:00:00.000Z");
    assert.equal(outcome.fetchedAt, "2026-08-18T00:00:00.000Z");
  }
  const expired = await new LiveDataService(new MemoryObservations(), readiness(true), { read: async () => ({ status: "confirmed", summary: "Expired", source: "fixture", expiresAt: "2026-08-17T23:59:59.000Z" }) }, new Clock()).read(context, 1, { kind: "observation", query: "availability", toolTraceId: traceId }, new AbortController().signal);
  assert.deepEqual(expired, { status: "unavailable", summary: null, source: null, observedAt: "2026-08-18T00:00:00.000Z", fetchedAt: "2026-08-18T00:00:00.000Z", expiresAt: "2026-08-17T23:59:59.000Z", freshness: "expired" });
  assert.equal((await new LiveDataService(new MemoryObservations(), readiness(true), { read: async () => { throw new Error("provider failed"); } }, new Clock()).read(context, 1, { kind: "observation", query: "availability", toolTraceId: traceId }, new AbortController().signal)).status, "unavailable");
  assert.equal((await new LiveDataService(new MemoryObservations(), readiness(true), { read: async () => new Promise<LiveDataProviderOutcome>(() => undefined) }, new Clock(), 1).read(context, 1, { kind: "observation", query: "availability", toolTraceId: traceId }, new AbortController().signal)).status, "unavailable");
});

test("EPIC035 fake is provider-neutral and the code-owned tool exposes safe metadata", async () => {
  const fake = new FakeLiveDataProvider();
  fake.setResult("observation", "hours", { status: "empty", expiresAt: "2026-08-18T01:00:00.000Z" });
  assert.equal((await fake.read({ workspaceId: 1 }, 1, { kind: "observation", query: "hours" }, new AbortController().signal)).status, "empty");
  const definition = liveDataReadToolDefinition(new LiveDataService(new MemoryObservations(), readiness(true), fake, new Clock()));
  const registered = new ToolRegistry(productionAssistantCapabilityCatalog, [definition]).list()[0];
  assert.equal(registered?.requiredCapabilities[0], productionAssistantCapabilityCatalog.require("live_data.read"));
  assert.deepEqual(registered?.integration, { provider: "live_data", kind: "observation" });
  assert.deepEqual(registered?.liveData, { provider: "live_data", kind: "observation" });
  assert.equal(registered?.conversationMemoryPolicy?.maximumBytes, 1_024);
  assert.deepEqual(registered?.conversationMemoryPolicy?.projectResult({ status: "confirmed", summary: "Available", source: "fixture", observedAt: "2026-08-18T00:00:00.000Z", fetchedAt: "2026-08-18T00:00:00.000Z", expiresAt: "2026-08-18T01:00:00.000Z", freshness: "fresh" }), { summary: "Available", provenance: { source: "fixture", observedAt: "2026-08-18T00:00:00.000Z", fetchedAt: "2026-08-18T00:00:00.000Z", expiresAt: "2026-08-18T01:00:00.000Z" } });
  assert.equal(registered?.conversationMemoryPolicy?.projectResult({ status: "confirmed", summary: "Expired", source: "fixture", observedAt: "2026-08-18T00:00:00.000Z", fetchedAt: "2026-08-18T00:00:00.000Z", expiresAt: "2026-08-17T23:59:59.000Z", freshness: "expired" }), null);
  const policy = new LiveDataToolAvailabilityPolicy({ isAvailable: async () => true }, readiness(true));
  assert.equal(await policy.isAvailable(definition, { workspaceId: 1, companyId: 1, assistantProfileId: "asp_test" }), true);
});

test("EPIC035 persists one confirmed observation per requested tool trace and updates its reference", async () => {
  const database = createDatabase(":memory:"), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), company = new CompanyRepository(database).create(context, { name: "Live Data", website: "https://live-data.test" });
  try {
    database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("asp_test", company.id, "Test", "test", "friendly", "en", "fallback", "draft", "2026-08-18T00:00:00.000Z", "2026-08-18T00:00:00.000Z");
    database.prepare("INSERT INTO company_knowledge_versions(id,company_id,version_number,compiler_version,knowledge_json,snapshot_digest,published_by_actor_id,published_at) VALUES(?,?,?,?,?,?,?,?)").run("kver_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", company.id, 1, "company-knowledge-compiler-v1", "{}", "a".repeat(64), "test", "2026-08-18T00:00:00.000Z");
    database.prepare("INSERT INTO company_knowledge_publications(company_id,knowledge_version_id,publication_version,published_by_actor_id,published_at) VALUES(?,?,?,?,?)").run(company.id, "kver_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1, "test", "2026-08-18T00:00:00.000Z");
    database.prepare("INSERT INTO assistant_execution_records(id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,provider,purpose,state,fallback_used,started_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("aex_test", company.id, "asp_test", "{}", "kver_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "test", "preview", "started", 0, "2026-08-18T00:00:00.000Z");
    const traces = new ToolExecutionService({ createRequested: async (value) => { database.prepare("INSERT INTO tool_execution_traces(id,assistant_execution_record_id,workspace_id,company_id,assistant_profile_id,model_tool_call_id,tool_name,state,audit_input_json,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(value.id, value.assistantExecutionRecordId, value.workspaceId, value.companyId, value.assistantProfileId, value.modelToolCallId, value.toolName, "requested", null, value.requestedAt); return value; }, complete: async (id, _state, value) => database.prepare("UPDATE tool_execution_traces SET state='completed',output_reference=?,completed_at=?,duration_milliseconds=? WHERE id=? AND state='requested'").run(value.outputReference ?? null, value.completedAt, value.durationMilliseconds, id).changes === 1, fail: async () => true }, new Clock());
    const provider = new FakeLiveDataProvider(); provider.setResult("observation", "availability", { status: "confirmed", summary: "Available", source: "fixture", expiresAt: "2026-08-18T01:00:00.000Z" });
    const definition = liveDataReadToolDefinition(new LiveDataService(new LiveDataObservationRepository(new LocalSqlDatabase(database)), readiness(true), provider, new Clock()));
    const outcome = await traces.executeOutcome(definition, { workspaceId: context.workspaceId, companyId: company.id, assistantProfileId: "asp_test", assistantExecutionRecordId: "aex_test", conversationId: null, channel: "internal", invocationId: "call_1", idempotencyKey: null, confirmation: null }, { query: "availability" });
    assert.equal((outcome.output as { status: string }).status, "confirmed");
    const row = database.prepare("SELECT tool_trace_id,resource_type,provider,outcome,fetched_at,freshness,safe_payload_json FROM live_data_observations WHERE id=(SELECT output_reference FROM tool_execution_traces WHERE id=?)").get(outcome.traceId) as { tool_trace_id: string; resource_type: string; provider: string; outcome: string; fetched_at: string; freshness: string; safe_payload_json: string };
    assert.equal(row.tool_trace_id, outcome.traceId);
    assert.deepEqual({ ...row }, { tool_trace_id: outcome.traceId, resource_type: "observation", provider: "live_data", outcome: "confirmed", fetched_at: "2026-08-18T00:00:00.000Z", freshness: "fresh", safe_payload_json: "{\"summary\":\"Available\",\"source\":\"fixture\"}" });
    assert.throws(() => database.prepare("INSERT INTO live_data_observations(id,tool_trace_id,workspace_id,company_id,resource_type,provider,outcome,observed_at,fetched_at,expires_at,freshness,safe_payload_json) SELECT ?,tool_trace_id,workspace_id,company_id,resource_type,provider,outcome,observed_at,fetched_at,expires_at,freshness,safe_payload_json FROM live_data_observations").run("ldo_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
  } finally { database.close(); }
});
