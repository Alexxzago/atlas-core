import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const createdAt = "2026-07-23T12:00:00.000Z";
const updatedAt = "2026-07-23T12:01:00.000Z";
const closedAt = "2026-07-23T12:02:00.000Z";

function setup() {
  const database = createDatabase(":memory:");
  const workspaces = new WorkspaceRepository(database);
  const companies = new CompanyRepository(database);
  const primary = createWorkspaceContext(workspaces.resolveDefault());
  const secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" }));
  const primaryCompany = companies.create(primary, { name: "Primary", website: "https://primary.test" });
  const secondaryCompany = companies.create(secondary, { name: "Secondary", website: "https://secondary.test" });
  return { database, companies, conversations: new ConversationRepository(database), primary, secondary, primaryCompany, secondaryCompany };
}

function conversation(companyId: number, id = conversationId("cnv_00000000000000000000000000000001"), state: "open" | "closed" = "open") {
  return reconstructConversation({ id, companyId, state, createdAt, updatedAt: state === "open" ? createdAt : updatedAt, closedAt: state === "open" ? null : closedAt });
}

function participant(conversationIdentifier: ReturnType<typeof conversationId>, id = conversationParticipantId("cpt_00000000000000000000000000000001")) {
  return reconstructConversationParticipant({ id, conversationId: conversationIdentifier, type: "contact", reference: "contact-123", createdAt });
}

function message(conversationIdentifier: ReturnType<typeof conversationId>, senderParticipantId: ReturnType<typeof conversationParticipantId>, id = conversationMessageId("cmsg_00000000000000000000000000000001")) {
  return reconstructConversationMessage({ id, conversationId: conversationIdentifier, senderParticipantId, direction: "inbound", content: "Hello", idempotencyKey: null, executionRecordId: null, createdAt });
}

test("EPIC-016.2 persists neutral conversations, participants, and messages scoped to their Company", () => {
  const { database, conversations, primary, primaryCompany } = setup();
  try {
    const created = conversations.createConversation(primary, conversation(primaryCompany.id));
    assert.equal(created?.state, "open");
    const sender = conversations.createParticipant(primary, primaryCompany.id, participant(created!.id));
    assert.equal(sender?.type, "contact");
    const storedMessage = conversations.createMessage(primary, primaryCompany.id, message(created!.id, sender!.id));
    assert.equal(storedMessage?.direction, "inbound");
    assert.deepEqual(conversations.listConversations(primary, primaryCompany.id).map(({ id }) => id), [created!.id]);
    assert.deepEqual(conversations.listParticipants(primary, primaryCompany.id, created!.id).map(({ id }) => id), [sender!.id]);
    assert.deepEqual(conversations.listMessages(primary, primaryCompany.id, created!.id).map(({ id }) => id), [storedMessage!.id]);
  } finally { database.close(); }
});

test("EPIC-016.2 prevents cross-workspace access and mismatched message senders", () => {
  const { database, conversations, primary, secondary, primaryCompany, secondaryCompany } = setup();
  try {
    const primaryConversation = conversations.createConversation(primary, conversation(primaryCompany.id))!;
    const secondaryConversation = conversations.createConversation(secondary, conversation(secondaryCompany.id, conversationId("cnv_00000000000000000000000000000002")))!;
    const secondaryParticipant = conversations.createParticipant(secondary, secondaryCompany.id, participant(secondaryConversation.id, conversationParticipantId("cpt_00000000000000000000000000000002")))!;
    assert.equal(conversations.findConversation(secondary, primaryCompany.id, primaryConversation.id), null);
    assert.equal(conversations.createParticipant(secondary, primaryCompany.id, participant(primaryConversation.id)), null);
    assert.equal(conversations.createMessage(primary, primaryCompany.id, message(primaryConversation.id, secondaryParticipant.id)), null);
  } finally { database.close(); }
});

test("EPIC-016.2 closes open conversations once and cascades Company deletion", () => {
  const { database, companies, conversations, primary, primaryCompany } = setup();
  try {
    const open = conversations.createConversation(primary, conversation(primaryCompany.id))!;
    const sender = conversations.createParticipant(primary, primaryCompany.id, participant(open.id))!;
    conversations.createMessage(primary, primaryCompany.id, message(open.id, sender.id));
    const closed = conversation(primaryCompany.id, open.id, "closed");
    assert.equal(conversations.updateConversation(primary, primaryCompany.id, closed, "open"), true);
    assert.equal(conversations.updateConversation(primary, primaryCompany.id, closed, "open"), false);
    assert.equal(companies.delete(primary, primaryCompany.id), true);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversations").get() as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_participants").get() as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_messages").get() as { count: number }).count, 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});
