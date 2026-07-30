import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";

const at = "2026-07-29T12:00:00.000Z";

test("EPIC-020 conversation projections expose only safe outbound WhatsApp lifecycle data", () => {
  const database = createDatabase(":memory:");
  try {
    const workspaces = new WorkspaceRepository(database), context = createWorkspaceContext(workspaces.resolveDefault());
    const company = new CompanyRepository(database).create(context, { name: "Acme", website: "https://acme.test" })!;
    const repository = new ConversationRepository(database);
    const conversation = repository.createConversation(context, reconstructConversation({ id: conversationId("cnv_0123456789abcdef0123456789abcdef"), companyId: company.id, channel: "whatsapp", state: "open", createdAt: at, updatedAt: at, closedAt: null }))!;
    const assistant = repository.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_0123456789abcdef0123456789abcdef"), conversationId: conversation.id, type: "assistant", reference: "secret-profile", createdAt: at }))!;
    const message = repository.createMessage(context, company.id, reconstructConversationMessage({ id: conversationMessageId("cmsg_0123456789abcdef0123456789abcdef"), conversationId: conversation.id, senderParticipantId: assistant.id, direction: "outbound", content: "Reply", idempotencyKey: null, executionRecordId: null, createdAt: at }))!;
    database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,description,business_role,objective,audience,tone,assistant_language,welcome_message,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("asp_0123456789abcdef0123456789abcdef", company.id, "Assistant", "assistant", null, null, null, null, "professional", "en", null, "Fallback", "ready", at, at, null);
    database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("wac_0123456789abcdef0123456789abcdef", context.workspaceId, company.id, "asp_0123456789abcdef0123456789abcdef", "phone", "waba", "active", at, at);
    database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_0123456789abcdef0123456789abcdef", "whatsapp", "meta_whatsapp_cloud", "outbound", "wac_0123456789abcdef0123456789abcdef", message.id, "wamid-secret", at, at);
    database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("odl_0123456789abcdef0123456789abcdef", "pmr_0123456789abcdef0123456789abcdef", "wac_0123456789abcdef0123456789abcdef", "delivered", 1, at, null, null, null, at, at);
    const detail = repository.findConversationDetail(context, company.id, conversation.id)!;
    assert.deepEqual(detail.messages[0]?.delivery, { state: "delivered", updatedAt: at, safeErrorCategory: null });
    assert.deepEqual(repository.listConversationInbox(context, company.id)[0]?.delivery, { state: "delivered", updatedAt: at, safeErrorCategory: null });
    assert.equal(JSON.stringify(detail).includes("wamid-secret"), false);
    assert.equal(JSON.stringify(detail).includes("wac_"), false);
  } finally { database.close(); }
});
