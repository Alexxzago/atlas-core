import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { ProactiveActionRepository } from "../repositories/proactiveActionRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { ProactiveDueWorkerService } from "../proactive/services/proactiveDueWorkerService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";

const inboundAt = "2026-08-28T12:00:00.000Z";

function fixture(path = ":memory:") {
  const db = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()), company = new CompanyRepository(db).create(context, { name: "PASS3", website: "https://pass3.test" }), conversations = new ConversationRepository(db);
  const conversation = conversations.createConversation(context, reconstructConversation({ id: conversationId("cnv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), companyId: company.id, channel: "whatsapp", state: "open", createdAt: inboundAt, updatedAt: inboundAt, closedAt: null }))!;
  const customer = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), conversationId: conversation.id, type: "whatsapp_contact", reference: "customer", createdAt: inboundAt }))!;
  const assistant = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), conversationId: conversation.id, type: "assistant", reference: "apr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", createdAt: inboundAt }))!;
  const profileId = "apr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", connectionId = "wac_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run(profileId, company.id, "PASS3", "pass3", "professional", "en", "Fallback", "ready", inboundAt, inboundAt);
  db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, company.id, profileId, "phone-pass3", "business-pass3", "active", inboundAt, inboundAt);
  db.prepare("INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("wcb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", connectionId, "customer", conversation.id, customer.id, assistant.id, inboundAt, inboundAt);
  conversations.ensureConversationControl(context, company.id, conversation.id);
  addInbound({ db, context, company, conversation, customer, connectionId }, "1", inboundAt);
  const repository = new ProactiveActionRepository(db);
  assert.equal(repository.applyPolicy(context, company.id, { actorId: "usr_pass3", operationId: "enable-pass3", expectedVersion: 1, enabled: true, occurredAt: inboundAt }).kind, "applied");
  return { db, context, company, conversation, customer, assistant, profileId, connectionId, repository };
}

function addInbound(value: { db: ReturnType<typeof createDatabase>; context: ReturnType<typeof createWorkspaceContext>; company: { id: number }; conversation: { id: string }; customer: { id: string }; connectionId: string }, suffix: string, at: string): void {
  const id = conversationMessageId(`cmsg_${suffix.padStart(32, "0")}`), message = new ConversationRepository(value.db).createMessage(value.context, value.company.id, reconstructConversationMessage({ id, conversationId: value.conversation.id as never, senderParticipantId: value.customer.id as never, direction: "inbound", content: suffix === "audio" ? "[Audio message]" : "Inbound", idempotencyKey: `inbound-${suffix}`, executionRecordId: null, createdAt: at }))!;
  value.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)").run(`cpe_${suffix}`, "whatsapp", "meta_whatsapp_cloud", value.connectionId, `event-${suffix}`, value.conversation.id, message.id, at, at);
  value.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(`pmr_${suffix}`, "whatsapp", "meta_whatsapp_cloud", "inbound", value.connectionId, message.id, `wamid-${suffix}`, at, at);
}

function action(value: ReturnType<typeof fixture>, digit: string, runAt: string) {
  const result = value.repository.createAction(value.context, value.company.id, { id: `pac_${digit.repeat(32)}`, actorId: "usr_pass3", operationId: `create-${digit}`, conversationId: value.conversation.id, whatsAppConnectionId: value.connectionId, assistantProfileId: value.profileId, assistantParticipantId: value.assistant.id, runAt, expectedAuthorityGeneration: 1, occurredAt: inboundAt });
  assert.equal(result.kind, "created");
  return result.action;
}

function worker(value: ReturnType<typeof fixture>, now: string) { return new ProactiveDueWorkerService(value.repository, { now: () => now }); }

test("EPIC045 PASS3 promotes due actions in deterministic order and never claims future work", () => {
  const value = fixture();
  try {
    const future = action(value, "f", "2026-08-28T13:00:00.000Z"), later = action(value, "b", "2026-08-28T12:20:00.000Z"), immediate = action(value, "a", inboundAt);
    const leases = worker(value, "2026-08-28T12:30:00.000Z").claimDue("worker-a");
    assert.deepEqual(leases.map((lease) => lease.action.id), [immediate.id, later.id]);
    assert.equal(value.repository.findAction(value.context, value.company.id, future.id)?.state, "scheduled");
  } finally { value.db.close(); }
});

test("EPIC045 PASS3 suppresses policy, service-window, assignment, authority, conversation, and binding fences", () => {
  const cases: Array<{ readonly mutate: (value: ReturnType<typeof fixture>) => void; readonly reason: string }> = [
    { mutate: (value) => { value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_pass3", operationId: "disable", expectedVersion: 2, enabled: false, occurredAt: inboundAt }); }, reason: "proactive_policy_disabled" },
    { mutate: (value) => { value.db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run("apr_cccccccccccccccccccccccccccccccc", value.company.id, "Changed", "changed", "professional", "en", "Fallback", "ready", inboundAt, inboundAt); value.db.prepare("UPDATE whatsapp_connections SET assistant_profile_id='apr_cccccccccccccccccccccccccccccccc' WHERE id=?").run(value.connectionId); }, reason: "assistant_assignment_changed" },
    { mutate: (value) => { value.db.prepare("UPDATE conversation_controls SET state='human_controlled',controlling_actor_id='usr_pass3',taken_at=?,authority_generation=2 WHERE conversation_id=?").run(inboundAt, value.conversation.id); }, reason: "authority_lost" },
    { mutate: (value) => { value.db.prepare("UPDATE conversations SET state='closed',closed_at=? WHERE id=?").run(inboundAt, value.conversation.id); }, reason: "conversation_closed" },
    { mutate: (value) => { value.db.prepare("UPDATE whatsapp_conversation_bindings SET assistant_participant_id=? WHERE conversation_id=?").run(value.customer.id, value.conversation.id); }, reason: "whatsapp_binding_invalid" },
  ];
  for (const [index, item] of cases.entries()) {
    const value = fixture();
    try { const created = action(value, (index + 1).toString(16), "2026-08-28T12:10:00.000Z"); item.mutate(value); worker(value, "2026-08-28T12:20:00.000Z").recoverAvailable(); const saved = value.repository.findAction(value.context, value.company.id, created.id)!; assert.equal(saved.state, "suppressed"); assert.equal(saved.safeReasonCode, item.reason); if (item.reason === "assistant_assignment_changed") { value.db.prepare("UPDATE whatsapp_connections SET assistant_profile_id=? WHERE id=?").run(value.profileId, value.connectionId); worker(value, "2026-08-28T12:21:00.000Z").recoverAvailable(); assert.equal(value.repository.findAction(value.context, value.company.id, created.id)?.state, "suppressed"); } } finally { value.db.close(); }
  }
  const expired = fixture();
  try { const created = action(expired, "e", "2026-08-28T12:10:00.000Z"); worker(expired, "2026-08-29T12:00:00.000Z").recoverAvailable(); assert.equal(expired.repository.findAction(expired.context, expired.company.id, created.id)?.safeReasonCode, "whatsapp_service_window_closed"); } finally { expired.db.close(); }
});

test("EPIC045 PASS3 retries token-fenced transient work with bounded exponential backoff", () => {
  const value = fixture();
  try {
    const created = action(value, "c", inboundAt), service = worker(value, inboundAt), first = service.claimDue("worker-a")[0]!;
    const retry = value.repository.scheduleRetry(first, inboundAt, "worker_transient")!;
    assert.equal(retry.state, "retryable"); assert.equal(retry.nextAttemptAt, "2026-08-28T12:00:02.000Z");
    assert.equal(worker(value, "2026-08-28T12:00:01.000Z").claimDue("worker-b").length, 0);
    let lease = worker(value, retry.nextAttemptAt).claimDue("worker-b")[0]!;
    for (let attempt = 0; attempt < 4; attempt += 1) { const saved = value.repository.scheduleRetry(lease, lease.action.leaseAcquiredAt!, "worker_transient")!; if (saved.state === "permanent_failure") break; lease = worker(value, saved.nextAttemptAt).claimDue("worker-b")[0]!; }
    assert.equal(value.repository.findAction(value.context, value.company.id, created.id)?.state, "permanent_failure");
  } finally { value.db.close(); }
});

test("EPIC045 PASS3 revalidates the latest real inbound and never reactivates terminal suppression", () => {
  const value = fixture();
  try {
    addInbound(value, "2", "2026-08-29T11:00:00.000Z");
    const created = action(value, "8", "2026-08-29T11:30:00.000Z");
    worker(value, "2026-08-29T11:30:00.000Z").recoverAvailable();
    assert.equal(value.repository.findAction(value.context, value.company.id, created.id)?.state, "ready");
    const justInside = action(value, "7", "2026-08-30T10:59:59.999Z");
    worker(value, "2026-08-30T10:59:59.999Z").recoverAvailable();
    assert.equal(value.repository.findAction(value.context, value.company.id, justInside.id)?.state, "ready");
    const expired = action(value, "6", "2026-08-30T10:59:58.000Z");
    worker(value, "2026-08-30T11:00:00.000Z").recoverAvailable();
    assert.equal(value.repository.findAction(value.context, value.company.id, expired.id)?.state, "suppressed");
    addInbound(value, "3", "2026-08-30T11:01:00.000Z");
    worker(value, "2026-08-30T11:02:00.000Z").recoverAvailable();
    assert.equal(value.repository.findAction(value.context, value.company.id, expired.id)?.state, "suppressed");
  } finally { value.db.close(); }
});

test("EPIC045 PASS3 suppresses retryable work when policy changes before its backoff", () => {
  const value = fixture();
  try {
    const created = action(value, "5", inboundAt), lease = worker(value, inboundAt).claimDue("worker-a")[0]!, retry = value.repository.scheduleRetry(lease, inboundAt, "worker_transient")!;
    value.repository.applyPolicy(value.context, value.company.id, { actorId: "usr_pass3", operationId: "disable-retry", expectedVersion: 2, enabled: false, occurredAt: inboundAt });
    worker(value, retry.nextAttemptAt).recoverAvailable();
    assert.equal(value.repository.findAction(value.context, value.company.id, created.id)?.safeReasonCode, "proactive_policy_disabled");
  } finally { value.db.close(); }
});

test("EPIC045 PASS3 cancellation wins before runtime and stale leased workers cannot mutate", () => {
  const value = fixture();
  try {
    const created = action(value, "d", inboundAt), lease = worker(value, inboundAt).claimDue("worker-a")[0]!, current = value.repository.findAction(value.context, value.company.id, created.id)!;
    assert.equal(value.repository.requestCancel(value.context, value.company.id, created.id, { actorId: "usr_pass3", operationId: "cancel-leased", expectedVersion: current.version, occurredAt: inboundAt }).kind, "cancelled");
    assert.equal(value.repository.validateClaim(lease, inboundAt), "stale");
    assert.equal(value.repository.scheduleRetry(lease, inboundAt, "worker_transient"), null);
    assert.equal(value.repository.requestCancel(value.context, value.company.id, created.id, { actorId: "usr_pass3", operationId: "cancel-stale", expectedVersion: current.version, occurredAt: inboundAt }).kind, "stale_version");
  } finally { value.db.close(); }
});

test("EPIC045 PASS3 uses SQLite leases across connections and recovers expired file-backed leases once", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic045-pass3-")), path = join(directory, "atlas.sqlite"), first = fixture(path);
  let second: DatabaseSync | null = null;
  try {
    const created = action(first, "9", inboundAt), firstLease = worker(first, inboundAt).claimDue("worker-a")[0]!;
    second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON"); const other = new ProactiveActionRepository(second);
    assert.equal(other.claimDue("worker-b", inboundAt, "2026-08-28T12:01:00.000Z", 25).length, 0);
    first.db.close(); second.close(); second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON"); const recovered = new ProactiveActionRepository(second).claimDue("worker-c", "2026-08-28T12:01:01.000Z", "2026-08-28T12:02:01.000Z", 25);
    assert.equal(recovered.length, 1); assert.notEqual(recovered[0]!.leaseToken, firstLease.leaseToken);
    assert.equal(new ProactiveActionRepository(second).scheduleRetry(firstLease, "2026-08-28T12:01:01.000Z", "worker_transient"), null);
    assert.equal(new ProactiveActionRepository(second).findAction(first.context, first.company.id, created.id)?.state, "leased");
  } finally { if (first.db.isOpen) first.db.close(); if (second?.isOpen) second.close(); rmSync(directory, { recursive: true, force: true }); }
});
