import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { ConversationClosedError, ConversationNotFoundError, ConversationService } from "../conversation/services/conversationService.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

class TestClock {
  private index = 0;
  public now(): string { return `2026-07-23T12:00:0${this.index++}.000Z`; }
}

function setup() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), companies = new CompanyRepository(database);
  const primary = createWorkspaceContext(workspaces.resolveDefault());
  const secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" }));
  const primaryCompany = companies.create(primary, { name: "Primary", website: "https://primary.test" });
  const secondaryCompany = companies.create(secondary, { name: "Secondary", website: "https://secondary.test" });
  return { database, primary, secondary, primaryCompany, secondaryCompany, service: new ConversationService(new ConversationRepository(database), new TestClock()) };
}

test("EPIC-016.2.2 opens conversations, adds neutral participants, and returns messages chronologically", () => {
  const { database, primary, primaryCompany, service } = setup();
  try {
    const conversation = service.open(primary, primaryCompany.id);
    const participant = service.addParticipant(primary, primaryCompany.id, conversation.id, { type: "opaque-contact", reference: "customer-42" });
    const first = service.addMessage(primary, primaryCompany.id, conversation.id, { senderParticipantId: participant.id, direction: "inbound", content: "First" });
    const second = service.addMessage(primary, primaryCompany.id, conversation.id, { senderParticipantId: participant.id, direction: "outbound", content: "Second" });
    assert.equal(conversation.state, "open");
    assert.equal(participant.type, "opaque-contact");
    assert.deepEqual(service.listMessages(primary, primaryCompany.id, conversation.id).map(({ id, direction }) => ({ id, direction })), [
      { id: first.id, direction: "inbound" }, { id: second.id, direction: "outbound" },
    ]);
  } finally { database.close(); }
});

test("EPIC-016.2.2 closes explicitly and rejects further messages", () => {
  const { database, primary, primaryCompany, service } = setup();
  try {
    const conversation = service.open(primary, primaryCompany.id);
    const participant = service.addParticipant(primary, primaryCompany.id, conversation.id, { type: "opaque" });
    const closed = service.close(primary, primaryCompany.id, conversation.id);
    assert.equal(closed.state, "closed");
    assert.ok(closed.closedAt);
    assert.throws(() => service.addMessage(primary, primaryCompany.id, conversation.id, { senderParticipantId: participant.id, direction: "inbound", content: "Too late" }), ConversationClosedError);
    assert.throws(() => service.close(primary, primaryCompany.id, conversation.id), ConversationClosedError);
  } finally { database.close(); }
});

test("EPIC-016.2.2 rejects Company ownership mismatches", () => {
  const { database, primary, secondary, primaryCompany, secondaryCompany, service } = setup();
  try {
    const conversation = service.open(primary, primaryCompany.id);
    const participant = service.addParticipant(primary, primaryCompany.id, conversation.id, { type: "opaque" });
    assert.throws(() => service.get(secondary, primaryCompany.id, conversation.id), ConversationNotFoundError);
    assert.throws(() => service.addParticipant(secondary, primaryCompany.id, conversation.id, { type: "opaque" }), ConversationNotFoundError);
    assert.throws(() => service.addMessage(primary, secondaryCompany.id, conversation.id, { senderParticipantId: participant.id, direction: "inbound", content: "Denied" }), ConversationNotFoundError);
    assert.throws(() => service.open(primary, secondaryCompany.id), ConversationNotFoundError);
  } finally { database.close(); }
});
