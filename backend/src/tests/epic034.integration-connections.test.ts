import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { ToolRegistry } from "../assistant/application/toolRegistry.js";
import { AssistantCapabilityCatalog, assistantCapabilityKey } from "../assistant/domain/assistantCapability.js";
import { NoIntegrationToolAvailabilityPolicy } from "../assistant/application/toolContracts.js";
import type { ToolDefinition } from "../assistant/domain/tool.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { IntegrationConnectionRepository } from "../repositories/integrationConnectionRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { AesGcmIntegrationSecretCipher } from "../integrations/infrastructure/aesGcmIntegrationSecretCipher.js";
import { IntegrationConnectionConflictError, IntegrationConnectionService } from "../integrations/services/integrationConnectionService.js";
import { IntegrationToolAvailabilityPolicy } from "../integrations/services/integrationToolAvailabilityPolicy.js";
import { AssistantToolOrchestrator } from "../assistant/services/assistantToolOrchestrator.js";
import { ToolExecutionError, ToolExecutionService } from "../assistant/services/toolExecutionService.js";
import type { AssistantModelPort } from "../assistant/application/toolContracts.js";

class Clock { private tick = 0; public now(): string { return new Date(Date.UTC(2026, 7, 18, 0, 0, this.tick++)).toISOString(); } }

test("EPIC034 migrates normalized generic connections, secrets, state, and append-only audit", () => {
  const database = createDatabase(":memory:");
  try {
    assert.equal((database.prepare("SELECT name FROM schema_migrations WHERE id=40").get() as { name: string }).name, "0040_integration_connections_core");
    assert.match((database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='integration_connection_audit_no_update'").get() as { sql: string }).sql, /append-only/);
    assert.match((database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='integration_connections'").get() as { sql: string }).sql, /json_valid/);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});

test("EPIC034 lifecycle encrypts secrets, validates before activation, and uses version CAS", async () => {
  const database = createDatabase(":memory:"), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), company = new CompanyRepository(database).create(context, { name: "Integration Test", website: "https://integration.test" }), repository = new IntegrationConnectionRepository(new LocalSqlDatabase(database)), clock = new Clock();
  try {
    const service = new IntegrationConnectionService(repository, new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 7)), { validate: async () => ({ status: "valid" }) }, clock);
    const connection = await service.create(context, company.id, { provider: "crm.example", kind: "contacts" });
    await assert.rejects(() => service.activate(context, company.id, connection.id), IntegrationConnectionConflictError);
    const configured = await service.configureSecret(context, company.id, connection.id, "secret-value");
    assert.notEqual(await repository.findSecret(context, company.id, connection.id), "secret-value");
    const validated = await service.validate(context, company.id, connection.id), active = await service.activate(context, company.id, connection.id);
    assert.equal(configured.status, "inactive"); assert.equal(validated.version, 3); assert.equal(active.status, "active"); assert.equal(await repository.isReadyForTool(context, company.id, "crm.example", "contacts"), true);
    assert.deepEqual(database.prepare("SELECT event_type FROM integration_connection_audit_events ORDER BY occurred_at,id").all().map((row) => (row as { event_type: string }).event_type), ["created", "secret_configured", "validated", "activated"]);
    const payloads = database.prepare("SELECT payload_json FROM integration_connection_audit_events").all() as Array<{ payload_json: string }>;
    assert.ok(payloads.every(({ payload_json }) => { const payload = JSON.parse(payload_json) as Record<string, unknown>; return !payload_json.includes("secret-value") && !("configuration" in payload) && typeof payload.provider === "string"; }));
    assert.equal(await repository.compareAndSet(context, company.id, connection.id, 1, active, (await repository.findState(context, company.id, connection.id))!, "deactivated"), null);
  } finally { database.close(); }
});

test("EPIC034 secret rotation atomically revokes readiness and invalid validation deactivates", async () => {
  const database = createDatabase(":memory:"), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), company = new CompanyRepository(database).create(context, { name: "Rotation Test", website: "https://rotation.test" }), repository = new IntegrationConnectionRepository(new LocalSqlDatabase(database)), clock = new Clock();
  try {
    let validation: "valid" | "invalid" = "valid";
    const service = new IntegrationConnectionService(repository, new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 8)), { validate: async () => validation === "valid" ? { status: "valid" as const } : { status: "invalid" as const, failureCode: "credentials_invalid" as const } }, clock);
    const connection = await service.create(context, company.id, { provider: "crm.example", kind: "contacts" });
    await service.configureSecret(context, company.id, connection.id, "first-secret");
    await service.validate(context, company.id, connection.id);
    await service.activate(context, company.id, connection.id);
    const reconfigured = await service.configure(context, company.id, connection.id, 4, { endpoint: "https://crm.example/v2" });
    assert.equal(reconfigured.status, "inactive");
    assert.equal((await repository.findState(context, company.id, connection.id))?.validationState, "not_validated");
    assert.equal(await repository.isReadyForTool(context, company.id, "crm.example", "contacts"), false);
    await assert.rejects(() => service.configure(context, company.id, connection.id, 4, { endpoint: "https://crm.example/v3" }), IntegrationConnectionConflictError);
    await assert.rejects(() => service.configure(context, company.id, connection.id, 5, { nested: { apiToken: "nope" } }), /configuration/);
    validation = "invalid";
    const invalid = await service.validate(context, company.id, connection.id);
    assert.equal(invalid.status, "inactive");
    assert.equal((await repository.findState(context, company.id, connection.id))?.validationState, "invalid");
  } finally { database.close(); }
});

test("EPIC034 audit events cannot be assigned to another company", async () => {
  const database = createDatabase(":memory:"), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), companies = new CompanyRepository(database), company = companies.create(context, { name: "Audit Owner", website: "https://audit-owner.test" }), other = companies.create(context, { name: "Other Owner", website: "https://other-owner.test" }), repository = new IntegrationConnectionRepository(new LocalSqlDatabase(database)), clock = new Clock();
  try {
    const connection = await new IntegrationConnectionService(repository, new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 9)), { validate: async () => ({ status: "valid" }) }, clock).create(context, company.id, { provider: "crm.example", kind: "contacts" });
    assert.throws(() => database.prepare("INSERT INTO integration_connection_audit_events(id,workspace_id,company_id,integration_connection_id,event_type,payload_json,version,occurred_at) VALUES(?,?,?,?,?,?,?,?)").run("ica_cross_scope", context.workspaceId, other.id, connection.id, "created", "{}", 1, clock.now()));
    assert.throws(() => database.prepare("UPDATE integration_connection_audit_events SET event_type='activated'").run());
    assert.throws(() => database.prepare("DELETE FROM integration_connection_audit_events").run());
  } finally { database.close(); }
});

test("EPIC034 scopes reads and writes to the workspace and rejects duplicate connections", async () => {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), first = createWorkspaceContext(workspaces.resolveDefault()), second = createWorkspaceContext(workspaces.createForSystemUse({ key: "second", name: "Second" })), companies = new CompanyRepository(database), company = companies.create(first, { name: "Scoped", website: "https://scoped.test" }), repository = new IntegrationConnectionRepository(new LocalSqlDatabase(database)), service = new IntegrationConnectionService(repository, new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 4)), { validate: async () => ({ status: "valid" as const }) }, new Clock());
  try {
    const connection = await service.create(first, company.id, { provider: "crm.example", kind: "contacts" });
    assert.equal(await repository.findById(second, company.id, connection.id), null);
    await assert.rejects(() => service.configure(second, company.id, connection.id, 1, { endpoint: "https://crm.example" }), /not found/i);
    await assert.rejects(() => service.create(first, company.id, { provider: "crm.example", kind: "contacts" }), IntegrationConnectionConflictError);
  } finally { database.close(); }
});

test("EPIC034 tool availability composes existing policy and never needs a secret", async () => {
  const policy = new IntegrationToolAvailabilityPolicy(new NoIntegrationToolAvailabilityPolicy(), { isReadyForTool: async (_context, _company, provider, kind) => provider === "crm.example" && kind === "contacts" });
  const capability = assistantCapabilityKey("test.integration"), definition: ToolDefinition = { name: "test.integration", description: "Integration read.", inputSchema: { type: "object", maxProperties: 1, properties: {} }, outputSchema: { type: "object", maxProperties: 1, properties: {} }, requiredCapabilities: [capability], operationClass: "read", timeoutMilliseconds: 10, idempotencyPolicy: "not_applicable", confirmationPolicy: "none", auditPolicy: {}, integration: { provider: "crm.example", kind: "contacts" }, executor: async () => ({}) };
  assert.equal(new ToolRegistry(new AssistantCapabilityCatalog([{ key: capability, kind: "tool" }]), [definition]).list().length, 1);
  assert.equal(await policy.isAvailable(definition, { workspaceId: 1, companyId: 1, assistantProfileId: "asp_test" }), true);
  assert.equal(await policy.isAvailable({ ...definition, integration: { provider: "crm.example", kind: "missing" } }, { workspaceId: 1, companyId: 1, assistantProfileId: "asp_test" }), false);
});

test("EPIC034 orchestrator denies missing capabilities and rechecks integration readiness before execution", async () => {
  const capability = assistantCapabilityKey("test.integration"), definition: ToolDefinition = { name: "test.integration", description: "Integration read.", inputSchema: { type: "object", maxProperties: 1, required: ["value"], properties: { value: { type: "string", maxLength: 10 } } }, outputSchema: { type: "object", maxProperties: 1, required: ["ok"], properties: { ok: { type: "boolean" } } }, requiredCapabilities: [capability], operationClass: "read", timeoutMilliseconds: 10, idempotencyPolicy: "not_applicable", confirmationPolicy: "none", auditPolicy: {}, integration: { provider: "crm.example", kind: "contacts" }, executor: async () => { calls++; return { ok: true }; } };
  let calls = 0, availabilityReads = 0;
  const model: AssistantModelPort = { createSession: () => ({ start: async () => ({ kind: "tool_calls", toolCalls: [{ id: "call", toolName: "test.integration", input: { value: "ready" } }] }), continue: async () => ({ kind: "final", text: "done" }) }) };
  const traces = { createRequested: async (value: { id: string; assistantExecutionRecordId: string; modelToolCallId: string; toolName: string }) => ({ ...value, state: "requested" as const }), complete: async () => true, fail: async () => true };
  const context = { workspaceId: 1, companyId: 1, assistantProfileId: "asp_test", assistantExecutionRecordId: "aex_test", conversationId: null, channel: "internal" as const, invocationId: "", idempotencyKey: null, confirmation: null };
  const registry = new ToolRegistry(new AssistantCapabilityCatalog([{ key: capability, kind: "tool" }]), [definition]);
  const unavailable = new AssistantToolOrchestrator(model, registry, { listForProfile: async () => [], existsForProfile: async () => true, replaceForProfile: async () => true }, new IntegrationToolAvailabilityPolicy(new NoIntegrationToolAvailabilityPolicy(), { isReadyForTool: async () => true }), new ToolExecutionService(traces, new Clock()), new Clock());
  await assert.rejects(() => unavailable.run("prompt", context), ToolExecutionError); assert.equal(calls, 0);
  const changing = new AssistantToolOrchestrator(model, registry, { listForProfile: async () => [capability], existsForProfile: async () => true, replaceForProfile: async () => true }, new IntegrationToolAvailabilityPolicy(new NoIntegrationToolAvailabilityPolicy(), { isReadyForTool: async () => ++availabilityReads === 1 }), new ToolExecutionService(traces, new Clock()), new Clock());
  await assert.rejects(() => changing.run("prompt", context), ToolExecutionError); assert.equal(availabilityReads, 2); assert.equal(calls, 0);
});
