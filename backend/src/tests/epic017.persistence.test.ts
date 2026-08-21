import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { assistantProfileId, reconstructAssistantProfile, type AssistantProfile } from "../assistant/domain/assistantProfile.js";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { conversationId, conversationMessageId, reconstructConversation, reconstructConversationMessage } from "../conversation/domain/conversation.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { ChannelProviderEventRepository } from "../repositories/channelProviderEventRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { OutboundDeliveryRepository } from "../repositories/outboundDeliveryRepository.js";
import { ProviderMessageRecordRepository } from "../repositories/providerMessageRecordRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WhatsAppConversationRepository } from "../repositories/whatsappConversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { reconstructOutboundDelivery, reconstructProviderMessageRecord, reconstructChannelExecutionRequest, reconstructChannelProviderEvent } from "../transport/domain/providerDelivery.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { reconstructWhatsAppConnection, reconstructWhatsAppConversationBinding, whatsAppConnectionId, whatsAppConnectionStatus } from "../whatsapp/domain/whatsappConnection.js";
import type { WhatsAppInboundMedia } from "../whatsapp/domain/whatsappInboundMedia.js";

const at = "2026-07-27T12:00:00.000Z";
const later = "2026-07-27T12:01:00.000Z";
class Clock { private value = 0; public now(): string { return new Date(Date.UTC(2026, 6, 27, 12, 0, this.value++)).toISOString(); } }

function profile(companyId: number, id = "asp_0123456789abcdef0123456789abcdef"): AssistantProfile {
  return reconstructAssistantProfile({ id: assistantProfileId(id), companyId, name: "WhatsApp", normalizedName: "whatsapp", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: at, updatedAt: at, archivedAt: null });
}

function setup() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), primary = createWorkspaceContext(workspaces.resolveDefault()), secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" }));
  const companies = new CompanyRepository(database), first = companies.create(primary, { name: "First", website: "https://first.test", status: "ready" }), second = companies.create(secondary, { name: "Second", website: "https://second.test", status: "ready" });
  const profiles = new AssistantProfileRepository(database), firstProfile = profile(first.id), secondProfile = profile(second.id, "asp_1123456789abcdef0123456789abcdef");
  profiles.create(primary, first.id, firstProfile); profiles.create(secondary, second.id, secondProfile);
  const conversations = new ConversationService(new ConversationRepository(database), new Clock());
  const connectionRepository = new WhatsAppConnectionRepository(database);
  const firstConnection = reconstructWhatsAppConnection({ id: whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef"), workspaceId: primary.workspaceId, companyId: first.id, assistantProfileId: firstProfile.id, phoneNumberId: "phone-first", whatsappBusinessAccountId: "waba-first", status: "active", createdAt: at, updatedAt: at });
  const secondConnection = reconstructWhatsAppConnection({ id: whatsAppConnectionId("wac_1123456789abcdef0123456789abcdef"), workspaceId: secondary.workspaceId, companyId: second.id, assistantProfileId: secondProfile.id, phoneNumberId: "phone-second", whatsappBusinessAccountId: "waba-second", status: "active", createdAt: at, updatedAt: at });
  assert.ok(connectionRepository.create(primary, firstConnection)); assert.ok(connectionRepository.create(secondary, secondConnection));
  return { database, primary, secondary, first, second, firstProfile, secondProfile, conversations, connectionRepository, firstConnection, secondConnection };
}

test("EPIC-017 Phase 1 migrates existing conversations to internal and validates communication channels", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;"); runMigrations(database, 16);
    const workspace = database.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number };
    database.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,created_at) VALUES(?,?,?,?,?,?,?)").run(workspace.id, "Legacy", "https://legacy.test", "", "", "ready", at);
    database.prepare("INSERT INTO conversations(id,company_id,state,created_at,updated_at,closed_at) VALUES(?,?,?,?,?,NULL)").run("cnv_ffffffffffffffffffffffffffffffff", 1, "open", at, at);
    runMigrations(database);
    assert.equal((database.prepare("SELECT channel FROM conversations WHERE id=?").get("cnv_ffffffffffffffffffffffffffffffff") as { channel: string }).channel, "internal");
    for (const channel of ["internal", "web_chat", "whatsapp"]) assert.equal(reconstructConversation({ id: conversationId("cnv_0123456789abcdef0123456789abcdef"), companyId: 1, channel: channel as "internal" | "web_chat" | "whatsapp", state: "open", createdAt: at, updatedAt: at, closedAt: null }).channel, channel);
    assert.throws(() => reconstructConversation({ id: conversationId("cnv_0123456789abcdef0123456789abcdef"), companyId: 1, channel: "email" as never, state: "open", createdAt: at, updatedAt: at, closedAt: null }));
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});

test("EPIC-017 Phase 1 persists tenant-scoped WhatsApp Connections and bindings", () => {
  const value = setup();
  try {
    assert.equal(value.connectionRepository.findByPhoneNumberId("phone-first")?.id, value.firstConnection.id);
    assert.equal(value.connectionRepository.findById(value.secondary, value.first.id, value.firstConnection.id), null);
    assert.deepEqual(value.connectionRepository.listByCompany(value.secondary, value.first.id), []);
    assert.equal(value.connectionRepository.create(value.primary, reconstructWhatsAppConnection({ ...value.firstConnection, id: whatsAppConnectionId("wac_3123456789abcdef0123456789abcdef"), assistantProfileId: value.secondProfile.id, phoneNumberId: "phone-invalid-profile" })), null);
    assert.equal("accessToken" in value.firstConnection, false); assert.equal("appSecret" in value.firstConnection, false); assert.equal("verifyToken" in value.firstConnection, false);
    assert.equal(value.connectionRepository.updateStatus(value.primary, value.first.id, value.firstConnection.id, value.firstConnection.updatedAt, "inactive", later)?.status, "inactive");
    assert.throws(() => whatsAppConnectionStatus("disabled"));
    const duplicatePhone = reconstructWhatsAppConnection({ ...value.secondConnection, id: whatsAppConnectionId("wac_2123456789abcdef0123456789abcdef"), phoneNumberId: "phone-first" });
    assert.throws(() => value.connectionRepository.create(value.secondary, duplicatePhone));
    const firstConversation = value.conversations.open(value.primary, value.first.id, "whatsapp"), firstCustomer = value.conversations.addParticipant(value.primary, value.first.id, firstConversation.id, { type: "whatsapp_contact", reference: "sender-one" }), firstAssistant = value.conversations.addParticipant(value.primary, value.first.id, firstConversation.id, { type: "assistant", reference: value.firstProfile.id });
    const secondConversation = value.conversations.open(value.secondary, value.second.id, "whatsapp"), secondCustomer = value.conversations.addParticipant(value.secondary, value.second.id, secondConversation.id, { type: "whatsapp_contact", reference: "sender-one" }), secondAssistant = value.conversations.addParticipant(value.secondary, value.second.id, secondConversation.id, { type: "assistant", reference: value.secondProfile.id });
    const bindings = new WhatsAppConversationRepository(value.database);
    const firstBinding = reconstructWhatsAppConversationBinding({ id: "wcb_0123456789abcdef0123456789abcdef" as never, whatsAppConnectionId: value.firstConnection.id, waId: "sender-one", conversationId: firstConversation.id, customerParticipantId: firstCustomer.id, assistantParticipantId: firstAssistant.id, createdAt: at, updatedAt: at });
    const secondBinding = reconstructWhatsAppConversationBinding({ id: "wcb_1123456789abcdef0123456789abcdef" as never, whatsAppConnectionId: value.secondConnection.id, waId: "sender-one", conversationId: secondConversation.id, customerParticipantId: secondCustomer.id, assistantParticipantId: secondAssistant.id, createdAt: at, updatedAt: at });
    assert.ok(bindings.createBinding(firstBinding)); assert.ok(bindings.createBinding(secondBinding));
    assert.equal(bindings.findBinding(value.firstConnection.id, "sender-one")?.conversationId, firstConversation.id);
    assert.throws(() => bindings.createBinding(firstBinding));
    assert.throws(() => value.database.prepare("INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("wcb_ffffffffffffffffffffffffffffffff", "wac_ffffffffffffffffffffffffffffffff", "invalid", firstConversation.id, firstCustomer.id, firstAssistant.id, at, at));
    assert.deepEqual(value.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { value.database.close(); }
});

test("EPIC-017 Phase 1 persists generic provider idempotency, message references, and outbound delivery uniqueness", () => {
  const value = setup();
  try {
    const conversation = value.conversations.open(value.primary, value.first.id, "whatsapp"), customer = value.conversations.addParticipant(value.primary, value.first.id, conversation.id, { type: "whatsapp_contact", reference: "sender" }), assistant = value.conversations.addParticipant(value.primary, value.first.id, conversation.id, { type: "assistant", reference: value.firstProfile.id });
    const inbound = value.conversations.addMessage(value.primary, value.first.id, conversation.id, { senderParticipantId: customer.id, direction: "inbound", content: "Question" });
    const outbound = value.conversations.addMessage(value.primary, value.first.id, conversation.id, { senderParticipantId: assistant.id, direction: "outbound", content: "Answer" });
    const events = new ChannelProviderEventRepository(value.database), event = reconstructChannelProviderEvent({ id: "cpe_0123456789abcdef0123456789abcdef" as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", transportConnectionId: value.firstConnection.id, externalEventId: "wamid-one", state: "claimed", conversationId: conversation.id, conversationMessageId: inbound.id, createdAt: at, updatedAt: at });
    assert.equal(events.claim(event).claimed, true); assert.equal(events.claim({ ...event, id: "cpe_1123456789abcdef0123456789abcdef" as never }).claimed, false);
    assert.equal(events.claim({ ...event, id: "cpe_2123456789abcdef0123456789abcdef" as never, transportProvider: "telegram" }).claimed, true);
    assert.equal(events.updateState(event.id, "claimed", "processing", later)?.state, "processing");
    const records = new ProviderMessageRecordRepository(value.database), inboundRecord = reconstructProviderMessageRecord({ id: "pmr_0123456789abcdef0123456789abcdef" as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "inbound", transportConnectionId: value.firstConnection.id, conversationMessageId: inbound.id, externalMessageId: "wamid-one", createdAt: at, updatedAt: at }), outboundRecord = reconstructProviderMessageRecord({ id: "pmr_1123456789abcdef0123456789abcdef" as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "outbound", transportConnectionId: value.firstConnection.id, conversationMessageId: outbound.id, externalMessageId: null, createdAt: at, updatedAt: at });
    assert.ok(records.create(inboundRecord)); assert.ok(records.create(outboundRecord));
    assert.throws(() => records.attachExternalMessageId(outboundRecord.id, "wamid-one", later));
    assert.equal(records.attachExternalMessageId(outboundRecord.id, "wamid-out", later)?.externalMessageId, "wamid-out");
    const deliveries = new OutboundDeliveryRepository(value.database), delivery = reconstructOutboundDelivery({ id: "odl_0123456789abcdef0123456789abcdef" as never, providerMessageRecordId: outboundRecord.id, transportConnectionId: value.firstConnection.id, state: "pending", attemptCount: 0, nextAttemptAt: at, leaseOwner: null, leaseExpiresAt: null, safeErrorCategory: null, createdAt: at, updatedAt: at });
    assert.ok(deliveries.create(delivery)); assert.equal(deliveries.create({ ...delivery, id: "odl_1123456789abcdef0123456789abcdef" as never }), null);
    assert.equal(deliveries.findById(delivery.id)?.state, "pending");
    const leased = deliveries.leaseReady("worker-one", at, "2026-07-27T12:01:00.000Z", 10);
    assert.equal(leased.length, 1); assert.equal(leased[0]?.state, "leased"); assert.equal(leased[0]?.attemptCount, 1);
    assert.equal(deliveries.completeLease(delivery.id, "worker-one", "accepted", null, later)?.state, "accepted");
  } finally { value.database.close(); }
});

test("EPIC-017 captures an inbound provider event and message atomically for restart recovery", () => {
  const value = setup();
  try {
    const conversation = value.conversations.open(value.primary, value.first.id, "whatsapp"), customer = value.conversations.addParticipant(value.primary, value.first.id, conversation.id, { type: "whatsapp_contact", reference: "sender" });
    const events = new ChannelProviderEventRepository(value.database);
    const event = reconstructChannelProviderEvent({ id: "cpe_3123456789abcdef0123456789abcdef" as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", transportConnectionId: value.firstConnection.id, externalEventId: "wamid-recover", state: "claimed", conversationId: null, conversationMessageId: null, createdAt: at, updatedAt: at });
    const inbound = reconstructConversationMessage({ id: conversationMessageId("cmsg_3123456789abcdef0123456789abcdef"), conversationId: conversation.id, senderParticipantId: customer.id, direction: "inbound", content: "Resume me", idempotencyKey: "whatsapp-inbound:test", executionRecordId: null, createdAt: at });
    const record = reconstructProviderMessageRecord({ id: "pmr_3123456789abcdef0123456789abcdef" as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "inbound", transportConnectionId: value.firstConnection.id, conversationMessageId: inbound.id, externalMessageId: "wamid-recover", createdAt: at, updatedAt: at });
    const first = events.captureInbound(event, inbound, record), duplicate = events.captureInbound({ ...event, id: "cpe_4123456789abcdef0123456789abcdef" as never }, inbound, record);
    assert.equal(first.claimed, true); assert.equal(duplicate.claimed, false); assert.equal(first.inbound.id, duplicate.inbound.id);
    assert.equal(value.conversations.listMessages(value.primary, value.first.id, conversation.id).length, 1);
    assert.equal(events.listRecoverable("meta_whatsapp_cloud", 10)[0]?.conversationMessageId, inbound.id);
  } finally { value.database.close(); }
});

function mediaCapture(value: ReturnType<typeof setup>, suffix: string, mime = "image/jpeg", ordinal = 0) {
  const conversation = value.conversations.open(value.primary, value.first.id, "whatsapp"), customer = value.conversations.addParticipant(value.primary, value.first.id, conversation.id, { type: "whatsapp_contact", reference: `sender-${suffix}` });
  const event = reconstructChannelProviderEvent({ id: `cpe_${suffix}` as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", transportConnectionId: value.firstConnection.id, externalEventId: `wamid-${suffix}`, state: "claimed", conversationId: null, conversationMessageId: null, createdAt: at, updatedAt: at });
  const inbound = reconstructConversationMessage({ id: conversationMessageId(`cmsg_${suffix}`), conversationId: conversation.id, senderParticipantId: customer.id, direction: "inbound", content: "[attachment received]", idempotencyKey: `whatsapp-inbound:${suffix}`, executionRecordId: null, createdAt: at });
  const provider = reconstructProviderMessageRecord({ id: `pmr_${suffix}` as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "inbound", transportConnectionId: value.firstConnection.id, conversationMessageId: inbound.id, externalMessageId: `wamid-${suffix}`, createdAt: at, updatedAt: at });
  const request = reconstructChannelExecutionRequest({ id: `cex_${suffix}` as never, channelProviderEventId: event.id, state: "pending", snapshot: { version: "test" }, leaseOwner: null, leaseExpiresAt: null, outcome: null, createdAt: at, updatedAt: at });
  const attachment: WhatsAppInboundMedia = { id: `wim_${suffix}`, workspaceId: value.primary.workspaceId, companyId: value.first.id, connectionId: value.firstConnection.id, eventId: event.id, conversationMessageId: inbound.id, descriptor: { wamid: `wamid-${suffix}`, providerMediaId: `media-${suffix}`, kind: "image", declaredMime: mime, filename: "image.jpg", caption: null, ordinal }, state: "pending_download", mediaAssetId: null, failureCode: null, attemptCount: 0, nextAttemptAt: null, createdAt: at, updatedAt: at, completedAt: null };
  return { event, inbound, provider, request, attachment };
}

test("EPIC-040 captures media atomically and blocks its durable execution request", () => {
  const value = setup(); try { const input = mediaCapture(value, "5123456789abcdef0123456789abcdef"), result = new ChannelProviderEventRepository(value.database).captureInboundExecution(input.event, input.inbound, input.provider, input.request, [input.attachment]);
    assert.equal(result.request.mediaGateState, "blocked_by_media"); assert.equal(result.media[0]?.state, "pending_download");
    for (const table of ["channel_provider_events", "conversation_messages", "provider_message_records", "channel_execution_requests", "whatsapp_inbound_media"]) assert.equal((value.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count:number }).count, 1);
  } finally { value.database.close(); }
});

test("EPIC-040 rolls back capture when a later media ledger insert conflicts", () => {
  const value = setup(); try { const input = mediaCapture(value, "6123456789abcdef0123456789abcdef"), divergent = { ...input.attachment, id: "wim_other", descriptor: { ...input.attachment.descriptor, declaredMime: "image/png" } };
    assert.throws(() => new ChannelProviderEventRepository(value.database).captureInboundExecution(input.event, input.inbound, input.provider, input.request, [input.attachment, divergent]));
    for (const table of ["channel_provider_events", "conversation_messages", "provider_message_records", "channel_execution_requests", "whatsapp_inbound_media"]) assert.equal((value.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count:number }).count, 0);
  } finally { value.database.close(); }
});

test("EPIC-040 replays the same media capture without duplicate durable rows", () => {
  const value = setup(); try { const input = mediaCapture(value, "7123456789abcdef0123456789abcdef"), events = new ChannelProviderEventRepository(value.database), first = events.captureInboundExecution(input.event, input.inbound, input.provider, input.request, [input.attachment]), replay = events.captureInboundExecution({ ...input.event, id: "cpe_8123456789abcdef0123456789abcdef" as never }, input.inbound, input.provider, input.request, [input.attachment]);
    assert.equal(replay.claimed, false); assert.equal(replay.request.id, first.request.id); assert.equal(replay.media[0]?.id, first.media[0]?.id); assert.equal(replay.request.mediaGateState, "blocked_by_media");
    for (const table of ["channel_provider_events", "conversation_messages", "provider_message_records", "channel_execution_requests", "whatsapp_inbound_media"]) assert.equal((value.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count:number }).count, 1);
  } finally { value.database.close(); }
});

test("EPIC-040 rejects divergent media descriptor replay without mutating original", () => {
  const value = setup(); try { const input = mediaCapture(value, "9123456789abcdef0123456789abcdef"), events = new ChannelProviderEventRepository(value.database); events.captureInboundExecution(input.event, input.inbound, input.provider, input.request, [input.attachment]);
    assert.throws(() => events.captureInboundExecution(input.event, input.inbound, input.provider, input.request, [{ ...input.attachment, descriptor: { ...input.attachment.descriptor, declaredMime: "image/png" } }]));
    assert.equal((value.database.prepare("SELECT declared_mime FROM whatsapp_inbound_media").get() as { declared_mime:string }).declared_mime, "image/jpeg"); assert.equal((value.database.prepare("SELECT media_gate_state FROM channel_execution_requests").get() as { media_gate_state:string }).media_gate_state, "blocked_by_media");
  } finally { value.database.close(); }
});

test("EPIC-040 preserves text-only capture request semantics", () => {
  const value = setup(); try { const input = mediaCapture(value, "a123456789abcdef0123456789abcdef"), result = new ChannelProviderEventRepository(value.database).captureInboundExecution(input.event, { ...input.inbound, content: "Hello" }, input.provider, input.request);
    assert.equal(result.media.length, 0); assert.equal(result.request.mediaGateState, "open"); assert.equal((value.database.prepare("SELECT count(*) AS count FROM whatsapp_inbound_media").get() as { count:number }).count, 0);
  } finally { value.database.close(); }
});
