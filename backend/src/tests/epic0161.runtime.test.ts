import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import type { AssistantExecutionPort } from "../assistant/application/assistantExecutionPort.js";
import { AnswerGenerationUnavailableError, type AssistantExecutionRequest, type AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import { assistantProfileId, reconstructAssistantProfile, type AssistantProfile } from "../assistant/domain/assistantProfile.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { AssistantExecutionRecordRepository } from "../repositories/assistantExecutionRecordRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";

class Clock { public value = "2026-07-23T12:00:00.000Z"; public now(): string { return this.value; } }
class Execution implements AssistantExecutionPort {
  public request: AssistantExecutionRequest | null = null;
  public result: AssistantExecutionResult = { outcome: "answered", answer: "Grounded answer" };
  public failure: Error | null = null;
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> { this.request = request; if (this.failure) throw this.failure; return this.result; }
}

function profile(): AssistantProfile {
  return reconstructAssistantProfile({ id: assistantProfileId("asp_0123456789abcdef0123456789abcdef"), companyId: 1, name: "Sales", normalizedName: "sales", description: "Not executed", businessRole: "Sales advisor", objective: "Qualify inquiries", audience: "Prospects", tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Approved fallback", status: "ready", createdAt: "2026-07-23T12:00:00.000Z", updatedAt: "2026-07-23T12:00:00.000Z", archivedAt: null });
}

function setup() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database);
  const context = { workspaceId: workspaces.resolveDefault().id, workspaceKey: "default" };
  const companies = new CompanyRepository(database), company = companies.create(context, { name: "Example", website: "https://example.test", status: "ready" });
  publishKnowledgeFixture(database, context, company.id, { company: { name: company.name, website: company.website, phone: "", email: "" }, business: { services: ["Sales"], hours: "Always", locations: [] }, faq: [] });
  const profiles = new AssistantProfileRepository(database), ready = { ...profile(), companyId: company.id } as AssistantProfile;
  profiles.create(context, company.id, ready);
  const knowledge = new CompanyKnowledgeRepository(database).loadCurrentVersion(context, company.id);
  if (!knowledge) throw new Error("Published knowledge fixture is unavailable.");
  const clock = new Clock(), execution = new Execution(), records = new AssistantExecutionRecordRepository(database);
  return { database, company, profile: ready, knowledge, clock, execution, records };
}

test("runtime persists an immutable minimal Profile snapshot and a published Knowledge reference", async () => {
  const { database, company, profile: ready, knowledge, clock, execution, records } = setup();
  const runtime = new OperationalAssistantRuntime(execution, records, clock);
  clock.value = "2026-07-23T12:00:01.000Z";
  const result = await runtime.execute(company, ready, knowledge, "Can you help?", [], { purpose: "preview", provider: "test", fallbackOnUnavailable: false });
  const stored = records.findById(result.record.id);
  assert.deepEqual(result.response, { outcome: "answered", answer: "Grounded answer" });
  assert.ok(stored); assert.equal(stored.state, "answered"); assert.equal(stored.provider, "test");
  assert.equal(stored.knowledgeSnapshot.versionId, knowledge.id); assert.equal(stored.knowledgeSnapshot.snapshotDigest, knowledge.snapshotDigest);
  assert.equal(stored.executionSnapshot?.workspaceId, company.workspaceId);
  assert.equal(stored.executionSnapshot?.assistantProfileId, ready.id);
  assert.equal(stored.executionSnapshot?.knowledgeVersionId, knowledge.id);
  assert.equal(stored.executionSnapshot?.providerModel, "test");
  assert.match(stored.executionSnapshot?.configurationDigest ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(stored.profileSnapshot).sort(), ["assistantLanguage", "audience", "businessRole", "fallbackMessage", "objective", "profileId", "tone"]);
  assert.equal(stored.profileSnapshot.objective, "Qualify inquiries"); assert.equal("name" in stored.profileSnapshot, false);
  const row = database.prepare("SELECT * FROM assistant_execution_records WHERE id=?").get(result.record.id) as Record<string, unknown>;
  assert.equal(Object.values(row).includes("Can you help?"), false); assert.equal("prompt" in row, false);
  database.close();
});

test("later Profile mutations do not change the persisted execution snapshot", async () => {
  const { database, company, profile: ready, knowledge, clock, execution, records } = setup();
  const runtime = new OperationalAssistantRuntime(execution, records, clock);
  const first = await runtime.execute(company, ready, knowledge, "Question", [], { purpose: "operational_execution", provider: "test", fallbackOnUnavailable: true });
  const changed = { ...ready, objective: "A later objective", fallbackMessage: "Later fallback" } as AssistantProfile;
  assert.equal(records.findById(first.record.id)?.profileSnapshot.objective, "Qualify inquiries");
  const second = await runtime.execute(company, changed, knowledge, "Question", [], { purpose: "operational_execution", provider: "test", fallbackOnUnavailable: true });
  assert.equal(records.findById(second.record.id)?.profileSnapshot.objective, "A later objective");
  database.close();
});

test("runtime records approved fallback and provider failures without persisting a result for failures", async () => {
  const { database, company, profile: ready, knowledge, clock, execution, records } = setup();
  const runtime = new OperationalAssistantRuntime(execution, records, clock);
  execution.result = { outcome: "safe_fallback", answer: "Provider fallback" };
  const fallback = await runtime.execute(company, ready, knowledge, "Question", [], { purpose: "operational_execution", provider: "test", fallbackOnUnavailable: true });
  assert.deepEqual(fallback.response, { outcome: "safe_fallback", answer: "Approved fallback" });
  assert.equal(records.findById(fallback.record.id)?.fallbackUsed, true);
  execution.failure = new AnswerGenerationUnavailableError();
  await assert.rejects(() => runtime.execute(company, ready, knowledge, "Question", [], { purpose: "preview", provider: "test", fallbackOnUnavailable: false }), AnswerGenerationUnavailableError);
  const failed = database.prepare("SELECT state,result,error_code FROM assistant_execution_records WHERE state='failed'").get() as { state: string; result: string | null; error_code: string };
  assert.equal(failed.state, "failed"); assert.equal(failed.result, null); assert.equal(failed.error_code, "provider_unavailable");
  database.close();
});
