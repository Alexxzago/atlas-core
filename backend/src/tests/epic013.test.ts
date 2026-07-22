import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import { AnswerGenerationUnavailableError, buildAssistantExecution, freezeAssistantExecution } from "../assistant/application/assistantExecution.js";
import type { AssistantExecutionPort } from "../assistant/application/assistantExecutionPort.js";
import { InMemoryOperationalExecutionBudget } from "../assistant/application/operationalExecutionBudget.js";
import type { AssistantProfileRepositoryPort } from "../assistant/application/ports.js";
import { OperationalAssistantExecutionService, OperationalAssistantCompanyNotReadyError, OperationalAssistantExecutionNotFoundError, OperationalAssistantExecutionRateLimitedError, OperationalAssistantExecutionValidationError, OperationalAssistantKnowledgeUnavailableError, OperationalAssistantProfileNotExecutableError } from "../assistant/services/operationalAssistantExecutionService.js";
import type { AssistantProfile } from "../assistant/domain/assistantProfile.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

const context: WorkspaceContext = { workspaceId: 1, workspaceKey: "one" };
const knowledge = { company: { name: "Company", website: "https://company.test", phone: "", email: "" }, business: { services: ["Sales"], hours: "Always", locations: [] }, faq: [] };
const profile = { id: "asp_0123456789abcdef0123456789abcdef", companyId: 1, name: "Profile", normalizedName: "profile", description: null, businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Approved fallback", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null } as unknown as AssistantProfile;
class Execution implements AssistantExecutionPort { public calls = 0; public request: AssistantExecutionRequest | null = null; public result: unknown = { outcome: "answered", answer: "Answer" }; public error: Error | null = null; public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> { this.calls++; this.request = request; if (this.error) throw this.error; return this.result as AssistantExecutionResult; } }
const companies: CompanyRepositoryPort = { findById: () => ({ id: 1, workspaceId: 1, name: "Company", website: "https://company.test", phone: "", email: "", status: "ready", createdAt: "2026-01-01T00:00:00.000Z" }), findByWebsite: () => null, list: () => [], create: () => { throw new Error(); }, update: () => null, delete: () => false, updateStatus: () => null };
const profiles: AssistantProfileRepositoryPort = { listActive: () => ({ status: "found", profiles: [] }), findById: () => profile, create: () => { throw new Error(); }, update: () => { throw new Error(); } };
const published: KnowledgeRepositoryPort = { load: () => knowledge };

test("operational execution uses the immutable published request and normalizes provider fallback", async () => {
  const execution = new Execution(); const service = new OperationalAssistantExecutionService(companies, published, profiles, execution, new InMemoryOperationalExecutionBudget());
  const response = await service.execute(context, 1, { assistantProfileId: profile.id, message: " Question " });
  assert.deepEqual(response, { outcome: "answered", answer: "Answer" });
  execution.result = { outcome: "safe_fallback", answer: "provider text" };
  assert.deepEqual(await service.execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), { outcome: "safe_fallback", answer: "Approved fallback" });
  execution.result = { outcome: "answered", answer: "" };
  assert.deepEqual(await service.execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), { outcome: "safe_fallback", answer: "Approved fallback" });
  execution.error = new AnswerGenerationUnavailableError();
  assert.deepEqual(await service.execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), { outcome: "safe_fallback", answer: "Approved fallback" });
  const frozen = freezeAssistantExecution({ purpose: "operational_execution", behavior: { businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", fallbackMessage: "Approved fallback" }, knowledge, message: "Question" });
  assert.equal(Object.isFrozen(frozen), true); assert.equal(frozen.purpose, "operational_execution");
  const built = buildAssistantExecution(profile, { purpose: "preview", knowledge, message: "Question" });
  assert.deepEqual(built.behavior, { businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", fallbackMessage: "Approved fallback" });
  assert.equal(Object.isFrozen(built), true);
});

test("operational execution budget limits concurrent trusted Workspace execution", async () => {
  const budget = new InMemoryOperationalExecutionBudget(); const first = budget.acquire(context); assert.ok(first); assert.equal(budget.acquire(context), null); first.release();
  for (let accepted = 0; accepted < 9; accepted++) { const lease = budget.acquire(context); assert.ok(lease); lease.release(); }
  assert.equal(budget.acquire(context), null); assert.ok(budget.acquire({ workspaceId: 2, workspaceKey: "two" }));
  const service = new OperationalAssistantExecutionService(companies, published, profiles, new Execution(), { acquire: () => null });
  await assert.rejects(() => service.execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), OperationalAssistantExecutionRateLimitedError);
});

test("operational execution stops before the port for missing scope or publication and releases failed leases", async () => {
  const execution = new Execution();
  await assert.rejects(() => new OperationalAssistantExecutionService({ ...companies, findById: () => null }, published, profiles, execution, new InMemoryOperationalExecutionBudget()).execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), OperationalAssistantExecutionNotFoundError);
  await assert.rejects(() => new OperationalAssistantExecutionService(companies, published, { ...profiles, findById: () => null }, execution, new InMemoryOperationalExecutionBudget()).execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), OperationalAssistantExecutionNotFoundError);
  await assert.rejects(() => new OperationalAssistantExecutionService(companies, { load: () => null }, profiles, execution, new InMemoryOperationalExecutionBudget()).execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), OperationalAssistantKnowledgeUnavailableError);
  assert.equal(execution.calls, 0);
  const budget = new InMemoryOperationalExecutionBudget(); execution.error = new Error("unexpected");
  const service = new OperationalAssistantExecutionService(companies, published, profiles, execution, budget);
  await assert.rejects(() => service.execute(context, 1, { assistantProfileId: profile.id, message: "Question" }));
  assert.ok(budget.acquire(context));
});

test("operational execution validates the exact DTO and rejects non-executable Profiles before Knowledge", async () => {
  const execution = new Execution();
  const service = new OperationalAssistantExecutionService(companies, published, profiles, execution, new InMemoryOperationalExecutionBudget());
  for (const input of [{ message: "Question" }, { assistantProfileId: profile.id, message: "Question", extra: true }, { assistantProfileId: "invalid", message: "Question" }, { assistantProfileId: profile.id, message: "😀".repeat(2_001) }]) {
    await assert.rejects(() => service.execute(context, 1, input), OperationalAssistantExecutionValidationError);
  }
  await assert.rejects(() => new OperationalAssistantExecutionService(companies, published, { ...profiles, findById: () => ({ ...profile, status: "draft" }) }, execution, new InMemoryOperationalExecutionBudget()).execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), OperationalAssistantProfileNotExecutableError);
  assert.equal(execution.calls, 0);
});

test("operational execution keeps unpublished Knowledge and ineligible requests away from the port and budget", async () => {
  const execution = new Execution(), unpublished = { ...knowledge, company: { ...knowledge.company, name: "Unpublished" } };
  let publication: typeof knowledge | null = null, knowledgeLoads = 0, budgetAcquires = 0;
  const publishedOnly: KnowledgeRepositoryPort = { load: () => { knowledgeLoads++; return publication; } };
  const budget = { acquire: () => { budgetAcquires++; return { release: () => undefined }; } };
  const input = { assistantProfileId: profile.id, message: "Question" };
  const execute = (companyPort = companies, profilePort = profiles) => new OperationalAssistantExecutionService(companyPort, publishedOnly, profilePort, execution, budget).execute(context, 1, input);
  await assert.rejects(() => execute({ ...companies, findById: () => null }), OperationalAssistantExecutionNotFoundError);
  await assert.rejects(() => execute(companies, { ...profiles, findById: () => ({ ...profile, status: "draft" }) }), OperationalAssistantProfileNotExecutableError);
  await assert.rejects(() => execute({ ...companies, findById: () => ({ ...companies.findById(context, 1)!, status: "processing" }) }), OperationalAssistantCompanyNotReadyError);
  assert.equal(knowledgeLoads, 0); assert.equal(budgetAcquires, 0); assert.equal(execution.calls, 0);
  await assert.rejects(() => execute(), OperationalAssistantKnowledgeUnavailableError);
  assert.equal(budgetAcquires, 0); assert.equal(execution.calls, 0);
  publication = knowledge;
  await execute();
  assert.equal(execution.calls, 1); assert.deepEqual(execution.request!.knowledge, knowledge); assert.notDeepEqual(execution.request!.knowledge, unpublished);
});

test("operational execution does not invoke its port when the trusted Workspace budget is exhausted", async () => {
  const execution = new Execution();
  const service = new OperationalAssistantExecutionService(companies, published, profiles, execution, { acquire: () => null });
  await assert.rejects(() => service.execute(context, 1, { assistantProfileId: profile.id, message: "Question" }), OperationalAssistantExecutionRateLimitedError);
  assert.equal(execution.calls, 0);
});
