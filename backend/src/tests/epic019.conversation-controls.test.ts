import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";
import { ConversationControlDomainError, reconstructConversationControl } from "../conversation/domain/conversationControl.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const at = "2026-07-28T12:00:00.000Z";
const later = "2026-07-28T12:01:00.000Z";
const latest = "2026-07-28T12:02:00.000Z";

function setup() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), primary = createWorkspaceContext(workspaces.resolveDefault()), secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" })), companies = new CompanyRepository(database), first = companies.create(primary, { name: "First", website: "https://first.test" }), second = companies.create(primary, { name: "Second", website: "https://second.test" }), foreign = companies.create(secondary, { name: "Foreign", website: "https://foreign.test" }), conversations = new ConversationRepository(database);
  return { database, primary, secondary, first, second, foreign, conversations };
}

function createConversation(repository: ConversationRepository, context: ReturnType<typeof createWorkspaceContext>, companyId: number, id = conversationId("cnv_0123456789abcdef0123456789abcdef"), channel: "internal" | "web_chat" | "whatsapp" = "whatsapp") {
  return repository.createConversation(context, reconstructConversation({ id, companyId, channel, state: "open", createdAt: at, updatedAt: at, closedAt: null }))!;
}

test("EPIC-019 validates conversation control invariants", () => {
  const base = { conversationId: conversationId("cnv_0123456789abcdef0123456789abcdef"), state: "automated" as const, controllingActorId: null, lastControllingActorId: null, takenAt: null, releasedAt: null, lastOperatorActivityAt: null, attentionReason: null, resolvedAt: null, resolvedBy: null, version: 1, createdAt: at, updatedAt: at };
  assert.ok(Object.isFrozen(reconstructConversationControl(base)));
  assert.throws(() => reconstructConversationControl({ ...base, state: "human_controlled", controllingActorId: null }), ConversationControlDomainError);
  assert.throws(() => reconstructConversationControl({ ...base, controllingActorId: "operator" as never }), ConversationControlDomainError);
  assert.throws(() => reconstructConversationControl({ ...base, resolvedAt: later }), ConversationControlDomainError);
  assert.throws(() => reconstructConversationControl({ ...base, version: 0 }), ConversationControlDomainError);
  assert.throws(() => reconstructConversationControl({ ...base, attentionReason: "provider_payload" as never }), ConversationControlDomainError);
  assert.throws(() => reconstructConversationControl({ ...base, takenAt: later, releasedAt: at }), ConversationControlDomainError);
});

test("EPIC-019 migration is additive and leaves existing conversations unchanged until lazy control ensure", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    runMigrations(database, 22);
    const workspace = database.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number };
    database.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,created_at) VALUES(?,?,?,?,?,?,?)").run(workspace.id, "Existing", "https://existing.test", "", "", "ready", at);
    database.prepare("INSERT INTO conversations(id,company_id,state,created_at,updated_at,closed_at,channel) VALUES(?,?,?,?,?,?,?)").run("cnv_ffffffffffffffffffffffffffffffff", 1, "open", at, at, null, "whatsapp");
    runMigrations(database);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_controls").get() as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT channel FROM conversations WHERE id=?").get("cnv_ffffffffffffffffffffffffffffffff") as { channel: string }).channel, "whatsapp");
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_conversation_controls_state_updated'").get());
  } finally { database.close(); }
});

test("EPIC-019 lazily ensures one default control row and uses optimistic control and resolution updates", () => {
  const value = setup();
  try {
    const conversation = createConversation(value.conversations, value.primary, value.first.id);
    const initial = value.conversations.ensureConversationControl(value.primary, value.first.id, conversation.id)!;
    assert.deepEqual(initial, reconstructConversationControl({ conversationId: conversation.id, state: "automated", controllingActorId: null, lastControllingActorId: null, takenAt: null, releasedAt: null, lastOperatorActivityAt: null, attentionReason: null, resolvedAt: null, resolvedBy: null, version: 1, createdAt: at, updatedAt: at }));
    assert.equal(value.conversations.ensureConversationControl(value.primary, value.first.id, conversation.id)!.version, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_controls").get() as { count: number }).count, 1);
    const controlled = reconstructConversationControl({ ...initial, state: "human_controlled", controllingActorId: "operator-1" as never, lastControllingActorId: "operator-1" as never, takenAt: later, attentionReason: "customer_request", version: 2, updatedAt: later });
    assert.equal(value.conversations.updateConversationControl(value.primary, value.first.id, controlled, 1)?.version, 2);
    assert.equal(value.conversations.updateConversationControl(value.primary, value.first.id, controlled, 1), null);
    const resolved = value.conversations.updateConversationResolution(value.primary, value.first.id, conversation.id, 2, latest, "operator-1", latest)!;
    assert.equal(resolved.resolvedBy, "operator-1");
    const projected = value.conversations.listConversationInbox(value.primary, value.first.id)[0]!;
    assert.deepEqual([projected.controlState, projected.attentionReason, projected.controllingActorId, projected.takenAt, projected.releasedAt, projected.lastOperatorActivityAt, projected.resolvedAt, projected.resolvedBy, projected.controlVersion, projected.updatedAt], ["human_controlled", "customer_request", "masked", later, null, null, latest, "masked", 3, latest]);
    assert.equal(value.conversations.clearConversationResolution(value.primary, value.first.id, conversation.id, 2, latest), null);
    assert.equal(value.conversations.clearConversationResolution(value.primary, value.first.id, conversation.id, 3, latest)?.resolvedAt, null);
  } finally { value.database.close(); }
});

test("EPIC-019 scopes control and safe inbox/detail projections by Company and workspace", () => {
  const value = setup();
  try {
    const first = createConversation(value.conversations, value.primary, value.first.id);
    const second = createConversation(value.conversations, value.primary, value.second.id, conversationId("cnv_1123456789abcdef0123456789abcdef"), "web_chat");
    const foreign = createConversation(value.conversations, value.secondary, value.foreign.id, conversationId("cnv_2123456789abcdef0123456789abcdef"));
    const customer = value.conversations.createParticipant(value.primary, value.first.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_0123456789abcdef0123456789abcdef"), conversationId: first.id, type: "whatsapp_contact", reference: "+15551234567", createdAt: at }))!;
    const assistant = value.conversations.createParticipant(value.primary, value.first.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_1123456789abcdef0123456789abcdef"), conversationId: first.id, type: "assistant", reference: "provider-secret", createdAt: at }))!;
    value.conversations.createMessage(value.primary, value.first.id, reconstructConversationMessage({ id: conversationMessageId("cmsg_0123456789abcdef0123456789abcdef"), conversationId: first.id, senderParticipantId: customer.id, direction: "inbound", content: "A".repeat(400), idempotencyKey: null, executionRecordId: null, createdAt: at }));
    value.conversations.createMessage(value.primary, value.first.id, reconstructConversationMessage({ id: conversationMessageId("cmsg_1123456789abcdef0123456789abcdef"), conversationId: first.id, senderParticipantId: assistant.id, direction: "outbound", content: "Reply", idempotencyKey: null, executionRecordId: null, createdAt: later }));
    assert.equal(value.conversations.findConversationControl(value.secondary, value.first.id, first.id), null);
    assert.equal(value.conversations.ensureConversationControl(value.primary, value.second.id, first.id), null);
    const inbox = value.conversations.listConversationInbox(value.primary, value.first.id);
    assert.deepEqual(inbox.map((entry) => [entry.conversationId, entry.participant, entry.preview, entry.deliveryCategory]), [[first.id, "masked", "Reply", "sent"]]);
    assert.deepEqual(inbox.map((entry) => [entry.controlState, entry.attentionReason, entry.controllingActorId, entry.takenAt, entry.releasedAt, entry.lastOperatorActivityAt, entry.resolvedAt, entry.resolvedBy, entry.controlVersion, entry.updatedAt]), [["automated", null, null, null, null, null, null, null, 1, at]]);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_controls WHERE conversation_id=?").get(first.id) as { count: number }).count, 1);
    assert.deepEqual(value.conversations.listConversationInbox(value.secondary, value.foreign.id).map((entry) => entry.conversationId), [foreign.id]);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_controls WHERE conversation_id=?").get(foreign.id) as { count: number }).count, 1);
    assert.equal(value.conversations.findConversationDetail(value.primary, value.second.id, first.id), null);
    assert.equal(value.conversations.findConversationDetail(value.primary, value.first.id, second.id), null);
    assert.equal(value.conversations.findConversationDetail(value.primary, value.second.id, second.id)?.controlState, "automated");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_controls WHERE conversation_id=?").get(second.id) as { count: number }).count, 1);
    const detail = value.conversations.findConversationDetail(value.primary, value.first.id, first.id)!;
    assert.deepEqual([detail.controlState, detail.attentionReason, detail.controllingActorId, detail.takenAt, detail.releasedAt, detail.lastOperatorActivityAt, detail.resolvedAt, detail.resolvedBy, detail.controlVersion, detail.updatedAt], ["automated", null, null, null, null, null, null, null, 1, at]);
    assert.deepEqual(detail.messages.map((message) => [message.deliveryCategory, message.content, message.participant]), [["received", "A".repeat(400), "masked"], ["sent", "Reply", "masked"]]);
    assert.equal(JSON.stringify(detail).includes("15551234567"), false);
    assert.equal(JSON.stringify(detail).includes("provider-secret"), false);
    assert.equal(second.channel, "web_chat");
  } finally { value.database.close(); }
});
