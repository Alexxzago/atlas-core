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
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant, type Conversation, type ConversationParticipant } from "../conversation/domain/conversation.js";

const at = "2026-08-28T12:00:00.000Z";
const later = "2026-08-28T12:10:00.000Z";

function setup(path = ":memory:") {
  const db = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()), company = new CompanyRepository(db).create(context, { name: "Proactive", website: "https://proactive.test" }), conversations = new ConversationRepository(db);
  const conversation = conversations.createConversation(context, reconstructConversation({ id: conversationId("cnv_04500000000000000000000000000001"), companyId: company.id, channel: "whatsapp", state: "open", createdAt: at, updatedAt: at, closedAt: null }))!;
  const customer = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04500000000000000000000000000001"), conversationId: conversation.id, type: "whatsapp_contact", reference: "customer", createdAt: at }))!;
  const assistant = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04500000000000000000000000000002"), conversationId: conversation.id, type: "assistant", reference: "apr_04500000000000000000000000000001", createdAt: at }))!;
  const profileId = "apr_04500000000000000000000000000001", connectionId = "wac_04500000000000000000000000000001";
  db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run(profileId, company.id, "Proactive", "proactive", "professional", "en", "Fallback", "ready", at, at);
  db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, company.id, profileId, "phone-045", "business-045", "active", at, at);
  db.prepare("INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("wcb_04500000000000000000000000000001", connectionId, "customer", conversation.id, customer.id, assistant.id, at, at);
  conversations.ensureConversationControl(context, company.id, conversation.id);
  const inbound = addInboundEvidence({ db, context, company, conversation, customer, connectionId }, "01", at, "Hello");
  return { db, context, company, conversation, customer, assistant, profileId, connectionId, inbound, repository: new ProactiveActionRepository(db) };
}

function addInboundEvidence(value: { db: SynchronousDatabase; context: WorkspaceContext; company: { readonly id: number }; conversation: Conversation; customer: ConversationParticipant; connectionId: string }, suffix: string, createdAt: string, content: string) {
  const messageId = conversationMessageId(`cmsg_${suffix.padStart(32, "0")}`);
  const inbound = new ConversationRepository(value.db).createMessage(value.context, value.company.id, reconstructConversationMessage({ id: messageId, conversationId: value.conversation.id, senderParticipantId: value.customer.id, direction: "inbound", content, idempotencyKey: `inbound-045-${suffix}`, executionRecordId: null, createdAt }))!;
  value.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)").run(`cpe_045_${suffix}`, "whatsapp", "meta_whatsapp_cloud", value.connectionId, `wamid-event-${suffix}`, value.conversation.id, inbound.id, createdAt, createdAt);
  value.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(`pmr_045_${suffix}`, "whatsapp", "meta_whatsapp_cloud", "inbound", value.connectionId, inbound.id, `wamid-message-${suffix}`, createdAt, createdAt);
  return inbound;
}

function addOutboundDelivery(value: ReturnType<typeof setup>, suffix: string, proactiveActionId: string | null = null): string {
  const message = new ConversationRepository(value.db).createMessage(value.context, value.company.id, reconstructConversationMessage({ id: conversationMessageId(`cmsg_${Buffer.from(suffix).toString("hex").padEnd(32, "0").slice(0, 32)}`), conversationId: value.conversation.id, senderParticipantId: value.assistant.id, direction: "outbound", content: `Outbound ${suffix}`, idempotencyKey: `outbound-045-${suffix}`, executionRecordId: null, createdAt: "2026-08-28T12:30:00.000Z" }))!;
  const recordId = `pmr_045_outbound_${suffix}`, deliveryId = `odl_045_outbound_${suffix}`;
  value.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(recordId, "whatsapp", "meta_whatsapp_cloud", "outbound", value.connectionId, message.id, null, "2026-08-28T12:30:00.000Z", "2026-08-28T12:30:00.000Z");
  value.db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,expected_authority_generation,created_at,updated_at,proactive_action_id) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?,?,?)").run(deliveryId, recordId, value.connectionId, "2026-08-28T12:30:00.000Z", proactiveActionId === null ? null : 1, "2026-08-28T12:30:00.000Z", "2026-08-28T12:30:00.000Z", proactiveActionId);
  return deliveryId;
}

function enable(value: ReturnType<typeof setup>): void {
  assert.equal(value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_045", operationId: "policy-enable", expectedVersion: 1, enabled: true, occurredAt: at }).kind, "applied");
}

function createInput(value: ReturnType<typeof setup>, id = "pac_04500000000000000000000000000001", operationId = "create-045", runAt = later) {
  return { id, actorId: "usr_045", operationId, conversationId: value.conversation.id, whatsAppConnectionId: value.connectionId, assistantProfileId: value.profileId, assistantParticipantId: value.assistant.id, runAt, expectedAuthorityGeneration: 1, occurredAt: at };
}

test("EPIC045 PASS2 seeds disabled Company policy and replays CAS outcomes", () => {
  const value = setup();
  try {
    const initial = value.repository.findPolicy(value.context, value.company.id)!;
    assert.equal(initial.workspaceId, value.context.workspaceId); assert.equal(initial.companyId, value.company.id); assert.equal(initial.enabled, false); assert.equal(initial.version, 1);
    assert.equal(value.repository.createAction(value.context, value.company.id, createInput(value)).kind, "policy_disabled");
    const applied = value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_045", operationId: "policy-enable", expectedVersion: 1, enabled: true, occurredAt: at });
    assert.equal(applied.kind, "applied");
    assert.equal(value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_045", operationId: "policy-enable", expectedVersion: 1, enabled: true, occurredAt: at }).kind, "replayed_applied");
    assert.equal(value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_045", operationId: "policy-enable", expectedVersion: 1, enabled: false, occurredAt: at }).kind, "replay_mismatch");
    assert.equal(value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_045", operationId: "policy-stale", expectedVersion: 1, enabled: false, occurredAt: at }).kind, "stale_version");
  } finally { value.db.close(); }
});

test("EPIC045 PASS2 creates exactly one scoped follow-up and replays/cancels it", () => {
  const value = setup();
  try {
    enable(value);
    const command = createInput(value), created = value.repository.createAction(value.context, value.company.id, command);
    assert.equal(created.kind, "created");
    assert.equal(value.repository.createAction(value.context, value.company.id, command).kind, "replayed");
    assert.equal(value.repository.createAction(value.context, value.company.id, { ...command, runAt: "2026-08-28T12:20:00.000Z" }).kind, "replay_mismatch");
    assert.equal(value.repository.listActions(value.context, value.company.id, 10).length, 1);
    const action = value.repository.findAction(value.context, value.company.id, command.id)!;
    assert.equal(value.repository.requestCancel(value.context, value.company.id, action.id, { actorId: "usr_045", operationId: "cancel-045", expectedVersion: action.version, occurredAt: later }).kind, "cancelled");
    assert.equal(value.repository.requestCancel(value.context, value.company.id, action.id, { actorId: "usr_045", operationId: "cancel-045", expectedVersion: action.version, occurredAt: later }).kind, "replayed");
    assert.equal(value.repository.requestCancel(value.context, value.company.id, action.id, { actorId: "usr_045", operationId: "cancel-stale", expectedVersion: action.version, occurredAt: later }).kind, "stale_version");
    assert.equal(value.repository.requestCancel(value.context, value.company.id, action.id, { actorId: "usr_045", operationId: "cancel-stale", expectedVersion: action.version, occurredAt: later }).kind, "replayed_stale");
    assert.equal(value.repository.findAction(value.context, value.company.id, action.id)?.state, "cancelled");
    assert.equal((value.db.prepare("SELECT COUNT(*) AS count FROM proactive_action_audit_events WHERE proactive_action_id=?").get(action.id) as { count: number }).count, 2);
    assert.throws(() => value.db.prepare("UPDATE proactive_action_audit_events SET event_type='claimed'").run());
    assert.throws(() => value.db.prepare("DELETE FROM proactive_action_audit_events").run());
  } finally { value.db.close(); }
});

test("EPIC045 PASS2 enforces one proactive action per outbound delivery while preserving standard deliveries", () => {
  const value = setup();
  try {
    enable(value);
    const created = value.repository.createAction(value.context, value.company.id, createInput(value));
    assert.equal(created.kind, "created");
    assert.match((value.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='uq_outbound_deliveries_proactive_action'").get() as { sql: string }).sql, /WHERE proactive_action_id IS NOT NULL/);
    assert.ok(addOutboundDelivery(value, "action-a", created.action.id));
    assert.throws(() => addOutboundDelivery(value, "action-b", created.action.id));
    assert.ok(addOutboundDelivery(value, "standard-a"));
    assert.ok(addOutboundDelivery(value, "standard-b"));
    assert.equal((value.db.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries WHERE proactive_action_id IS NULL").get() as { count: number }).count, 2);
  } finally { value.db.close(); }
});

test("EPIC045 PASS2 derives the service-window evidence only from real bound WhatsApp inbound evidence", () => {
  const value = setup();
  try {
    const audioAt = "2026-08-28T12:20:00.000Z";
    addInboundEvidence(value, "02", audioAt, "[Audio message]");
    const synthetic = new ConversationRepository(value.db).createMessage(value.context, value.company.id, reconstructConversationMessage({ id: conversationMessageId(`cmsg_${"3".repeat(32)}`), conversationId: value.conversation.id, senderParticipantId: value.customer.id, direction: "inbound", content: "Synthetic", idempotencyKey: "synthetic-045", executionRecordId: null, createdAt: "2026-08-28T12:50:00.000Z" }))!;
    assert.ok(synthetic);
    const operator = new ConversationRepository(value.db).createParticipant(value.context, value.company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04500000000000000000000000000003"), conversationId: value.conversation.id, type: "human_operator", reference: "usr_045", createdAt: later }))!;
    assert.ok(new ConversationRepository(value.db).createMessage(value.context, value.company.id, reconstructConversationMessage({ id: conversationMessageId(`cmsg_${"4".repeat(32)}`), conversationId: value.conversation.id, senderParticipantId: operator.id, direction: "outbound", content: "Operator", idempotencyKey: "operator-045", executionRecordId: null, createdAt: "2026-08-28T12:40:00.000Z" })));
    assert.ok(addOutboundDelivery(value, "standard-window"));
    enable(value);
    const action = value.repository.createAction(value.context, value.company.id, createInput(value));
    assert.equal(action.kind, "created");
    assert.ok(addOutboundDelivery(value, "proactive-window", action.action.id));
    const foreignConversation = new ConversationRepository(value.db).createConversation(value.context, reconstructConversation({ id: conversationId("cnv_04500000000000000000000000000002"), companyId: value.company.id, channel: "whatsapp", state: "open", createdAt: at, updatedAt: at, closedAt: null }))!;
    const foreignCustomer = new ConversationRepository(value.db).createParticipant(value.context, value.company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04500000000000000000000000000004"), conversationId: foreignConversation.id, type: "whatsapp_contact", reference: "foreign-customer", createdAt: at }))!;
    const foreignAssistant = new ConversationRepository(value.db).createParticipant(value.context, value.company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04500000000000000000000000000005"), conversationId: foreignConversation.id, type: "assistant", reference: value.profileId, createdAt: at }))!;
    value.db.prepare("INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("wcb_04500000000000000000000000000002", value.connectionId, "foreign", foreignConversation.id, foreignCustomer.id, foreignAssistant.id, at, at);
    addInboundEvidence({ ...value, conversation: foreignConversation, customer: foreignCustomer }, "05", "2026-08-28T12:55:00.000Z", "Foreign");
    assert.equal(value.repository.latestCustomerInboundAt(value.context, value.company.id, value.conversation.id, value.connectionId), audioAt);
    assert.equal(value.repository.latestCustomerInboundAt(value.context, value.company.id, value.conversation.id, "wac_045_foreign"), null);
  } finally { value.db.close(); }
});

test("EPIC045 PASS2 policy backfill and future-Company seed are durable without read fabrication", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-policy-")), path = join(directory, "atlas.sqlite");
  let db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys=ON"); runMigrations(db, 62);
    const context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()), companies = new CompanyRepository(db), historical = companies.create(context, { name: "Historical", website: "https://historical.test" });
    runMigrations(db);
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(historical.id) as { enabled: number; version: number }).enabled, 0);
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(historical.id) as { enabled: number; version: number }).version, 1);
    const future = companies.create(context, { name: "Future", website: "https://future.test" }), repository = new ProactiveActionRepository(db);
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(future.id) as { enabled: number; version: number }).enabled, 0);
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(future.id) as { enabled: number; version: number }).version, 1);
    assert.equal(repository.findPolicy(context, future.id)?.version, 1);
    db.prepare("DELETE FROM proactive_action_policies WHERE company_id=?").run(future.id);
    assert.equal(repository.findPolicy(context, future.id), null);
    assert.equal(db.prepare("SELECT 1 FROM proactive_action_policies WHERE company_id=?").get(future.id), undefined);
    db.close(); db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db);
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(historical.id) as { enabled: number; version: number }).version, 1);
  } finally { if (db.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS2 rejects foreign binding/profile/action scope through repository and triggers", () => {
  const value = setup();
  try {
    enable(value);
    assert.equal(value.repository.createAction(value.context, value.company.id, { ...createInput(value), assistantProfileId: "apr_missing" }).kind, "not_found");
    assert.throws(() => value.db.prepare("INSERT INTO proactive_actions(id,workspace_id,company_id,conversation_id,whatsapp_connection_id,assistant_profile_id,assistant_participant_id,intent_kind,run_at,state,expected_authority_generation,attempt_count,next_attempt_at,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'follow_up',?,'scheduled',?,0,?,1,?,?)").run("pac_04500000000000000000000000000009", value.context.workspaceId, value.company.id, value.conversation.id, value.connectionId, value.profileId, value.customer.id, later, 1, later, at, at));
  } finally { value.db.close(); }
});

test("EPIC045 PASS2 preserves outbound rowids on 0062 upgrade and restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-upgrade-")), path = join(directory, "atlas.sqlite");
  let db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys=ON"); runMigrations(db, 62);
    const context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()), company = new CompanyRepository(db).create(context, { name: "Upgrade", website: "https://upgrade.test" });
    db.prepare("INSERT INTO conversations(id,company_id,channel,state,created_at,updated_at,closed_at) VALUES(?,?,?,'open',?,?,NULL)").run("cnv_045upgrade000000000000000000000", company.id, "whatsapp", at, at);
    db.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) VALUES(?,?,?,?,?)").run("cpt_045upgrade000000000000000000000", "cnv_045upgrade000000000000000000000", "assistant", "assistant", at);
    db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,'outbound','Upgrade',NULL,NULL,?)").run("cmsg_045upgrade00000000000000000000", "cnv_045upgrade000000000000000000000", "cpt_045upgrade000000000000000000000", at);
    db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_045upgrade0000000000000000000000", "whatsapp", "meta", "outbound", "connection", "cmsg_045upgrade00000000000000000000", null, at, at);
    db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?)").run("odl_045upgrade0000000000000000000000", "pmr_045upgrade0000000000000000000000", "connection", at, at, at);
    const before = (db.prepare("SELECT rowid FROM outbound_deliveries").get() as { rowid: number }).rowid;
    runMigrations(db);
    assert.equal((db.prepare("SELECT rowid FROM outbound_deliveries").get() as { rowid: number }).rowid, before);
    assert.equal((db.prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as { id: number; name: string }).name, "0068_billing_operations_provider_events_reconciliation");
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(company.id) as { enabled: number; version: number }).version, 1);
    const next = new CompanyRepository(db).create(context, { name: "Upgrade next", website: "https://upgrade-next.test" });
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(next.id) as { enabled: number; version: number }).version, 1);
    db.close(); db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db);
    assert.equal((db.prepare("SELECT rowid FROM outbound_deliveries").get() as { rowid: number }).rowid, before);
    assert.equal((db.prepare("SELECT enabled,version FROM proactive_action_policies WHERE company_id=?").get(next.id) as { enabled: number; version: number }).version, 1);
    db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,'outbound','Next',NULL,NULL,?)").run("cmsg_045upgrade0000000000000000000001", "cnv_045upgrade000000000000000000000", "cpt_045upgrade000000000000000000000", later);
    db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_045upgrade0000000000000000000001", "whatsapp", "meta", "outbound", "connection", "cmsg_045upgrade0000000000000000000001", null, later, later);
    db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?)").run("odl_045upgrade0000000000000000000001", "pmr_045upgrade0000000000000000000001", "connection", later, later, later);
    assert.equal((db.prepare("SELECT rowid FROM outbound_deliveries WHERE id='odl_045upgrade0000000000000000000001'").get() as { rowid: number }).rowid, before + 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { if (db.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS2 uses SQLite CAS and exact replay across two connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-race-")), path = join(directory, "atlas.sqlite"), first = setup(path);
  let second: DatabaseSync | null = null;
  try {
    first.repository.applyPolicy(first.context, first.company.id, { actorId: "usr_045", operationId: "policy-enable", expectedVersion: 1, enabled: true, occurredAt: at });
    second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON"); const other = new ProactiveActionRepository(second);
    const winner = first.repository.applyPolicy(first.context, first.company.id, { actorId: "usr_045", operationId: "policy-race-a", expectedVersion: 2, enabled: false, occurredAt: later });
    const loser = other.applyPolicy(first.context, first.company.id, { actorId: "usr_045", operationId: "policy-race-b", expectedVersion: 2, enabled: false, occurredAt: later });
    assert.equal(winner.kind, "applied"); assert.equal(loser.kind, "stale_version");
    first.repository.applyPolicy(first.context, first.company.id, { actorId: "usr_045", operationId: "policy-enable-again", expectedVersion: 3, enabled: true, occurredAt: later });
    const command = createInput(first, "pac_04500000000000000000000000000003", "create-race");
    assert.equal(first.repository.createAction(first.context, first.company.id, command).kind, "created");
    assert.equal(other.createAction(first.context, first.company.id, command).kind, "replayed");
    assert.equal((first.db.prepare("SELECT COUNT(*) AS count FROM proactive_actions").get() as { count: number }).count, 1);
  } finally { second?.close(); first.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC045 PASS2 Company teardown cascades without permitting direct action deletion", () => {
  const value = setup();
  try {
    enable(value); const created = value.repository.createAction(value.context, value.company.id, createInput(value)); assert.equal(created.kind, "created");
    const id = created.action.id;
    assert.throws(() => value.db.prepare("DELETE FROM proactive_actions WHERE id=?").run(id));
    value.db.prepare("DELETE FROM companies WHERE id=?").run(value.company.id);
    assert.equal(value.db.prepare("SELECT * FROM proactive_actions WHERE id=?").get(id), undefined);
  } finally { value.db.close(); }
});
