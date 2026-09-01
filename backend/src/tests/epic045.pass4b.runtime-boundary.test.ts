import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { ProactiveActionRepository } from "../repositories/proactiveActionRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { ProactiveDueWorkerService } from "../proactive/services/proactiveDueWorkerService.js";
import { ProactiveRuntimeService } from "../proactive/services/proactiveRuntimeService.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { AssistantExecutionRecordRepository } from "../repositories/assistantExecutionRecordRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { OutboundDeliveryRepository } from "../repositories/outboundDeliveryRepository.js";
import { ProviderMessageRecordRepository } from "../repositories/providerMessageRecordRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WhatsAppConversationRepository } from "../repositories/whatsappConversationRepository.js";
import { AssistantCapabilityCatalog, assistantCapabilityKey } from "../assistant/domain/assistantCapability.js";
import { ToolRegistry } from "../assistant/application/toolRegistry.js";
import { AssistantToolOrchestrator } from "../assistant/services/assistantToolOrchestrator.js";
import { ToolExecutionService } from "../assistant/services/toolExecutionService.js";
import type { AssistantExecutionRequest } from "../assistant/application/assistantExecution.js";
import type { AssistantModelPort, AssistantModelRequest, AssistantModelSession, AssistantModelStep } from "../assistant/application/toolContracts.js";
import type { ToolDefinition } from "../assistant/domain/tool.js";
import type { CompanyKnowledgeVersion } from "../knowledge/domain/knowledge.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";
import { WhatsAppOutboundDeliveryService } from "../whatsapp/services/WhatsAppOutboundDeliveryService.js";
import { WhatsAppCloudApiError } from "../whatsapp/providers/WhatsAppCloudApiProvider.js";
import { FakeWhatsAppOutboundProvider } from "./support/fakeWhatsAppOutboundProvider.js";
import { ProactiveSemanticRecoveryService } from "../proactive/services/proactiveSemanticRecoveryService.js";
import { ConversationIntelligenceRepository } from "../repositories/conversationIntelligenceRepository.js";
import { ConversationIntelligenceService } from "../conversationIntelligence/services/conversationIntelligenceService.js";

const at = "2026-08-28T12:00:00.000Z";

function fixture(path = ":memory:", maximumMigrationId = Number.POSITIVE_INFINITY) {
  const db = maximumMigrationId === Number.POSITIVE_INFINITY ? createDatabase(path) : new DatabaseSync(path);
  if (maximumMigrationId !== Number.POSITIVE_INFINITY) { db.exec("PRAGMA foreign_keys=ON"); runMigrations(db, maximumMigrationId); }
  const context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()), company = new CompanyRepository(db).create(context, { name: "PASS4B", website: "https://pass4b.test" }), conversations = new ConversationRepository(db);
  const conversation = conversations.createConversation(context, reconstructConversation({ id: conversationId("cnv_11111111111111111111111111111111"), companyId: company.id, channel: "whatsapp", state: "open", createdAt: at, updatedAt: at, closedAt: null }))!;
  const customer = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_11111111111111111111111111111111"), conversationId: conversation.id, type: "whatsapp_contact", reference: "customer", createdAt: at }))!;
  const assistant = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_22222222222222222222222222222222"), conversationId: conversation.id, type: "assistant", reference: "apr_11111111111111111111111111111111", createdAt: at }))!;
  const profileId = "asp_11111111111111111111111111111111", connectionId = "wac_11111111111111111111111111111111", knowledgeId = "kver_111111111111111111111111111111";
  db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run(profileId, company.id, "PASS4B", "pass4b", "professional", "en", "Fallback", "ready", at, at);
  db.prepare("INSERT INTO company_knowledge_versions(id,company_id,version_number,compiler_version,knowledge_json,snapshot_digest,published_by_actor_id,published_at) VALUES(?,?,1,'company-knowledge-compiler-v1','{}',?,'system',?)").run(knowledgeId, company.id, "a".repeat(64), at);
  db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, company.id, profileId, "phone-pass4b", "business-pass4b", "active", at, at);
  db.prepare("INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("wcb_11111111111111111111111111111111", connectionId, "customer", conversation.id, customer.id, assistant.id, at, at);
  conversations.ensureConversationControl(context, company.id, conversation.id);
  const inbound = conversations.createMessage(context, company.id, reconstructConversationMessage({ id: conversationMessageId("cmsg_11111111111111111111111111111111"), conversationId: conversation.id, senderParticipantId: customer.id, direction: "inbound", content: "Inbound", idempotencyKey: "inbound-pass4b", executionRecordId: null, createdAt: at }))!;
  db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)").run("cpe_11111111111111111111111111111111", "whatsapp", "meta", connectionId, "event-pass4b", conversation.id, inbound.id, at, at);
  db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_11111111111111111111111111111111", "whatsapp", "meta", "inbound", connectionId, inbound.id, "wamid-pass4b", at, at);
  const repository = new ProactiveActionRepository(db);
  assert.equal(repository.applyPolicy(context, company.id, { actorId: "usr_pass4b", operationId: "enable", expectedVersion: 1, enabled: true, occurredAt: at }).kind, "applied");
  return { db, context, company, conversation, assistant, profileId, connectionId, knowledgeId, repository };
}

function createAction(value: ReturnType<typeof fixture>, digit: string) {
  const created = value.repository.createAction(value.context, value.company.id, { id: `pac_${digit.repeat(32)}`, actorId: "usr_pass4b", operationId: `create-${digit}`, conversationId: value.conversation.id, whatsAppConnectionId: value.connectionId, assistantProfileId: value.profileId, assistantParticipantId: value.assistant.id, runAt: at, expectedAuthorityGeneration: 1, occurredAt: at });
  assert.equal(created.kind, "created");
  return created.action;
}

function lease(value: ReturnType<typeof fixture>, id: string) {
  const worker = new ProactiveDueWorkerService(value.repository, { now: () => at });
  const result = worker.claimDue("pass4b-worker").find((item) => item.action.id === id);
  assert.ok(result);
  return result;
}

function execution(value: ReturnType<typeof fixture>, actionId: string, digit: string, purpose = "proactive_execution", snapshotOverrides: Record<string, unknown> = {}) {
  const id = `aex_${digit.repeat(32)}`, snapshot = { version: "execution-snapshot-v2", workspaceId: value.context.workspaceId, companyId: value.company.id, assistantProfileId: value.profileId, conversationId: value.conversation.id, whatsAppConnectionId: value.connectionId, authorityGeneration: 1, proactiveActionId: actionId, ...snapshotOverrides };
  value.db.prepare("INSERT INTO assistant_execution_records(id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,execution_snapshot_json,provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, value.company.id, value.profileId, "{}", value.knowledgeId, JSON.stringify(snapshot), "test", purpose, "answered", 0, `Result ${digit}`, null, null, null, at, at, 0);
  return id;
}

test("EPIC045 PASS4B selects one valid proactive result and rejects invalid purpose and scope", () => {
  const value = fixture();
  try {
    const created = createAction(value, "a"), currentLease = lease(value, created.id), valid = execution(value, created.id, "a");
    const selected = value.repository.selectCompletedExecution(value.context, value.company.id, { actionId: created.id, executionRecordId: valid, leaseToken: currentLease.leaseToken, now: at })!;
    assert.equal(selected.state, "runtime_completed"); assert.equal(selected.assistantExecutionRecordId, valid); assert.equal(selected.leaseToken, null);
    assert.equal(value.repository.findSelectedExecution(value.context, value.company.id, created.id)?.result, "Result a");
    assert.throws(() => value.db.prepare("UPDATE proactive_actions SET assistant_execution_record_id=NULL WHERE id=?").run(created.id));
    assert.throws(() => value.db.prepare("UPDATE proactive_actions SET state='ready' WHERE id=?").run(created.id));
    assert.equal(new ProactiveDueWorkerService(value.repository, { now: () => at }).claimDue("another").some((item) => item.action.id === created.id), false);
    assert.equal((value.db.prepare("SELECT COUNT(*) count FROM outbound_deliveries").get() as { count: number }).count, 0);
    assert.equal((value.db.prepare("SELECT COUNT(*) count FROM proactive_action_visibility").get() as { count: number }).count, 0);
    assert.throws(() => value.db.prepare("INSERT INTO assistant_execution_records(id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,execution_snapshot_json,provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("aex_ffffffffffffffffffffffffffffffff", value.company.id, value.profileId, "{}", value.knowledgeId, "{}", "test", "unknown", "answered", 0, "Result", null, null, null, at, at, 0));
    const other = createAction(value, "b"), otherLease = lease(value, other.id), preview = execution(value, other.id, "b", "preview");
    assert.equal(value.repository.selectCompletedExecution(value.context, value.company.id, { actionId: other.id, executionRecordId: preview, leaseToken: otherLease.leaseToken, now: at }), null);
    assert.equal(value.repository.selectCompletedExecution(value.context, value.company.id, { actionId: other.id, executionRecordId: valid, leaseToken: otherLease.leaseToken, now: at }), null);
  } finally { value.db.close(); }
});

test("EPIC045 PASS4B fences authority, assignment, window, and stale leases before selection", () => {
  const cases: Array<{ readonly mutate: (value: ReturnType<typeof fixture>) => void; readonly reason: string }> = [
    { mutate: (value) => { value.db.prepare("UPDATE conversation_controls SET authority_generation=2 WHERE conversation_id=?").run(value.conversation.id); }, reason: "authority_lost" },
    { mutate: (value) => { value.db.prepare("UPDATE whatsapp_connections SET status='inactive' WHERE id=?").run(value.connectionId); }, reason: "whatsapp_connection_unavailable" },
  ];
  for (const [index, item] of cases.entries()) {
    const value = fixture();
    try { const created = createAction(value, (index + 3).toString(16)), currentLease = lease(value, created.id), record = execution(value, created.id, (index + 5).toString(16)); item.mutate(value); assert.equal(value.repository.selectCompletedExecution(value.context, value.company.id, { actionId: created.id, executionRecordId: record, leaseToken: currentLease.leaseToken, now: at }), null); assert.equal(value.repository.findAction(value.context, value.company.id, created.id)?.safeReasonCode, item.reason); } finally { value.db.close(); }
  }
  const stale = fixture();
  try { const created = createAction(stale, "e"), currentLease = lease(stale, created.id), record = execution(stale, created.id, "e"); assert.equal(stale.repository.selectCompletedExecution(stale.context, stale.company.id, { actionId: created.id, executionRecordId: record, leaseToken: "pal_stale", now: at }), null); assert.equal(stale.repository.findAction(stale.context, stale.company.id, created.id)?.state, "leased"); assert.ok(currentLease); } finally { stale.db.close(); }
});

test("EPIC045 PASS4B serializes result selection and preserves the chosen result across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-pass4b-")), path = join(directory, "atlas.sqlite"), first = fixture(path);
  let second: DatabaseSync | null = null;
  try {
    const created = createAction(first, "c"), currentLease = lease(first, created.id), left = execution(first, created.id, "c"), right = execution(first, created.id, "d");
    second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON"); const other = new ProactiveActionRepository(second);
    assert.ok(first.repository.selectCompletedExecution(first.context, first.company.id, { actionId: created.id, executionRecordId: left, leaseToken: currentLease.leaseToken, now: at }));
    assert.equal(other.selectCompletedExecution(first.context, first.company.id, { actionId: created.id, executionRecordId: right, leaseToken: currentLease.leaseToken, now: at }), null);
    assert.equal((first.db.prepare("SELECT COUNT(*) count FROM proactive_action_audit_events WHERE proactive_action_id=? AND event_type='completed'").get(created.id) as { count: number }).count, 1);
    first.db.close(); second.close(); second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON"); runMigrations(second);
    const reopened = new ProactiveActionRepository(second), selected = reopened.findSelectedExecution(first.context, first.company.id, created.id)!;
    assert.equal(selected.executionRecordId, left); assert.equal(selected.result, "Result c"); assert.equal(reopened.claimDue("recovery", "2026-08-28T12:01:01.000Z", "2026-08-28T12:02:01.000Z", 25).length, 0);
    let recoveryCalls = 0; await new ProactiveDueWorkerService(reopened, { now: () => "2026-08-28T12:01:01.000Z" }, { execute: async () => { recoveryCalls += 1; } } as never).executeAvailable("restart");
    assert.equal(recoveryCalls, 0); assert.equal((second.prepare("SELECT COUNT(*) count FROM outbound_deliveries").get() as { count: number }).count, 1);
    assert.equal(reopened.findAction(first.context, first.company.id, created.id)?.state, "awaiting_outbound");
    assert.deepEqual(second.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { if (first.db.isOpen) first.db.close(); if (second?.isOpen) second.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS4B upgrades 0063 execution history and preserves Company teardown", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-upgrade64-")), path = join(directory, "atlas.sqlite"); let db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys=ON"); runMigrations(db, 63);
    const context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()), company = new CompanyRepository(db).create(context, { name: "Upgrade64", website: "https://upgrade64.test" });
    db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run("apr_99999999999999999999999999999999", company.id, "Upgrade", "upgrade", "professional", "en", "Fallback", "ready", at, at);
    db.prepare("INSERT INTO company_knowledge_versions(id,company_id,version_number,compiler_version,knowledge_json,snapshot_digest,published_by_actor_id,published_at) VALUES(?,?,1,'company-knowledge-compiler-v1','{}',?,'system',?)").run("kver_999999999999999999999999999999", company.id, "b".repeat(64), at);
    for (const [id, purpose, state, result] of [["aex_99999999999999999999999999999991", "preview", "answered", "Preview"], ["aex_99999999999999999999999999999992", "operational_execution", "failed", null]] as const) db.prepare("INSERT INTO assistant_execution_records(id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,execution_snapshot_json,provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, company.id, "apr_99999999999999999999999999999999", "{}", "kver_999999999999999999999999999999", null, "test", purpose, state, 0, result, null, null, state === "failed" ? "failed" : null, at, at, 0);
    runMigrations(db);
    const records = db.prepare("SELECT id,purpose,state,result FROM assistant_execution_records ORDER BY id").all() as Array<{ id: string; purpose: string; state: string; result: string | null }>;
    assert.equal(records[0]?.id, "aex_99999999999999999999999999999991"); assert.equal(records[0]?.purpose, "preview"); assert.equal(records[0]?.result, "Preview");
    assert.equal(records[1]?.id, "aex_99999999999999999999999999999992"); assert.equal(records[1]?.purpose, "operational_execution"); assert.equal(records[1]?.state, "failed"); assert.equal(records[1]?.result, null);
    db.close(); db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db); db.prepare("DELETE FROM companies WHERE id=?").run(company.id);
    assert.equal(db.prepare("SELECT 1 FROM assistant_execution_records WHERE company_id=?").get(company.id), undefined);
  } finally { if (db.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS6A upgrades the append-only operation ledger through 0065 without rewriting history", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-upgrade65-")), path = join(directory, "atlas.sqlite"), value = fixture(path, 64); let db: DatabaseSync | null = null;
  try {
    const created = createAction(value, "f"), cancelled = value.repository.requestCancel(value.context, value.company.id, created.id, { actorId: "usr_upgrade65", operationId: "cancel-upgrade65", expectedVersion: created.version, occurredAt: at });
    assert.equal(cancelled.kind, "cancelled");
    assert.equal(value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_pass4b", operationId: "stale-upgrade65", expectedVersion: 1, enabled: false, occurredAt: "2026-08-28T12:00:01.000Z" }).kind, "stale_version");
    const before = value.db.prepare("SELECT id,operation,operation_id,request_fingerprint,outcome,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at FROM proactive_action_operations ORDER BY operation,operation_id").all();
    value.db.close(); db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db);
    const upgraded = db;
    assert.deepEqual(upgraded.prepare("SELECT id,operation,operation_id,request_fingerprint,outcome,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at FROM proactive_action_operations ORDER BY operation,operation_id").all(), before);
    assert.throws(() => upgraded.prepare("UPDATE proactive_action_operations SET outcome='applied' WHERE operation_id='cancel-upgrade65'").run());
    assert.throws(() => upgraded.prepare("DELETE FROM proactive_action_operations WHERE operation_id='cancel-upgrade65'").run());
    upgraded.close(); db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db);
    const reopened = db;
    assert.deepEqual(reopened.prepare("PRAGMA foreign_key_check").all(), []);
    reopened.prepare("DELETE FROM companies WHERE id=?").run(value.company.id);
    assert.equal(reopened.prepare("SELECT 1 FROM proactive_action_operations WHERE company_id=?").get(value.company.id), undefined);
  } finally { if (value.db.isOpen) value.db.close(); if (db?.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS6A operation ledger matches the durable action vocabulary and rejects unknown states", () => {
  const value = fixture();
  try {
    const created = createAction(value, "d"), states = ["scheduled", "ready", "leased", "retryable", "runtime_completed", "awaiting_outbound", "succeeded", "cancelled", "suppressed", "permanent_failure", "uncertain"] as const;
    for (const state of states) {
      assert.doesNotThrow(() => value.db.prepare("INSERT INTO proactive_action_operations(id,workspace_id,company_id,proactive_action_id,operation,operation_id,request_fingerprint,outcome,actor_user_id,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(`pao_65_${state}`, value.context.workspaceId, value.company.id, created.id, "cancel", `state-${state}`, "c".repeat(63) + states.indexOf(state).toString(16), "stale_version", "usr_pass4b", null, null, state, 1, at));
    }
    assert.throws(() => value.db.prepare("INSERT INTO proactive_action_operations(id,workspace_id,company_id,proactive_action_id,operation,operation_id,request_fingerprint,outcome,actor_user_id,resulting_action_state,resulting_action_version,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("pao_65_invalid", value.context.workspaceId, value.company.id, created.id, "cancel", "invalid-state", "f".repeat(64), "stale_version", "usr_pass4b", "runtime-completed", 1, at));
  } finally { value.db.close(); }
});

test("EPIC045 PASS6A durably replays a stale cancellation against runtime_completed", () => {
  const value = fixture();
  try {
    const created = createAction(value, "e"), claimed = lease(value, created.id), record = execution(value, created.id, "e"), selected = value.repository.selectCompletedExecution(value.context, value.company.id, { actionId: created.id, executionRecordId: record, leaseToken: claimed.leaseToken, now: at })!;
    const input = { actorId: "usr_pass6a", operationId: "cancel-runtime-completed", expectedVersion: created.version, occurredAt: at };
    assert.equal(value.repository.requestCancel(value.context, value.company.id, selected.id, input).kind, "stale_version");
    assert.equal(value.repository.requestCancel(value.context, value.company.id, selected.id, input).kind, "replayed_stale");
    assert.equal(value.repository.requestCancel(value.context, value.company.id, selected.id, { ...input, expectedVersion: selected.version }).kind, "replay_mismatch");
    assert.equal(value.repository.findAction(value.context, value.company.id, selected.id)?.state, "runtime_completed");
    assert.deepEqual({ ...(value.db.prepare("SELECT outcome,resulting_action_state,resulting_action_version FROM proactive_action_operations WHERE operation='cancel' AND operation_id=?").get(input.operationId) as Record<string, unknown>) }, { outcome: "stale_version", resulting_action_state: "runtime_completed", resulting_action_version: selected.version });
  } finally { value.db.close(); }
});

test("EPIC045 PASS4 executes a real proactive runtime without inbound, outbound, visibility, or CI mutation", async () => {
  const value = fixture();
  try {
    value.db.prepare("UPDATE companies SET status='ready' WHERE id=?").run(value.company.id);
    value.db.prepare("UPDATE assistant_profiles SET business_role='Advisor',objective='Help customers',welcome_message='Welcome' WHERE id=?").run(value.profileId);
    const created = createAction(value, "4"), claimed = lease(value, created.id);
    const before = value.db.prepare("SELECT (SELECT COUNT(*) FROM conversation_messages WHERE direction='inbound') inbound,(SELECT COUNT(*) FROM conversation_messages WHERE direction='outbound') outbound,(SELECT COUNT(*) FROM channel_provider_events) events,(SELECT COUNT(*) FROM provider_message_records) records,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM proactive_action_visibility) visibility,(SELECT COUNT(*) FROM conversation_intelligence_applied_messages) intelligence").get() as Record<string, number>;
    const requests: AssistantExecutionRequest[] = [];
    const runtime = new OperationalAssistantRuntime({ execute: async (request) => { requests.push(request); return { outcome: "answered" as const, answer: "A useful follow-up." }; } }, new AssistantExecutionRecordRepository(value.db), { now: () => at });
    const published: CompanyKnowledgeVersion = { id: value.knowledgeId, companyId: value.company.id, versionNumber: 1, compilerVersion: "company-knowledge-compiler-v1", snapshotDigest: "a".repeat(64), publishedByActorId: "system", publishedAt: at, publicationVersion: 1, sourceRevisionIds: [], knowledge: { company: { name: value.company.name, website: value.company.website, phone: "", email: "" }, business: { services: [], hours: "", locations: [] }, faq: [] } };
    const service = new ProactiveRuntimeService(value.repository, new CompanyRepository(value.db), { loadCurrentVersion: () => published }, new AssistantProfileRepository(value.db), new ConversationService(new ConversationRepository(value.db), { now: () => at }), runtime, { now: () => at });
    await service.execute(claimed);
    const selected = value.repository.findSelectedExecution(value.context, value.company.id, created.id);
    assert.ok(selected);
    assert.equal(selected?.action.state, "runtime_completed"); assert.equal(selected?.result, "A useful follow-up.");
    assert.equal(requests.length, 1); assert.equal(requests[0]?.purpose, "proactive_execution"); assert.match(requests[0]?.message ?? "", /Continue the existing conversation/); assert.equal(requests[0]?.history?.some((entry) => entry.content.includes("Continue the existing")), false);
    const record = value.db.prepare("SELECT purpose,execution_snapshot_json FROM assistant_execution_records WHERE id=?").get(selected?.executionRecordId) as { purpose: string; execution_snapshot_json: string };
    assert.equal(record.purpose, "proactive_execution"); assert.deepEqual(JSON.parse(record.execution_snapshot_json).proactiveActionId, created.id);
    const after = value.db.prepare("SELECT (SELECT COUNT(*) FROM conversation_messages WHERE direction='inbound') inbound,(SELECT COUNT(*) FROM conversation_messages WHERE direction='outbound') outbound,(SELECT COUNT(*) FROM channel_provider_events) events,(SELECT COUNT(*) FROM provider_message_records) records,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM proactive_action_visibility) visibility,(SELECT COUNT(*) FROM conversation_intelligence_applied_messages) intelligence").get() as Record<string, number>;
    assert.deepEqual(after, before);
  } finally { value.db.close(); }
});

test("EPIC045 PASS4 exposes only read tools to proactive model declarations", async () => {
  const keys = ["test.read", "test.write", "test.sensitive"] as const;
  const catalog = new AssistantCapabilityCatalog(keys.map((key) => ({ key: assistantCapabilityKey(key), kind: "tool" as const })));
  const definition = (name: string, operationClass: ToolDefinition["operationClass"]): ToolDefinition => ({ name, description: name, inputSchema: { type: "string", maxLength: 1 }, outputSchema: { type: "string", maxLength: 1 }, requiredCapabilities: [assistantCapabilityKey(name)], operationClass, timeoutMilliseconds: 1, idempotencyPolicy: operationClass === "read" ? "not_applicable" : "source_owned_required", confirmationPolicy: "none", auditPolicy: {}, executor: async () => "" });
  class Model implements AssistantModelPort { public readonly requests: AssistantModelRequest[] = []; public createSession(): AssistantModelSession { return { start: async (request): Promise<AssistantModelStep> => { this.requests.push(request); return { kind: "final", text: "ok" }; }, continue: async (): Promise<AssistantModelStep> => ({ kind: "final", text: "ok" }) }; } }
  const model = new Model(), tools = [definition("test.read", "read"), definition("test.write", "write"), definition("test.sensitive", "sensitive_write")], orchestrator = new AssistantToolOrchestrator(model, new ToolRegistry(catalog, tools), { listForProfile: async () => keys.map(assistantCapabilityKey), existsForProfile: async () => true, replaceForProfile: async () => true }, { isAvailable: async () => true }, new ToolExecutionService({ createRequested: async () => { throw new Error("no tool call"); }, complete: async () => true, fail: async () => true }, { now: () => at }), { now: () => at });
  const context = { workspaceId: 1, companyId: 1, assistantProfileId: "apr_11111111111111111111111111111111", assistantExecutionRecordId: "aex_11111111111111111111111111111111", conversationId: null, channel: "internal" as const, invocationId: "", idempotencyKey: null, confirmation: null };
  await orchestrator.runOutcome("prompt", { ...context, purpose: "proactive_execution" });
  assert.deepEqual(model.requests[0]?.tools.map((tool) => tool.name), ["test.read"]);
  await orchestrator.runOutcome("prompt", { ...context, purpose: "operational_execution" });
  assert.deepEqual(model.requests[1]?.tools.map((tool) => tool.name), ["test.read", "test.write", "test.sensitive"]);
});

function proactiveRuntime(value: ReturnType<typeof fixture>, execute: (request: AssistantExecutionRequest) => Promise<{ outcome: "answered"; answer: string }>, clock: { now(): string }, heartbeatIntervalMilliseconds = 20_000, scheduler?: (callback: () => void, milliseconds: number) => () => void) {
  value.db.prepare("UPDATE companies SET status='ready' WHERE id=?").run(value.company.id);
  value.db.prepare("UPDATE assistant_profiles SET business_role='Advisor',objective='Help customers',welcome_message='Welcome' WHERE id=?").run(value.profileId);
  const published: CompanyKnowledgeVersion = { id: value.knowledgeId, companyId: value.company.id, versionNumber: 1, compilerVersion: "company-knowledge-compiler-v1", snapshotDigest: "a".repeat(64), publishedByActorId: "system", publishedAt: at, publicationVersion: 1, sourceRevisionIds: [], knowledge: { company: { name: value.company.name, website: value.company.website, phone: "", email: "" }, business: { services: [], hours: "", locations: [] }, faq: [] } };
  return new ProactiveRuntimeService(value.repository, new CompanyRepository(value.db), { loadCurrentVersion: () => published }, new AssistantProfileRepository(value.db), new ConversationService(new ConversationRepository(value.db), clock), new OperationalAssistantRuntime({ execute }, new AssistantExecutionRecordRepository(value.db), clock), clock, undefined, undefined, heartbeatIntervalMilliseconds, scheduler);
}

test("EPIC045 PASS4 heartbeat durably retains a long in-flight lease without extra attempts or audits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-heartbeat-")), path = join(directory, "atlas.sqlite"), value = fixture(path); let second: DatabaseSync | null = null;
  try {
    const clock = { value: at, now() { return this.value; } }, created = createAction(value, "5"), claimed = lease(value, created.id);
    let resolve!: () => void; const runtime = proactiveRuntime(value, async () => new Promise((done) => { resolve = () => done({ outcome: "answered", answer: "late" }); }), clock, 1);
    const running = runtime.execute(claimed); await new Promise((done) => setTimeout(done, 5));
    clock.value = "2026-08-28T12:00:20.000Z"; await new Promise((done) => setTimeout(done, 3));
    clock.value = "2026-08-28T12:00:40.000Z"; await new Promise((done) => setTimeout(done, 3));
    clock.value = "2026-08-28T12:01:01.000Z"; await new Promise((done) => setTimeout(done, 3));
    const renewed = value.repository.findAction(value.context, value.company.id, created.id)!;
    assert.equal(renewed.attemptCount, 1); assert.ok(renewed.leaseExpiresAt! > clock.value); assert.equal((value.db.prepare("SELECT COUNT(*) count FROM proactive_action_audit_events WHERE proactive_action_id=?").get(created.id) as { count: number }).count, 2);
    second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON");
    assert.equal(new ProactiveActionRepository(second).claimDue("worker-b", clock.value, "2026-08-28T12:02:01.000Z", 25).length, 0);
    resolve(); await running;
    assert.equal(value.repository.findAction(value.context, value.company.id, created.id)?.state, "runtime_completed");
  } finally { if (value.db.isOpen) value.db.close(); if (second?.isOpen) second.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS4 stale in-flight runtime cannot select after lease recovery", async () => {
  const value = fixture();
  try {
    const clock = { value: at, now() { return this.value; } }, created = createAction(value, "6"), claimed = lease(value, created.id);
    let resolve!: () => void; const runtime = proactiveRuntime(value, async () => new Promise((done) => { resolve = () => done({ outcome: "answered", answer: "stale" }); }), clock, 999_999);
    const running = runtime.execute(claimed); await new Promise((done) => setTimeout(done, 1));
    clock.value = "2026-08-28T12:01:01.000Z";
    const replacement = value.repository.claimDue("worker-b", clock.value, "2026-08-28T12:02:01.000Z", 25)[0]!;
    assert.notEqual(replacement.leaseToken, claimed.leaseToken); resolve(); await running;
    const current = value.repository.findAction(value.context, value.company.id, created.id)!;
    assert.equal(current.state, "leased"); assert.equal(current.leaseToken, replacement.leaseToken); assert.equal(current.assistantExecutionRecordId, null);
  } finally { value.db.close(); }
});

test("EPIC045 PASS4 preserves completed evidence across a crash before selection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-before-selection-")), path = join(directory, "atlas.sqlite"), value = fixture(path); let reopened: DatabaseSync | null = null;
  try {
    value.db.prepare("UPDATE companies SET status='ready' WHERE id=?").run(value.company.id);
    value.db.prepare("UPDATE assistant_profiles SET business_role='Advisor',objective='Help customers',welcome_message='Welcome' WHERE id=?").run(value.profileId);
    const created = createAction(value, "a"), claimed = lease(value, created.id), profile = new AssistantProfileRepository(value.db).findById(value.context, value.company.id, claimed.action.assistantProfileId as never)!;
    const knowledge: CompanyKnowledgeVersion = { id: value.knowledgeId, companyId: value.company.id, versionNumber: 1, compilerVersion: "company-knowledge-compiler-v1", snapshotDigest: "a".repeat(64), publishedByActorId: "system", publishedAt: at, publicationVersion: 1, sourceRevisionIds: [], knowledge: { company: { name: value.company.name, website: value.company.website, phone: "", email: "" }, business: { services: [], hours: "", locations: [] }, faq: [] } };
    const record = await new OperationalAssistantRuntime({ execute: async () => ({ outcome: "answered" as const, answer: "durable before selection" }) }, new AssistantExecutionRecordRepository(value.db), { now: () => at }).execute(new CompanyRepository(value.db).findById(value.context, value.company.id)!, profile, knowledge, "code-owned", [], { purpose: "proactive_execution", provider: "test", fallbackOnUnavailable: true, proactiveActionId: created.id, snapshotContext: { conversationId: created.conversationId, whatsAppConnectionId: created.whatsAppConnectionId, authorityGeneration: 1, channelProvider: "whatsapp" } });
    value.db.close(); reopened = new DatabaseSync(path); reopened.exec("PRAGMA foreign_keys=ON"); runMigrations(reopened);
    assert.equal((reopened.prepare("SELECT result FROM assistant_execution_records WHERE id=?").get(record.record.id) as { result: string }).result, "durable before selection");
    const action = reopened.prepare("SELECT state,assistant_execution_record_id FROM proactive_actions WHERE id=?").get(created.id) as { state: string; assistant_execution_record_id: string | null };
    assert.equal(action.state, "leased"); assert.equal(action.assistant_execution_record_id, null);
    assert.equal((reopened.prepare("SELECT COUNT(*) count FROM outbound_deliveries").get() as { count: number }).count, 0); assert.equal((reopened.prepare("SELECT COUNT(*) count FROM proactive_action_visibility").get() as { count: number }).count, 0);
  } finally { if (value.db.isOpen) value.db.close(); if (reopened?.isOpen) reopened.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS4 final selection suppresses deferred runtime after authority or assignment races", async () => {
  const cases: Array<{ digit: string; mutate(value: ReturnType<typeof fixture>, clock: { value: string; now(): string }): void; reason: string }> = [
    { digit: "7", mutate: (value) => { value.db.prepare("UPDATE conversation_controls SET state='human_controlled',controlling_actor_id='usr_pass4',taken_at=?,authority_generation=2 WHERE conversation_id=?").run(at, value.conversation.id); }, reason: "authority_lost" },
    { digit: "8", mutate: (value) => { value.db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("asp_88888888888888888888888888888888", value.company.id, "B", "b", "professional", "en", "Fallback", "draft", at, at); value.db.prepare("UPDATE whatsapp_connections SET assistant_profile_id='asp_88888888888888888888888888888888' WHERE id=?").run(value.connectionId); }, reason: "assistant_assignment_changed" },
  ];
  for (const item of cases) {
    const value = fixture();
    try {
      const clock = { value: at, now() { return this.value; } }, created = createAction(value, item.digit), claimed = lease(value, created.id);
      let resolve!: () => void; const runtime = proactiveRuntime(value, async () => new Promise((done) => { resolve = () => done({ outcome: "answered", answer: "late" }); }), clock, 999_999), before = value.db.prepare("SELECT (SELECT COUNT(*) FROM conversation_messages WHERE direction='outbound') outbound,(SELECT COUNT(*) FROM provider_message_records) records,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM proactive_action_visibility) visibility,(SELECT COUNT(*) FROM conversation_intelligence_applied_messages) intelligence").get();
      const running = runtime.execute(claimed); await new Promise((done) => setTimeout(done, 1)); item.mutate(value, clock); resolve(); await running;
      const current = value.repository.findAction(value.context, value.company.id, created.id)!;
      assert.equal(current.state, "suppressed"); assert.equal(current.safeReasonCode, item.reason); assert.equal(current.assistantExecutionRecordId, null);
      assert.deepEqual(value.db.prepare("SELECT (SELECT COUNT(*) FROM conversation_messages WHERE direction='outbound') outbound,(SELECT COUNT(*) FROM provider_message_records) records,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM proactive_action_visibility) visibility,(SELECT COUNT(*) FROM conversation_intelligence_applied_messages) intelligence").get(), before);
    } finally { value.db.close(); }
  }
});

test("EPIC045 PASS4 keeps its heartbeat through an in-flight service-window expiry and suppresses without effects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-window-race-")), path = join(directory, "atlas.sqlite"), value = fixture(path); let second: DatabaseSync | null = null;
  try {
    const clock = { value: at, now() { return this.value; } }, created = createAction(value, "b"), claimed = lease(value, created.id);
    let resolve!: () => void, tick: () => void = () => { throw new Error("Heartbeat was not started."); };
    const runtime = proactiveRuntime(value, async () => new Promise((done) => { resolve = () => done({ outcome: "answered", answer: "too late" }); }), clock, 20_000, (callback) => { tick = callback; return () => {}; });
    const before = value.db.prepare("SELECT (SELECT COUNT(*) FROM conversation_messages WHERE direction='outbound') outbound,(SELECT COUNT(*) FROM provider_message_records) records,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM proactive_action_visibility) visibility,(SELECT COUNT(*) FROM conversation_intelligence_applied_messages) intelligence").get();
    const running = runtime.execute(claimed); await new Promise((done) => setTimeout(done, 1));
    const start = Date.parse(at);
    for (let seconds = 20; seconds <= 86_400; seconds += 20) { clock.value = new Date(start + seconds * 1_000).toISOString(); tick(); }
    const retained = value.repository.findAction(value.context, value.company.id, created.id)!;
    assert.equal(retained.attemptCount, 1); assert.equal(retained.leaseToken, claimed.leaseToken); assert.ok(retained.leaseExpiresAt! > clock.value); assert.equal((value.db.prepare("SELECT COUNT(*) count FROM proactive_action_audit_events WHERE proactive_action_id=?").get(created.id) as { count: number }).count, 2);
    second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON"); assert.equal(new ProactiveActionRepository(second).claimDue("worker-b", clock.value, new Date(Date.parse(clock.value) + 60_000).toISOString(), 25).length, 0);
    resolve(); await running;
    const saved = value.repository.findAction(value.context, value.company.id, created.id)!;
    assert.equal(saved.state, "suppressed"); assert.equal(saved.safeReasonCode, "whatsapp_service_window_closed"); assert.equal(saved.assistantExecutionRecordId, null);
    assert.deepEqual(value.db.prepare("SELECT (SELECT COUNT(*) FROM conversation_messages WHERE direction='outbound') outbound,(SELECT COUNT(*) FROM provider_message_records) records,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM proactive_action_visibility) visibility,(SELECT COUNT(*) FROM conversation_intelligence_applied_messages) intelligence").get(), before);
    value.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?)").run("cmsg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", value.conversation.id, "cpt_11111111111111111111111111111111", "inbound", "Real later inbound", "later-inbound", "2026-08-29T12:00:01.000Z");
    value.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)").run("cpe_later", "whatsapp", "meta", value.connectionId, "later-event", value.conversation.id, "cmsg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", clock.value, clock.value);
    value.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_later", "whatsapp", "meta", "inbound", value.connectionId, "cmsg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "wamid-later", clock.value, clock.value);
    new ProactiveDueWorkerService(value.repository, clock).recoverAvailable(); assert.equal(value.repository.findAction(value.context, value.company.id, created.id)?.state, "suppressed");
  } finally { if (value.db.isOpen) value.db.close(); if (second?.isOpen) second.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS5 materializes once and atomically settles proactive acceptance with visibility", () => {
  const value = fixture();
  try {
    const created = createAction(value, "9"), claimed = lease(value, created.id), record = execution(value, created.id, "9");
    assert.ok(value.repository.selectCompletedExecution(value.context, value.company.id, { actionId: created.id, executionRecordId: record, leaseToken: claimed.leaseToken, now: at }));
    assert.equal(value.repository.materializeCompleted(at, 25).length, 1);
    const reserved = value.repository.findAction(value.context, value.company.id, created.id)!;
    assert.equal(reserved.state, "awaiting_outbound"); assert.ok(reserved.outboundMessageId); assert.ok(reserved.outboundDeliveryId);
    assert.equal(value.repository.materializeCompleted(at, 25).length, 0);
    const deliveries = new OutboundDeliveryRepository(value.db), delivery = deliveries.leaseReady("pass5-worker", at, "2026-08-28T12:01:00.000Z", 25)[0]!;
    assert.equal(delivery.id, reserved.outboundDeliveryId); assert.equal(deliveries.authorizeLease(delivery.id, "pass5-worker", at), true); assert.equal(deliveries.beginSend(delivery.id, "pass5-worker", at), true);
    assert.equal(deliveries.acceptSend(delivery.id, "pass5-worker", "wamid-pass5", at)?.state, "accepted");
    const settled = value.repository.findAction(value.context, value.company.id, created.id)!;
    assert.equal(settled.state, "succeeded");
    assert.deepEqual(value.repository.findVisibility(value.context, value.company.id, created.id), { actionId: created.id, messageId: reserved.outboundMessageId!, deliveryId: reserved.outboundDeliveryId!, committedAt: at });
    assert.equal((value.db.prepare("SELECT COUNT(*) count FROM proactive_action_visibility WHERE proactive_action_id=?").get(created.id) as { count: number }).count, 1);
  } finally { value.db.close(); }
});

function reserveForPass5(value: ReturnType<typeof fixture>, digit: string) {
  const created = createAction(value, digit), claimed = lease(value, created.id), record = execution(value, created.id, digit);
  assert.ok(value.repository.selectCompletedExecution(value.context, value.company.id, { actionId: created.id, executionRecordId: record, leaseToken: claimed.leaseToken, now: at }));
  assert.equal(value.repository.materializeCompleted(at, 25).length, 1);
  return value.repository.findAction(value.context, value.company.id, created.id)!;
}

function outboundService(value: ReturnType<typeof fixture>, provider: FakeWhatsAppOutboundProvider) {
  return new WhatsAppOutboundDeliveryService(new ConversationRepository(value.db), new WhatsAppConnectionRepository(value.db), new ProviderMessageRecordRepository(value.db), new OutboundDeliveryRepository(value.db), { resolve: () => "token" } as never, () => provider, { now: () => at }, undefined, new WhatsAppConversationRepository(value.db));
}

test("EPIC045 PASS5B fences takeover, assignment, and service-window races at send start", () => {
  const cases: Array<{ readonly digit: string; readonly mutate: (value: ReturnType<typeof fixture>) => void; readonly reason: string }> = [
    { digit: "a", mutate: (value) => { value.db.prepare("UPDATE conversation_controls SET state='human_required',authority_generation=2 WHERE conversation_id=?").run(value.conversation.id); }, reason: "authority_lost" },
    { digit: "b", mutate: (value) => { value.db.prepare("UPDATE whatsapp_connections SET assistant_profile_id='asp_changed' WHERE id=?").run(value.connectionId); }, reason: "assistant_assignment_changed" },
    { digit: "c", mutate: (value) => { value.db.prepare("DELETE FROM provider_message_records WHERE id='pmr_11111111111111111111111111111111'").run(); }, reason: "whatsapp_service_window_closed" },
  ];
  for (const item of cases) {
    const value = fixture();
    try {
      if (item.digit === "b") value.db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES('asp_changed',?,'Changed','changed','professional','en','Fallback','draft',?,?)").run(value.company.id, at, at);
      const reserved = reserveForPass5(value, item.digit), delivery = new OutboundDeliveryRepository(value.db).leaseReady("worker", at, "2026-08-28T12:01:00.000Z", 1)[0]!;
      assert.equal(delivery.id, reserved.outboundDeliveryId); assert.equal(new OutboundDeliveryRepository(value.db).authorizeLease(delivery.id, "worker", at), true);
      item.mutate(value);
      assert.equal(new OutboundDeliveryRepository(value.db).beginSend(delivery.id, "worker", at), false);
      assert.equal(value.repository.findAction(value.context, value.company.id, reserved.id)?.safeReasonCode, item.reason);
      assert.equal((value.db.prepare("SELECT external_message_id FROM provider_message_records WHERE id=(SELECT provider_message_record_id FROM outbound_deliveries WHERE id=?)").get(delivery.id) as { external_message_id: string | null }).external_message_id, null);
    } finally { value.db.close(); }
  }
});

test("EPIC045 PASS5B classifies retryable, permanent, and uncertain provider outcomes without semantic visibility", async () => {
  const cases: Array<{ readonly digit: string; readonly failure: WhatsAppCloudApiError | string; readonly deliveryState: string; readonly actionState: string }> = [
    { digit: "d", failure: new WhatsAppCloudApiError(429, null), deliveryState: "retryable", actionState: "awaiting_outbound" },
    { digit: "e", failure: new WhatsAppCloudApiError(400, null), deliveryState: "permanent_failure", actionState: "permanent_failure" },
    { digit: "f", failure: "x".repeat(257), deliveryState: "uncertain", actionState: "uncertain" },
  ];
  for (const item of cases) {
    const value = fixture(), provider = new FakeWhatsAppOutboundProvider();
    try {
      const reserved = reserveForPass5(value, item.digit);
      if (typeof item.failure === "string") provider.enqueueAccepted(item.failure); else provider.enqueueFailed(item.failure);
      await outboundService(value, provider).dispatchReady("worker");
      assert.equal(new OutboundDeliveryRepository(value.db).findById(reserved.outboundDeliveryId as never)?.state, item.deliveryState);
      assert.equal(value.repository.findAction(value.context, value.company.id, reserved.id)?.state, item.actionState);
      assert.equal(value.repository.findVisibility(value.context, value.company.id, reserved.id), null);
    } finally { value.db.close(); }
  }
});

test("EPIC045 PASS5B materialization and cancellation serialize across SQLite connections and preserve ordering", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-pass5b-race-")), path = join(directory, "atlas.sqlite"), value = fixture(path); let second: DatabaseSync | null = null;
  try {
    const first = reserveForPass5(value, "1");
    second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON");
    assert.equal(new ProactiveActionRepository(second).materializeCompleted(at, 25).length, 0);
    const standardMessage = `cmsg_${"3".repeat(32)}`, standardRecord = `pmr_${"3".repeat(32)}`, standardDelivery = `odl_${"3".repeat(32)}`;
    value.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,created_at) VALUES(?,?,?,'outbound','standard',NULL,?)").run(standardMessage, value.conversation.id, value.assistant.id, at);
    value.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,'whatsapp','meta_whatsapp_cloud','outbound',?, ?,NULL,?,?)").run(standardRecord, value.connectionId, standardMessage, at, at);
    value.db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?)").run(standardDelivery, standardRecord, value.connectionId, at, at, at);
    assert.equal(new OutboundDeliveryRepository(value.db).leaseReady("head", at, "2026-08-28T12:01:00.000Z", 25).some((delivery) => delivery.id === standardDelivery), false);
    const cancelled = new ProactiveActionRepository(second).requestCancel(value.context, value.company.id, first.id, { actorId: "usr_pass5b", operationId: "cancel-pass5b", expectedVersion: first.version, occurredAt: at });
    assert.equal(cancelled.kind, "cancelled");
    assert.equal(new OutboundDeliveryRepository(value.db).leaseReady("next", at, "2026-08-28T12:01:00.000Z", 25).some((delivery) => delivery.id === standardDelivery), true);
  } finally { if (value.db.isOpen) value.db.close(); if (second?.isOpen) second.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS5B acceptance rollback is all-or-nothing and semantic recovery is exactly once after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-pass5b-semantic-")), path = join(directory, "atlas.sqlite"), value = fixture(path); let reopened: DatabaseSync | null = null;
  try {
    const reserved = reserveForPass5(value, "2"), deliveries = new OutboundDeliveryRepository(value.db), leased = deliveries.leaseReady("worker", at, "2026-08-28T12:01:00.000Z", 1)[0]!;
    assert.equal(deliveries.beginSend(leased.id, "worker", at), true);
    value.db.exec("CREATE TRIGGER reject_pass5b_visibility BEFORE INSERT ON proactive_action_visibility BEGIN SELECT RAISE(ABORT,'rollback proof'); END;");
    assert.throws(() => deliveries.acceptSend(leased.id, "worker", "wamid-rollback", at));
    value.db.exec("DROP TRIGGER reject_pass5b_visibility;");
    assert.deepEqual({ ...(value.db.prepare("SELECT d.state,p.external_message_id,a.state action_state FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN proactive_actions a ON a.outbound_delivery_id=d.id WHERE d.id=?").get(leased.id) as Record<string, unknown>) }, { state: "leased", external_message_id: null, action_state: "awaiting_outbound" });
    assert.equal(deliveries.acceptSend(leased.id, "worker", "wamid-accepted", at)?.state, "accepted");
    value.db.close(); reopened = new DatabaseSync(path); reopened.exec("PRAGMA foreign_keys=ON"); runMigrations(reopened);
    const recovery = new ProactiveSemanticRecoveryService(new ProactiveActionRepository(reopened), new ConversationIntelligenceService(new ConversationIntelligenceRepository(reopened), { derive: async () => [] }, { now: () => at }));
    assert.equal(await recovery.recover(value.context, value.company.id), 1);
    assert.equal(await recovery.recoverAvailable(), 0);
    assert.equal((reopened.prepare("SELECT COUNT(*) count FROM conversation_intelligence_applied_messages WHERE conversation_message_id=?").get(reserved.outboundMessageId) as { count: number }).count, 1);
    assert.equal((reopened.prepare("SELECT COUNT(*) count FROM proactive_action_visibility WHERE proactive_action_id=?").get(reserved.id) as { count: number }).count, 1);
  } finally { if (value.db.isOpen) value.db.close(); if (reopened?.isOpen) reopened.close(); rmSync(directory, { recursive: true, force: true }); }
});
