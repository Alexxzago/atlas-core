import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantExecutionPort } from "../assistant/application/assistantExecutionPort.js";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import { assistantProfileId, reconstructAssistantProfile, type AssistantProfile } from "../assistant/domain/assistantProfile.js";
import { assistantExecutionRecordId } from "../assistant/domain/operationalAssistantRuntime.js";
import { InMemoryConversationTurnLock, OperationalConversationTurnInProgressError, OperationalConversationTurnKnowledgeUnavailableError, OperationalConversationTurnNotFoundError, OperationalConversationTurnProfileNotExecutableError, OperationalConversationTurnService } from "../assistant/services/operationalConversationTurnService.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { createDatabase } from "../config/database.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { reconstructConversationControl } from "../conversation/domain/conversationControl.js";
import { AssistantExecutionRecordRepository } from "../repositories/assistantExecutionRecordRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";

class Clock { private index = 0; public now(): string { return new Date(Date.UTC(2026, 6, 23, 12, 0, this.index++)).toISOString(); } }
class Execution implements AssistantExecutionPort {
  public request: AssistantExecutionRequest | null = null;
  public result: AssistantExecutionResult = { outcome: "answered", answer: "Grounded answer" };
  public error: Error | null = null;
  public wait: Promise<void> | null = null;
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> { this.request = request; if (this.wait) await this.wait; if (this.error) throw this.error; return this.result; }
}

function profile(companyId: number): AssistantProfile {
  return reconstructAssistantProfile({ id: assistantProfileId("asp_0123456789abcdef0123456789abcdef"), companyId, name: "Sales", normalizedName: "sales", description: null, businessRole: "Sales advisor", objective: "Help prospects", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Approved fallback", status: "ready", createdAt: "2026-07-23T12:00:00.000Z", updatedAt: "2026-07-23T12:00:00.000Z", archivedAt: null });
}

async function setup(published = true) {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), primary = createWorkspaceContext(await workspaces.resolveDefault()), secondary = createWorkspaceContext(await workspaces.createForSystemUse({ key: "secondary", name: "Secondary" }));
  const companies = new CompanyRepository(database), company = await companies.create(primary, { name: "Example", website: "https://example.test", status: "ready" }), other = await companies.create(secondary, { name: "Other", website: "https://other.test", status: "ready" });
  if (published) await publishKnowledgeFixture(database, primary, company.id, { company: { name: company.name, website: company.website, phone: "", email: "" }, business: { services: ["Sales"], hours: "Always", locations: [] }, faq: [] });
  const clock = new Clock(), conversationRepository = new ConversationRepository(database), conversationService = new ConversationService(conversationRepository, clock), conversation = await conversationService.open(primary, company.id);
  const inbound = await conversationService.addParticipant(primary, company.id, conversation.id, { type: "opaque-customer" });
  const outbound = await conversationService.addParticipant(primary, company.id, conversation.id, { type: "opaque-responder" });
  const profiles = new AssistantProfileRepository(database), ready = profile(company.id); await profiles.create(primary, company.id, ready);
  const execution = new Execution(), records = new AssistantExecutionRecordRepository(database), runtime = new OperationalAssistantRuntime(execution, records, clock);
  const service = new OperationalConversationTurnService(companies, new CompanyKnowledgeRepository(database), profiles, conversationService, runtime, new InMemoryConversationTurnLock(), "test", 2, undefined, undefined, undefined, undefined, conversationRepository);
  const input = (content = "Question") => ({ assistantProfileId: ready.id, inboundParticipantId: inbound.id, outboundParticipantId: outbound.id, content });
  return { database, primary, secondary, company, other, clock, conversationRepository, conversationService, conversation, inbound, outbound, execution, records, service, input };
}

test("EPIC-016.3 persists inbound, bounded chronological history, execution record, and linked outbound", async () => {
  const { database, primary, company, conversationService, conversation, inbound, execution, records, service, input } = await setup();
  try {
    await conversationService.addMessage(primary, company.id, conversation.id, { senderParticipantId: inbound.id, direction: "inbound", content: "Older" });
    await conversationService.addMessage(primary, company.id, conversation.id, { senderParticipantId: inbound.id, direction: "inbound", content: "Recent" });
    const result = await service.execute(primary, company.id, conversation.id, input("Current"));
    const messages = await conversationService.listMessages(primary, company.id, conversation.id);
    assert.deepEqual(messages.map((message) => message.content), ["Older", "Recent", "Current", "Grounded answer"]);
    assert.deepEqual(execution.request?.history?.map((entry) => entry.content), ["Recent", "Current"]);
    assert.equal(result.inbound.direction, "inbound"); assert.equal(result.outbound.direction, "outbound");
    assert.equal(result.outbound.executionRecordId, result.executionRecordId);
    assert.ok(await records.findById(assistantExecutionRecordId(result.executionRecordId)));
    assert.equal((database.prepare("SELECT assistant_execution_record_id FROM conversation_messages WHERE id=?").get(result.outbound.id) as { assistant_execution_record_id: string }).assistant_execution_record_id, result.executionRecordId);
  } finally { database.close(); }
});

test("EPIC-016.3 persists approved fallback and leaves no outbound on runtime failure", async () => {
  const { database, primary, company, conversationService, conversation, execution, records, service, input } = await setup();
  try {
    execution.result = { outcome: "safe_fallback", answer: "Provider fallback" };
    const fallback = await service.execute(primary, company.id, conversation.id, input());
    assert.equal(fallback.outbound.content, "Approved fallback");
    assert.equal((await records.findById(assistantExecutionRecordId(fallback.executionRecordId)))?.fallbackUsed, true);
    execution.error = new Error("provider failure");
    await assert.rejects(() => service.execute(primary, company.id, conversation.id, input("Fails")), /provider failure/);
    assert.deepEqual((await conversationService.listMessages(primary, company.id, conversation.id)).map((message) => message.content), ["Question", "Approved fallback", "Fails"]);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM assistant_execution_records WHERE state='failed'").get() as { count: number }).count, 1);
  } finally { database.close(); }
});

test("EPIC-016.3 rejects closed, cross-tenant, invalid Profile, and unpublished Knowledge before runtime", async () => {
  const closed = await setup();
  try {
    await closed.conversationService.close(closed.primary, closed.company.id, closed.conversation.id);
    await assert.rejects(() => closed.service.execute(closed.primary, closed.company.id, closed.conversation.id, closed.input()), /closed/);
    await assert.rejects(() => closed.service.execute(closed.secondary, closed.company.id, closed.conversation.id, closed.input()), OperationalConversationTurnNotFoundError);
    await assert.rejects(() => closed.service.execute(closed.primary, closed.other.id, closed.conversation.id, closed.input()), OperationalConversationTurnNotFoundError);
  } finally { closed.database.close(); }
  const invalidProfile = await setup();
  try { await assert.rejects(() => invalidProfile.service.execute(invalidProfile.primary, invalidProfile.company.id, invalidProfile.conversation.id, { ...invalidProfile.input(), assistantProfileId: "asp_ffffffffffffffffffffffffffffffff" }), OperationalConversationTurnNotFoundError); }
  finally { invalidProfile.database.close(); }
  const unpublished = await setup(false);
  try { await assert.rejects(() => unpublished.service.execute(unpublished.primary, unpublished.company.id, unpublished.conversation.id, unpublished.input()), OperationalConversationTurnKnowledgeUnavailableError); assert.equal(unpublished.execution.request, null); }
  finally { unpublished.database.close(); }
});

test("EPIC-016.3 serializes concurrent turns for one conversation in a process", async () => {
  const { database, primary, company, conversation, execution, service, input } = await setup();
  try {
    let release!: () => void; execution.wait = new Promise<void>((resolve) => { release = resolve; });
    const first = service.execute(primary, company.id, conversation.id, input("First"));
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(() => service.execute(primary, company.id, conversation.id, input("Second")), OperationalConversationTurnInProgressError);
    release(); await first;
  } finally { database.close(); }
});

test("EPIC-016.3 persisted human-required inbound messages continue through runtime and finalization", async () => {
  const value = await setup();
  try {
    const authority = (await value.conversationRepository.ensureConversationControl(value.primary, value.company.id, value.conversation.id))!;
    await value.conversationRepository.updateConversationControl(value.primary, value.company.id, reconstructConversationControl({ ...authority, state: "human_required", attentionReason: "automation_failure", version: authority.version + 1, updatedAt: value.clock.now() }), authority.version);
    const first = await value.conversationService.addMessage(value.primary, value.company.id, value.conversation.id, { senderParticipantId: value.inbound.id, direction: "inbound", content: "First" });
    const firstResult = await value.service.executePersistedInbound(value.primary, value.company.id, value.conversation.id, { assistantProfileId: value.input().assistantProfileId, outboundParticipantId: value.outbound.id, replyIdempotencyKey: "human-required-first" }, first);
    const second = await value.conversationService.addMessage(value.primary, value.company.id, value.conversation.id, { senderParticipantId: value.inbound.id, direction: "inbound", content: "Second" });
    const secondResult = await value.service.executePersistedInbound(value.primary, value.company.id, value.conversation.id, { assistantProfileId: value.input().assistantProfileId, outboundParticipantId: value.outbound.id, replyIdempotencyKey: "human-required-second" }, second);
    assert.deepEqual([firstResult.outbound.content, secondResult.outbound.content, value.execution.request?.message], ["Grounded answer", "Grounded answer", "Second"]);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM assistant_execution_records WHERE purpose='operational_execution' AND state='answered'").get() as { count: number }).count, 2);
    assert.equal((await value.conversationRepository.findConversationControl(value.primary, value.company.id, value.conversation.id))?.state, "human_required");
  } finally { value.database.close(); }
});
