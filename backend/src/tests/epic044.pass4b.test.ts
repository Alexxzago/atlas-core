import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { ConversationIntelligenceService } from "../conversationIntelligence/services/conversationIntelligenceService.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationIntelligenceRepository } from "../repositories/conversationIntelligenceRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WhatsAppVoiceRepository } from "../repositories/whatsappVoiceRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { VoiceDeferredSemanticRecoveryService } from "../whatsapp/services/voiceDeferredSemanticRecoveryService.js";
import { includeVoiceSemanticHistory } from "../whatsapp/services/voiceSemanticContentResolver.js";

const at = "2026-08-27T12:00:00.000Z";
class Clock { public now(): string { return at; } }

async function setup(path: string) {
  const database = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), companies = new CompanyRepository(database), existing = await companies.findById(context, 1), company = existing ?? await companies.create(context, { name: "PASS4B", website: "https://pass4b.test" });
  const conversations = new ConversationService(new ConversationRepository(database), new Clock()), voices = new WhatsAppVoiceRepository(database), derived: string[] = [];
  const intelligence = new ConversationIntelligenceService(new ConversationIntelligenceRepository(database), { derive: async ({ message }) => { derived.push(message.id); return [{ kind: "set_fact", key: "voice", value: message.content }] as const; } }, new Clock());
  const recovery = new VoiceDeferredSemanticRecoveryService(voices, intelligence);
  if (!existing) {
    database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("asp_pass4b", company.id, "Voice", "voice", "friendly", "en", "Fallback", "ready", at, at, null);
    database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("wac_pass4b", context.workspaceId, company.id, "asp_pass4b", "phone-pass4b", "waba-pass4b", "active", at, at);
    database.prepare("INSERT INTO media_blobs(id,workspace_id,company_id,sha256_digest,size_bytes,media_type,storage_reference,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run("mbl_delivery", context.workspaceId, company.id, "c".repeat(64), 12, "audio/ogg", "memory://delivery", "active", at);
    database.prepare("INSERT INTO media_assets(id,workspace_id,company_id,blob_id,kind,media_type,size_bytes,safe_filename,metadata_json,status,created_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("mas_delivery", context.workspaceId, company.id, "mbl_delivery", "audio", "audio/ogg", 12, "voice.ogg", "{}", "ready", at, null, null);
  }
  return { database, context, company, conversations, voices, recovery, derived };
}

async function inbound(fixture: Awaited<ReturnType<typeof setup>>, content: string) {
  const conversation = await fixture.conversations.open(fixture.context, fixture.company.id, "whatsapp"), participant = await fixture.conversations.addParticipant(fixture.context, fixture.company.id, conversation.id, { type: "customer" });
  const message = await fixture.conversations.addMessage(fixture.context, fixture.company.id, conversation.id, { senderParticipantId: participant.id, direction: "inbound", content });
  const suffix = message.id.slice(-8), assetId = `mas_${suffix}`;
  fixture.database.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(`cpe_${suffix}`, "whatsapp", "meta_whatsapp_cloud", "wac_pass4b", `event-${suffix}`, "completed", conversation.id, message.id, at, at);
  fixture.database.prepare("INSERT INTO media_blobs(id,workspace_id,company_id,sha256_digest,size_bytes,media_type,storage_reference,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(`mbl_${suffix}`, fixture.context.workspaceId, fixture.company.id, "a".repeat(64), 12, "audio/ogg", `memory://${suffix}`, "active", at);
  fixture.database.prepare("INSERT INTO media_assets(id,workspace_id,company_id,blob_id,kind,media_type,size_bytes,safe_filename,metadata_json,status,created_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(assetId, fixture.context.workspaceId, fixture.company.id, `mbl_${suffix}`, "audio", "audio/ogg", 12, "voice.ogg", "{}", "ready", at, null, null);
  fixture.database.prepare("INSERT INTO whatsapp_inbound_media(id,workspace_id,company_id,whatsapp_connection_id,channel_provider_event_id,conversation_message_id,provider_media_id,provider_kind,declared_mime,safe_filename,ordinal,caption_present,state,media_asset_id,failure_code,attempt_count,next_attempt_at,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(`wim_${suffix}`, fixture.context.workspaceId, fixture.company.id, "wac_pass4b", `cpe_${suffix}`, message.id, `media-${suffix}`, "audio", "audio/ogg", null, 0, 0, "associated", assetId, null, 0, null, at, at, at);
  fixture.database.prepare("INSERT INTO conversation_audio_transcripts(id,workspace_id,company_id,conversation_id,conversation_message_id,media_asset_id,normalized_transcript,language_tag,input_digest,outcome,safe_failure_category,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(`cat_${suffix}`, fixture.context.workspaceId, fixture.company.id, conversation.id, message.id, assetId, `transcript ${content}`, "en", "b".repeat(64), "completed", null, at);
  return { conversation, participant, message };
}

async function deferred(fixture: Awaited<ReturnType<typeof setup>>, state: "accepted" | "delivered" | "read" | "suppressed" | "uncertain" | "permanent_failure" = "accepted") {
  const conversation = await fixture.conversations.open(fixture.context, fixture.company.id, "whatsapp"), participant = await fixture.conversations.addParticipant(fixture.context, fixture.company.id, conversation.id, { type: "assistant" });
  const message = await fixture.conversations.addMessage(fixture.context, fixture.company.id, conversation.id, { senderParticipantId: participant.id, direction: "outbound", content: `deferred ${state}` });
  const suffix = message.id.slice(-8), deliveryId = `odl_${suffix}`;
  fixture.database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(`pmr_${suffix}`, "whatsapp", "meta_whatsapp_cloud", "outbound", "wac_pass4b", message.id, `wamid-${suffix}`, at, at);
  fixture.database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(deliveryId, `pmr_${suffix}`, "wac_pass4b", "accepted", 0, at, "audio", "deferred_voice", "mas_delivery", 1, at, at);
  if (state === "accepted" || state === "delivered" || state === "read") assert.equal(fixture.voices.appendVisibility(fixture.context, fixture.company.id, { workspaceId: fixture.context.workspaceId, companyId: fixture.company.id, conversationId: conversation.id, messageId: message.id, outboundDeliveryId: deliveryId, kind: "externally_committed", committedAt: at, createdAt: at }).kind, "created");
  if (state !== "accepted") fixture.database.prepare("UPDATE outbound_deliveries SET state=? WHERE id=?").run(state, deliveryId);
  return { conversation, message, deliveryId };
}

async function standard(fixture: Awaited<ReturnType<typeof setup>>) {
  const conversation = await fixture.conversations.open(fixture.context, fixture.company.id, "whatsapp"), participant = await fixture.conversations.addParticipant(fixture.context, fixture.company.id, conversation.id, { type: "assistant" });
  const message = await fixture.conversations.addMessage(fixture.context, fixture.company.id, conversation.id, { senderParticipantId: participant.id, direction: "outbound", content: "standard" });
  const suffix = message.id.slice(-8);
  fixture.database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(`pmr_standard_${suffix}`, "whatsapp", "meta_whatsapp_cloud", "outbound", "wac_pass4b", message.id, `wamid-standard-${suffix}`, at, at);
  fixture.database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(`odl_standard_${suffix}`, `pmr_standard_${suffix}`, "wac_pass4b", "accepted", 0, at, "text", "standard", null, null, at, at);
  return message;
}

test("EPIC044 PASS4B recovers a durable transcript once across restart and webhook replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-pass4b-")), path = join(directory, "atlas.sqlite"), first = await setup(path);
  try {
    const voice = await inbound(first, "original"), originalId = voice.message.id;
    first.database.close();
    const restarted = await setup(path);
    try {
      assert.equal(await restarted.recovery.recover(restarted.context, restarted.company.id), 1);
      assert.deepEqual(restarted.derived, [originalId]);
      assert.equal((restarted.database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_messages WHERE conversation_message_id=?").get(originalId) as { count: number }).count, 1);
      assert.equal(await restarted.recovery.recover(restarted.context, restarted.company.id), 0);
      assert.deepEqual(restarted.derived, [originalId]);
    } finally { restarted.database.close(); }
    const second = await setup(path);
    try { assert.equal(await second.recovery.recoverAvailable(), 0); assert.equal(second.derived.length, 0); }
    finally { second.database.close(); }
  } finally { if (first.database.isOpen) first.database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Windows can retain a SQLite handle briefly after a restart test. */ } }
});

test("EPIC044 PASS4B only recovers visible deferred voice evidence and preserves semantic history", async () => {
  const fixture = await setup(":memory:");
  try {
    const visible = await deferred(fixture), delivered = await deferred(fixture, "delivered"), read = await deferred(fixture, "read"), noVisibility = await deferred(fixture, "suppressed"), uncertain = await deferred(fixture, "uncertain"), permanent = await deferred(fixture, "permanent_failure");
    const standardMessage = await standard(fixture);
    const webConversation = await fixture.conversations.open(fixture.context, fixture.company.id, "web_chat"), webParticipant = await fixture.conversations.addParticipant(fixture.context, fixture.company.id, webConversation.id, { type: "assistant" }), webMessage = await fixture.conversations.addMessage(fixture.context, fixture.company.id, webConversation.id, { senderParticipantId: webParticipant.id, direction: "outbound", content: "webchat" });
    assert.equal(await fixture.recovery.recover(fixture.context, fixture.company.id), 3);
    assert.deepEqual(fixture.derived.sort(), [visible.message.id, delivered.message.id, read.message.id].sort());
    assert.equal(await fixture.recovery.recover(fixture.context, fixture.company.id), 0);
    assert.equal(await includeVoiceSemanticHistory(fixture.voices, fixture.context, fixture.company.id, visible.message), true);
    assert.equal(await includeVoiceSemanticHistory(fixture.voices, fixture.context, fixture.company.id, noVisibility.message), false);
    assert.equal(await includeVoiceSemanticHistory(fixture.voices, fixture.context, fixture.company.id, standardMessage), true);
    assert.equal(await includeVoiceSemanticHistory(fixture.voices, fixture.context, fixture.company.id, webMessage), true);
    assert.equal(fixture.derived.includes(uncertain.message.id) || fixture.derived.includes(permanent.message.id) || fixture.derived.includes(noVisibility.message.id) || fixture.derived.includes(standardMessage.id) || fixture.derived.includes(webMessage.id), false);
    const other = await new CompanyRepository(fixture.database).create(fixture.context, { name: "Other PASS4B", website: "https://other-pass4b.test" });
    const otherConversation = await fixture.conversations.open(fixture.context, other.id, "internal"), otherParticipant = await fixture.conversations.addParticipant(fixture.context, other.id, otherConversation.id, { type: "customer" }), otherMessage = await fixture.conversations.addMessage(fixture.context, other.id, otherConversation.id, { senderParticipantId: otherParticipant.id, direction: "inbound", content: "other" });
    const otherAssistant = await fixture.conversations.addParticipant(fixture.context, other.id, otherConversation.id, { type: "assistant" }), otherOutbound = await fixture.conversations.addMessage(fixture.context, other.id, otherConversation.id, { senderParticipantId: otherAssistant.id, direction: "outbound", content: "other deferred" });
    fixture.database.prepare("INSERT INTO media_blobs(id,workspace_id,company_id,sha256_digest,size_bytes,media_type,storage_reference,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run("mbl_other", fixture.context.workspaceId, other.id, "d".repeat(64), 12, "audio/ogg", "memory://other", "active", at);
    fixture.database.prepare("INSERT INTO media_assets(id,workspace_id,company_id,blob_id,kind,media_type,size_bytes,safe_filename,metadata_json,status,created_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("mas_other", fixture.context.workspaceId, other.id, "mbl_other", "audio", "audio/ogg", 12, "voice.ogg", "{}", "ready", at, null, null);
    fixture.database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_other", "whatsapp", "meta_whatsapp_cloud", "outbound", "wac_other", otherOutbound.id, "wamid-other", at, at);
    fixture.database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("odl_other", "pmr_other", "wac_other", "accepted", 0, at, "audio", "deferred_voice", "mas_other", 1, at, at);
    assert.equal(fixture.voices.appendVisibility(fixture.context, other.id, { workspaceId: fixture.context.workspaceId, companyId: other.id, conversationId: otherConversation.id, messageId: otherOutbound.id, outboundDeliveryId: "odl_other", kind: "externally_committed", committedAt: at, createdAt: at }).kind, "created");
    assert.equal(await fixture.recovery.recover(fixture.context, fixture.company.id), 0);
    assert.equal(fixture.derived.includes(otherMessage.id), false);
    assert.equal(fixture.derived.includes(otherOutbound.id), false);
    assert.equal(await fixture.recovery.recoverAvailable(), 1);
    assert.equal(fixture.derived.includes(otherOutbound.id), true);
  } finally { fixture.database.close(); }
});
