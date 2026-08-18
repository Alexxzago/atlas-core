import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantExecution, assistantModelPrompt } from "../assistant/application/assistantExecution.js";
import { ToolRegistry } from "../assistant/application/toolRegistry.js";
import type { AssistantModelPort, AssistantModelRequest, AssistantModelSession, AssistantModelStep, ToolResult } from "../assistant/application/toolContracts.js";
import { AssistantCapabilityCatalog, assistantCapabilityKey } from "../assistant/domain/assistantCapability.js";
import { reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import type { ToolDefinition } from "../assistant/domain/tool.js";
import { AssistantToolOrchestrator } from "../assistant/services/assistantToolOrchestrator.js";
import { InMemoryConversationTurnLock, OperationalConversationTurnNotFoundError, OperationalConversationTurnService } from "../assistant/services/operationalConversationTurnService.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { ToolExecutionService } from "../assistant/services/toolExecutionService.js";
import { createDatabase } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { ConversationIntelligenceService } from "../conversationIntelligence/services/conversationIntelligenceService.js";
import { ConversationToolMemoryCoordinator } from "../conversationIntelligence/services/conversationToolMemoryCoordinator.js";
import { CONVERSATION_FACT_LIMIT, CONVERSATION_PENDING_LIMIT, CONVERSATION_REFERENCE_OPTION_LIMIT, CONVERSATION_TOOL_MEMORY_LIMIT, type ConversationIntelligenceState } from "../conversationIntelligence/domain/conversationIntelligence.js";
import { conversationWorkingMemory, CONVERSATION_WORKING_MEMORY_MAX_BYTES } from "../conversationIntelligence/services/conversationWorkingMemory.js";
import { AssistantCapabilityRepository } from "../repositories/assistantCapabilityRepository.js";
import { AssistantExecutionRecordRepository } from "../repositories/assistantExecutionRecordRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { AssistantToolExecutionTraceRepository } from "../repositories/assistantToolExecutionTraceRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { ConversationIntelligenceRepository } from "../repositories/conversationIntelligenceRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { ConversationToolMemoryRepository } from "../repositories/conversationToolMemoryRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";

class Clock { private value = 0; public now(): string { return new Date(Date.UTC(2026, 7, 18, 0, 0, this.value++)).toISOString(); } }
function setup() {
  const database = createDatabase(":memory:"), clock = new Clock(), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
  const company = new CompanyRepository(database).create(context, { name: "Intelligence", website: "https://intelligence.test" });
  const conversations = new ConversationService(new ConversationRepository(database), clock), conversation = conversations.open(context, company.id), participant = conversations.addParticipant(context, company.id, conversation.id, { type: "customer" });
  let derivations = 0;
  const intelligence = new ConversationIntelligenceService(new ConversationIntelligenceRepository(database), { derive: async ({ message }) => { derivations += 1; return [{ kind: "set_fact", key: "need", value: message.content }] as const; } }, clock);
  return { database, context, company, conversations, conversation, participant, intelligence, derivations: () => derivations };
}

test("EPIC033 migration creates unbounded applied-message and tool-trace ledgers and rejects mismatched associations", () => {
  const value = setup();
  try {
    const other = new CompanyRepository(value.database).create(value.context, { name: "Other Intelligence", website: "https://other-intelligence.test" });
    const otherConversation = value.conversations.open(value.context, other.id);
    const otherParticipant = value.conversations.addParticipant(value.context, other.id, otherConversation.id, { type: "customer" });
    const otherMessage = value.conversations.addMessage(value.context, other.id, otherConversation.id, { senderParticipantId: otherParticipant.id, direction: "inbound", content: "Other" });
    assert.equal((value.database.prepare("SELECT name FROM schema_migrations WHERE id=39").get() as { name: string }).name, "0039_conversation_intelligence");
    assert.ok((value.database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='conversation_intelligence_applied_tool_traces'").get() as { sql: string }).sql.includes("PRIMARY KEY(conversation_id,tool_trace_id)"));
    assert.throws(() => value.database.prepare("INSERT INTO conversation_intelligence_states(conversation_id,workspace_id,company_id,memory,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(value.conversation.id, value.context.workspaceId, other.id, "", 1, "2026-08-18T00:00:00.000Z", "2026-08-18T00:00:00.000Z"));
    assert.throws(() => value.database.prepare("INSERT INTO conversation_intelligence_references(conversation_id,conversation_message_id,state_version,ordinal) VALUES(?,?,?,?)").run(value.conversation.id, otherMessage.id, 1, 1));
    assert.deepEqual(value.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { value.database.close(); }
});

test("EPIC033 applies each message once and retains its ledger after reference pruning", async () => {
  const value = setup();
  try {
    const first = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content: "Need a two bedroom home" });
    assert.equal((await value.intelligence.apply(value.context, value.company.id, first)).state?.version, 1);
    assert.equal((await value.intelligence.apply(value.context, value.company.id, first)).state?.version, 1); assert.equal(value.derivations(), 1);
    for (const content of ["Near transit", "Budget discussed"]) { const message = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content }); await value.intelligence.apply(value.context, value.company.id, message); }
    assert.equal(value.intelligence.state(value.context, value.company.id, value.conversation.id)?.facts.find((fact) => fact.key === "need")?.value, "Budget discussed");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_messages WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 3);
    assert.equal(value.intelligence.state(value.context, value.company.id, value.conversation.id)?.referenceGroups.length, 0);
  } finally { value.database.close(); }
});

test("EPIC033 retains 257 distinct persisted messages and replays the first once", async () => {
  const value = setup();
  try {
    const messages = Array.from({ length: 257 }, (_, index) => value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content: `Message ${index + 1}` }));
    for (const message of messages) await value.intelligence.apply(value.context, value.company.id, message);
    await value.intelligence.apply(value.context, value.company.id, messages[0]!);
    assert.equal(value.derivations(), 257);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_messages WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 257);
  } finally { value.database.close(); }
});

test("EPIC033 records an outbound message and preserves current memory when derivation fails", async () => {
  const value = setup();
  try {
    const inbound = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content: "Need a garden" });
    await value.intelligence.apply(value.context, value.company.id, inbound);
    const outboundParticipant = value.conversations.addParticipant(value.context, value.company.id, value.conversation.id, { type: "assistant" });
    const outbound = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: outboundParticipant.id, direction: "outbound", content: "I will look for garden options" });
    await value.intelligence.apply(value.context, value.company.id, outbound);
    const failing = new ConversationIntelligenceService(new ConversationIntelligenceRepository(value.database), { derive: async () => { throw new Error("unavailable"); } }, new Clock());
    const later = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content: "Thanks" });
    const state = await failing.apply(value.context, value.company.id, later);
    assert.equal(state.state?.facts.find((fact) => fact.key === "need")?.value, "Need a garden");
    assert.equal(state.state?.version, 2);
  } finally { value.database.close(); }
});

test("EPIC033 does not let a first-seen older human message replace a newer human fact", async () => {
  const value = setup();
  try {
    const newer = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content: "Newer preference" });
    const older = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content: "Older preference" });
    const olderAt = "2026-08-17T00:00:00.000Z";
    value.database.prepare("UPDATE conversation_messages SET created_at=? WHERE id=?").run(olderAt, older.id);
    await value.intelligence.apply(value.context, value.company.id, newer);
    await value.intelligence.apply(value.context, value.company.id, { ...older, createdAt: olderAt });
    const fact = value.intelligence.state(value.context, value.company.id, value.conversation.id)?.facts.find((item) => item.key === "need");
    assert.equal(fact?.value, "Newer preference");
    assert.equal(fact?.sourceMessageId, newer.id);
  } finally { value.database.close(); }
});

test("EPIC033 CAS conflict returns the winner for the same message without a second derivation", async () => {
  const message = mockMessage("1"), state = mockState(1); let derivations = 0, finds = 0, cas = 0;
  const service = new ConversationIntelligenceService({
    find: () => { finds += 1; return state; }, isApplied: () => cas === 1,
    compareAndSet: () => { cas += 1; return null; },
  } as never, { derive: async () => { derivations += 1; return []; } }, new Clock());
  const result = await service.apply({ workspaceId: 1, workspaceKey: "default" }, 1, message);
   assert.equal(result.state, state); assert.equal(result.kind, "applied"); assert.equal(cas, 1); assert.equal(derivations, 1); assert.equal(finds, 2);
});

test("EPIC033 CAS conflict re-derives a different message against the winning version", async () => {
  const message = mockMessage("2"), first = mockState(1), second = mockState(2); let derivations = 0; const expected: Array<number | null> = [];
  const service = new ConversationIntelligenceService({
    find: () => derivations === 0 ? first : second, isApplied: () => false,
    compareAndSet: (_context: unknown, _companyId: number, _conversationId: string, version: number | null, value: { state: ConversationIntelligenceState }) => { expected.push(version); return expected.length === 1 ? null : value.state; },
  } as never, { derive: async () => { derivations += 1; return []; } }, new Clock());
  const result = await service.apply({ workspaceId: 1, workspaceKey: "default" }, 1, message);
   assert.deepEqual(expected, [1, 2]); assert.equal(derivations, 2); assert.equal(result.state?.version, 3);
});

test("EPIC033 returns a controlled skipped outcome after its bounded CAS retry", async () => {
  const message = mockMessage("3"); let derivations = 0, cas = 0;
  const service = new ConversationIntelligenceService({
    find: () => mockState(cas + 1), isApplied: () => false,
    compareAndSet: () => { cas += 1; return null; },
  } as never, { derive: async () => { derivations += 1; return []; } }, new Clock());
  const result = await service.apply({ workspaceId: 1, workspaceKey: "default" }, 1, message);
  assert.deepEqual(result, { kind: "skipped", reason: "conflict", state: mockState(3) });
  assert.equal(cas, 2); assert.equal(derivations, 2);
});

test("EPIC033 persists active intent separately from conversation facts", async () => {
  const value = setup();
  try {
    const intelligence = new ConversationIntelligenceService(new ConversationIntelligenceRepository(value.database), { derive: async () => [{ kind: "set_active_intent", value: "listing_search" }] }, new Clock());
    const message = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content: "Find listings" });
    const result = await intelligence.apply(value.context, value.company.id, message);
    assert.equal(result.state?.activeIntent, "listing_search");
    assert.equal(result.state?.facts.some((fact) => fact.key === "active_intent"), false);
    assert.equal((value.database.prepare("SELECT active_intent_json FROM conversation_intelligence_states WHERE conversation_id=?").get(value.conversation.id) as { active_intent_json: string }).active_intent_json, '"listing_search"');
  } finally { value.database.close(); }
});

test("EPIC033 applies facts, pending items, reference groups, and their deterministic limits", async () => {
  const value = setup();
  try {
    const operations = Array.from({ length: 16 }, (_, index) => ({ kind: "set_fact" as const, key: `fact_${index}`, value: index }));
    const bounded = new ConversationIntelligenceService(new ConversationIntelligenceRepository(value.database), { derive: async ({ message }) => message.content.startsWith("facts-") ? operations.map((operation) => ({ ...operation, key: `${operation.key}_${message.content.at(-1)}` })) : message.content === "pending" ? Array.from({ length: 16 }, (_, index) => ({ kind: "mark_pending" as const, key: `pending_${index}`, askedAt: index === 0 })) : [{ kind: "replace_reference_group" as const, groupKind: "listings", options: Array.from({ length: CONVERSATION_REFERENCE_OPTION_LIMIT }, (_, index) => ({ referenceId: `listing_${index}`, label: `Listing ${index}`, safePayload: { index } })) }] }, new Clock());
    for (const content of ["facts-a", "facts-b", "facts-c", "pending", "pending", "reference"]) { const message = value.conversations.addMessage(value.context, value.company.id, value.conversation.id, { senderParticipantId: value.participant.id, direction: "inbound", content }); await bounded.apply(value.context, value.company.id, message); }
    const state = bounded.state(value.context, value.company.id, value.conversation.id)!;
    assert.equal(state.facts.length, CONVERSATION_FACT_LIMIT); assert.equal(state.pending.length, CONVERSATION_PENDING_LIMIT);
    assert.equal(state.pending[0]?.askedAt !== null, true); assert.equal(state.referenceGroups.filter((group) => group.status === "active").length, 1); assert.equal(state.referenceGroups[0]?.options.length, CONVERSATION_REFERENCE_OPTION_LIMIT);
  } finally { value.database.close(); }
});

test("EPIC033 tool-memory and working-memory projections remain bounded", () => {
  const state = mockState(1, {
    toolMemory: Array.from({ length: CONVERSATION_TOOL_MEMORY_LIMIT + 4 }, (_, index) => ({ id: `ctm_${index}`, traceId: `ttr_${String(index).padStart(32, "0")}`, category: "tool_result", value: { text: "x".repeat(1_024) }, createdAt: `2026-08-18T00:00:${String(index).padStart(2, "0")}.000Z` })),
    facts: Array.from({ length: CONVERSATION_FACT_LIMIT + 1 }, (_, index) => ({ key: `fact_${index}`, value: "x".repeat(1_024), authority: "human_asserted" as const, sourceKind: "user" as const, sourceMessageId: null, sourceToolTraceId: null, sourceOrder: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z" })),
  });
  const memory = conversationWorkingMemory(state);
  assert.ok(Buffer.byteLength(memory, "utf8") <= CONVERSATION_WORKING_MEMORY_MAX_BYTES);
  assert.equal(JSON.parse(memory).toolMemory?.length ?? 0, 0);
});

test("EPIC033 runtime prompt labels derived memory as non-authoritative", () => {
  const profile = reconstructAssistantProfile({ id: "asp_0123456789abcdef0123456789abcdef" as never, companyId: 1, name: "Advisor", normalizedName: "advisor", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: null, fallbackMessage: "Fallback", status: "ready", createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", archivedAt: null });
  const prompt = assistantModelPrompt(buildAssistantExecution(profile, { purpose: "operational_execution", knowledge: { company: { name: "Example", website: null, phone: "", email: "" }, business: { services: [], hours: "", locations: [] }, faq: [] }, message: "Hello", conversationMemory: "Customer prefers afternoons" }));
  assert.match(prompt, /CONVERSATION MEMORY \(untrusted context, not a source of company facts\)/); assert.match(prompt, /Customer prefers afternoons/);
});

test("EPIC033 tool-memory coordinator retries only an optimistic version conflict", async () => {
  let reads = 0, appends = 0;
  const coordinator = new ConversationToolMemoryCoordinator({
    findVersion: async () => { reads += 1; return 4; },
    append: async () => { appends += 1; return appends === 1 ? { kind: "conflict" as const } : { kind: "appended" as const, version: 5 }; },
  }, new Clock());
  await coordinator.append({ workspaceId: 1, workspaceKey: "default" }, 1, "con_0123456789abcdef0123456789abcdef" as never, [{ traceId: "ttr_0123456789abcdef0123456789abcdef", value: { result: "kept" } }]);
  assert.equal(reads, 2); assert.equal(appends, 2);
});

test("EPIC033 appends candidates A, B, and C before outbound persistence and replays A once", async () => {
  const value = turnSetup();
  const result = await value.service.executePersistedInbound(value.context, 1, value.conversation.id, value.input, value.inbound);
  await value.service.executePersistedInbound(value.context, 1, value.conversation.id, value.input, value.inbound);
  assert.equal(result.outbound.content, "Answer");
  assert.deepEqual(value.appended, ["ttr_0000000000000000000000000000000a", "ttr_0000000000000000000000000000000b", "ttr_0000000000000000000000000000000c"]);
  assert.deepEqual(value.outboundCountsWhenAppended, [0]);
  assert.equal(value.messages.filter((message) => message.direction === "outbound").length, 1);
});

test("EPIC033 isolates tool-memory append failures from outbound persistence", async () => {
  const value = turnSetup(true);
  const result = await value.service.executePersistedInbound(value.context, 1, value.conversation.id, value.input, value.inbound);
  assert.equal(result.outbound.content, "Answer");
  assert.equal(value.messages.filter((message) => message.direction === "outbound").length, 1);
});

test("EPIC033 persists outbound after intelligence returns a skipped CAS conflict", async () => {
  const value = turnSetup(false, { apply: async () => ({ kind: "skipped" as const, reason: "conflict" as const, state: null }) });
  const result = await value.service.executePersistedInbound(value.context, 1, value.conversation.id, value.input, value.inbound);
  assert.equal(result.outbound.content, "Answer");
  assert.equal(value.messages.filter((message) => message.direction === "outbound").length, 1);
});

test("EPIC033 operational tool traces remain idempotent after pruning, reject stale new traces, and supply referent memory", async () => {
  const database = createDatabase(":memory:"), sql = new LocalSqlDatabase(database), workspaces = new WorkspaceRepository(database), context = createWorkspaceContext(workspaces.resolveDefault()), foreignContext = createWorkspaceContext(workspaces.createForSystemUse({ key: "foreign", name: "Foreign" }));
  try {
    const companies = new CompanyRepository(database), company = companies.create(context, { name: "Referent Realty", website: "https://referent.test", status: "ready" });
    publishKnowledgeFixture(database, context, company.id, { company: { name: company.name, website: company.website, phone: "", email: "" }, business: { services: ["Listings"], hours: "Always", locations: [] }, faq: [] });
    const clock = new Clock(), conversations = new ConversationService(new ConversationRepository(database), clock), conversation = conversations.open(context, company.id), customer = conversations.addParticipant(context, company.id, conversation.id, { type: "customer" }), assistant = conversations.addParticipant(context, company.id, conversation.id, { type: "assistant" });
    const profile = reconstructAssistantProfile({ id: "asp_abcdef0123456789abcdef0123456789" as never, companyId: company.id, name: "Listings", normalizedName: "listings", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: clock.now(), updatedAt: clock.now(), archivedAt: null });
    new AssistantProfileRepository(database).create(context, company.id, profile);
    database.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('usr_epic033','active','en',?,?)").run(clock.now(), clock.now());
    const capability = assistantCapabilityKey("test.listings"), capabilities = new AssistantCapabilityRepository(sql);
    await capabilities.replaceForProfile(context, company.id, profile.id, [capability], "usr_epic033", clock.now());
    const model = new ReferentModel();
    const tool: ToolDefinition = { name: "test.listings", description: "Returns the selected listing.", inputSchema: { type: "object", maxProperties: 1, required: ["query"], properties: { query: { type: "string", maxLength: 100 } } }, outputSchema: { type: "object", maxProperties: 1, required: ["listing"], properties: { listing: { type: "string", maxLength: 100 } } }, requiredCapabilities: [capability], operationClass: "read", timeoutMilliseconds: 100, idempotencyPolicy: "not_applicable", confirmationPolicy: "none", auditPolicy: { inputFields: ["query"], outputFields: ["listing"] }, conversationMemoryPolicy: { maximumBytes: 256, projectResult: (output) => output }, conversationStatePolicy: { projectResult: () => ({ facts: [{ key: "tool_listing", value: "listing-2" }], referenceGroups: [{ groupKind: "tool_listings", options: [{ referenceId: "listing-2", label: "Tool listing", safePayload: { listingId: "listing-2" } }] }] }) }, executor: async () => ({ listing: "listing-2" }) };
    const tools = new AssistantToolOrchestrator(model, new ToolRegistry(new AssistantCapabilityCatalog([{ key: capability, kind: "tool" }]), [tool]), capabilities, { isAvailable: async () => true }, new ToolExecutionService(new AssistantToolExecutionTraceRepository(sql), clock), clock);
    const intelligence = new ConversationIntelligenceService(new ConversationIntelligenceRepository(database), { derive: async ({ message }) => message.content === "Show me listings" ? [{ kind: "replace_reference_group", groupKind: "listings", options: [{ referenceId: "listing-1", label: "First listing", safePayload: { listingId: "listing-1" } }, { referenceId: "listing-2", label: "Second listing", safePayload: { listingId: "listing-2" } }] }] as const : message.content === "I prefer the second one" ? [{ kind: "set_fact", key: "selected_listing", value: "listing-2" }] as const : [] }, clock);
    const service = new OperationalConversationTurnService(companies, new CompanyKnowledgeRepository(database), new AssistantProfileRepository(database), conversations, new OperationalAssistantRuntime({ execute: async () => ({ outcome: "answered", answer: "unused" }) }, new AssistantExecutionRecordRepository(database), clock, tools), new InMemoryConversationTurnLock(), "test", 10, intelligence, new ConversationToolMemoryCoordinator(new ConversationToolMemoryRepository(sql), clock));
    const input = (content: string) => ({ assistantProfileId: profile.id, inboundParticipantId: customer.id, outboundParticipantId: assistant.id, content });

    await service.execute(context, company.id, conversation.id, input("Show me listings"));
    await service.execute(context, company.id, conversation.id, input("I prefer the second one"));
    const persisted = intelligence.state(context, company.id, conversation.id)!;
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tool_execution_traces WHERE state='completed'").get() as { count: number }).count, 2);
    assert.equal(persisted.toolMemory.length, 2);
    assert.deepEqual(persisted.toolMemory.map((item) => item.value), [{ listing: "listing-2" }, { listing: "listing-2" }]);
    assert.equal(persisted.facts.find((fact) => fact.key === "tool_listing")?.sourceKind, "tool");
    assert.match(persisted.facts.find((fact) => fact.key === "tool_listing")?.sourceToolTraceId ?? "", /^ttr_/);
    assert.equal(persisted.referenceGroups.find((group) => group.kind === "tool_listings")?.options[0]?.label, "Tool listing");
    const traces = database.prepare("SELECT id,assistant_execution_record_id FROM tool_execution_traces ORDER BY id").all() as Array<{ id: string; assistant_execution_record_id: string }>;
    const coordinator = new ConversationToolMemoryCoordinator(new ConversationToolMemoryRepository(sql), clock);
    for (let index = 0; index < CONVERSATION_TOOL_MEMORY_LIMIT; index += 1) await service.execute(context, company.id, conversation.id, input(`Follow up ${index}`));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_tool_memory WHERE conversation_id=? AND tool_trace_id IN (?,?)").get(conversation.id, traces[0]!.id, traces[1]!.id) as { count: number }).count, 0);
    const versionBeforeRetry = (database.prepare("SELECT version FROM conversation_intelligence_states WHERE conversation_id=?").get(conversation.id) as { version: number }).version;
    await coordinator.append(context, company.id, conversation.id, [{ traceId: traces[0]!.id, value: { listing: "replayed-one" } }, { traceId: traces[1]!.id, value: { listing: "replayed-two" } }]);
    assert.equal((database.prepare("SELECT version FROM conversation_intelligence_states WHERE conversation_id=?").get(conversation.id) as { version: number }).version, versionBeforeRetry);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_tool_traces WHERE conversation_id=? AND tool_trace_id IN (?,?)").get(conversation.id, traces[0]!.id, traces[1]!.id) as { count: number }).count, 2);

    const staleRecordId = "aex_ffffffffffffffffffffffffffffffff", staleTraceId = "ttr_ffffffffffffffffffffffffffffffff";
    database.prepare("INSERT INTO assistant_execution_records(id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,execution_snapshot_json,provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds) SELECT ?,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,'{}',provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds FROM assistant_execution_records WHERE id=?").run(staleRecordId, traces[0]!.assistant_execution_record_id);
    database.prepare("INSERT INTO tool_execution_traces(id,assistant_execution_record_id,workspace_id,company_id,assistant_profile_id,model_tool_call_id,tool_name,state,audit_input_json,audit_output_json,requested_at,completed_at,duration_milliseconds) SELECT ?,?,workspace_id,company_id,assistant_profile_id,'stale-call',tool_name,'completed',NULL,'{}',requested_at,completed_at,0 FROM tool_execution_traces WHERE id=?").run(staleTraceId, staleRecordId, traces[0]!.id);
    await coordinator.append(context, company.id, conversation.id, [{ traceId: staleTraceId, value: { listing: "stale" } }]);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_tool_traces WHERE conversation_id=? AND tool_trace_id=?").get(conversation.id, staleTraceId) as { count: number }).count, 0);

    await service.execute(context, company.id, conversation.id, input("Is that one still available?"));
    assert.match(model.requests.at(-1)!.prompt, /selected_listing/);
    assert.match(model.requests.at(-1)!.prompt, /Second listing/);
    await assert.rejects(() => service.execute(foreignContext, company.id, conversation.id, input("Denied")), OperationalConversationTurnNotFoundError);
  } finally { database.close(); }
});

class ReferentModel implements AssistantModelPort {
  public readonly requests: AssistantModelRequest[] = [];
  public createSession(): AssistantModelSession {
    return {
      start: async (request): Promise<AssistantModelStep> => {
        this.requests.push(request);
        return { kind: "tool_calls", toolCalls: [{ id: `call_${this.requests.length}`, toolName: "test.listings", input: { query: "selected listing" } }] };
      },
      continue: async (_results: readonly ToolResult[]): Promise<AssistantModelStep> => ({ kind: "final", text: "Listing answer" }),
    };
  }
}

function turnSetup(failAppend = false, intelligence?: { apply(): Promise<{ readonly kind: "skipped"; readonly reason: "conflict"; readonly state: null }> }) {
  const context = { workspaceId: 1, workspaceKey: "default" } as const, conversation = { id: "cnv_0123456789abcdef0123456789abcdef", channel: "web_chat" } as const;
  const inbound = { id: "cmsg_0123456789abcdef0123456789abcdef", conversationId: conversation.id, direction: "inbound", content: "Question", createdAt: "2026-08-18T00:00:00.000Z" } as never;
  const messages: Array<{ direction: "inbound" | "outbound"; content: string }> = [inbound];
  const appended: string[] = [], outboundCountsWhenAppended: number[] = [];
  let persistedOutbound: { id: string; content: string; direction: "outbound"; executionRecordId: string } | null = null;
  const profile = reconstructAssistantProfile({ id: "asp_0123456789abcdef0123456789abcdef" as never, companyId: 1, name: "Sales", normalizedName: "sales", description: null, businessRole: "Sales advisor", objective: "Help prospects", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", archivedAt: null });
  const coordinator = new ConversationToolMemoryCoordinator({
    findVersion: async () => 1,
    append: async (_context, _companyId, _conversationId, _version, candidates) => {
      outboundCountsWhenAppended.push(messages.filter((message) => message.direction === "outbound").length);
      if (failAppend) throw new Error("unavailable");
      appended.push(...candidates.map((candidate) => candidate.traceId));
      return { kind: "appended" as const, version: 2 };
    },
  }, new Clock());
  const service = new OperationalConversationTurnService(
    { findById: () => ({ id: 1, status: "ready" }) } as never,
    { loadCurrentVersion: () => ({ companyId: 1 }) } as never,
    { findById: () => profile } as never,
    {
      validateOpen: () => conversation,
      findMessageByIdempotencyKey: () => persistedOutbound,
      listMessages: () => messages,
      addMessage: (_context: unknown, _companyId: number, _conversationId: string, input: { direction: "outbound"; content: string }) => {
        persistedOutbound = { id: "cmsg_1123456789abcdef0123456789abcdef", content: input.content, direction: "outbound", executionRecordId: "aex_0123456789abcdef0123456789abcdef" };
        messages.push({ direction: input.direction, content: input.content });
        return { ...persistedOutbound, conversationId: conversation.id };
      },
    } as never,
    { execute: async () => ({ response: { outcome: "answered" as const, answer: "Answer" }, record: { id: "aex_0123456789abcdef0123456789abcdef" }, toolMemoryCandidates: ["a", "b", "c", "a"].map((suffix) => ({ traceId: `ttr_0000000000000000000000000000000${suffix}`, value: { suffix } })) }) } as never,
    new InMemoryConversationTurnLock(), "test", 2, intelligence as never, coordinator,
  );
  return { context, conversation, inbound, input: { assistantProfileId: profile.id, outboundParticipantId: "cpt_0123456789abcdef0123456789abcdef", replyIdempotencyKey: "reply-a" }, messages, appended, outboundCountsWhenAppended, service };
}

function mockMessage(suffix: string) { return { id: `cmsg_0123456789abcdef0123456789abcde${suffix}`, conversationId: "cnv_0123456789abcdef0123456789abcdef", senderParticipantId: "cpt_0123456789abcdef0123456789abcdef", direction: "inbound", content: "Question", idempotencyKey: null, executionRecordId: null, createdAt: "2026-08-18T00:00:00.000Z" } as never; }
function mockState(version: number, overrides: Partial<ConversationIntelligenceState> = {}): ConversationIntelligenceState { return { conversationId: "cnv_0123456789abcdef0123456789abcdef" as never, version, activeIntent: null, facts: [], pending: [], referenceGroups: [], toolMemory: [], createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", ...overrides } as ConversationIntelligenceState; }
