import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ChannelProviderEventRepository } from "../repositories/channelProviderEventRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WhatsAppVoiceRepository } from "../repositories/whatsappVoiceRepository.js";
import { OutboundDeliveryRepository } from "../repositories/outboundDeliveryRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";

const at = "2026-08-27T12:00:00.000Z";

function seed(database: DatabaseSync): { workspaceId: number; companyId: number; conversationId: string; inboundId: string; outboundId: string; assetId: string; connectionId: string; deliveryId: string; legacyRowids: number[] } {
  const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
  const company = new CompanyRepository(database).create(context, { name: "EPIC 044", website: "https://epic044.test" });
  const conversations = new ConversationRepository(database);
  const conversation = conversations.createConversation(context, reconstructConversation({ id: conversationId("cnv_04400000000000000000000000000001"), companyId: company.id, channel: "whatsapp", state: "open", createdAt: at, updatedAt: at, closedAt: null }))!;
  const customer = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04400000000000000000000000000001"), conversationId: conversation.id, type: "customer", reference: null, createdAt: at }))!;
  const assistant = conversations.createParticipant(context, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04400000000000000000000000000002"), conversationId: conversation.id, type: "assistant", reference: null, createdAt: at }))!;
  const inbound = conversations.createMessage(context, company.id, reconstructConversationMessage({ id: conversationMessageId("cmsg_04400000000000000000000000000001"), conversationId: conversation.id, senderParticipantId: customer.id, direction: "inbound", content: "[audio]", idempotencyKey: "inbound", executionRecordId: null, createdAt: at }))!;
  const outbound = conversations.createMessage(context, company.id, reconstructConversationMessage({ id: conversationMessageId("cmsg_04400000000000000000000000000002"), conversationId: conversation.id, senderParticipantId: assistant.id, direction: "outbound", content: "Answer", idempotencyKey: "outbound", executionRecordId: null, createdAt: at }))!;
  const profileId = "apr_04400000000000000000000000000001";
  const connectionId = "wac_04400000000000000000000000000001";
  database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(profileId, company.id, "Voice", "voice", "professional", "es", "Fallback", "ready", at, at, null);
  database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, company.id, profileId, "phone-044", "business-044", "active", at, at);
  database.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("cpe_04400000000000000000000000000001", "whatsapp", "meta", connectionId, "event-044", "completed", conversation.id, inbound.id, at, at);
   database.prepare("INSERT INTO channel_execution_requests(id,channel_provider_event_id,state,snapshot_json,lease_owner,lease_expires_at,outcome,created_at,updated_at,media_gate_state) VALUES(?,?,?,?,?,?,?,?,?,?)").run("cex_04400000000000000000000000000001", "cpe_04400000000000000000000000000001", "pending", "{}", null, null, null, at, at, "open");
  database.prepare("INSERT INTO media_blobs(id,workspace_id,company_id,sha256_digest,size_bytes,media_type,storage_reference,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run("mbl_044", context.workspaceId, company.id, "a".repeat(64), 12, "audio/ogg", "media-044", "active", at);
  const assetId = "mas_044";
  database.prepare("INSERT INTO media_assets(id,workspace_id,company_id,blob_id,kind,media_type,size_bytes,safe_filename,metadata_json,status,created_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(assetId, context.workspaceId, company.id, "mbl_044", "audio", "audio/ogg", 12, "voice.ogg", "{}", "ready", at, null, null);
  database.prepare("INSERT INTO whatsapp_inbound_media(id,workspace_id,company_id,whatsapp_connection_id,channel_provider_event_id,conversation_message_id,provider_media_id,provider_kind,declared_mime,safe_filename,ordinal,caption_present,state,media_asset_id,failure_code,attempt_count,next_attempt_at,created_at,updated_at,completed_at,lease_token,lease_owner,lease_acquired_at,lease_expires_at,last_retry_failure_code,last_retry_failure_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("wim_044", context.workspaceId, company.id, connectionId, "cpe_04400000000000000000000000000001", inbound.id, "provider-audio", "audio", "audio/ogg", null, 0, 0, "associated", assetId, null, 0, null, at, at, at, null, null, null, null, null, null);
  const addDelivery = database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
  const addLegacy = database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  addDelivery.run("pmr_044_1", "whatsapp", "meta", "outbound", connectionId, outbound.id, null, at, at);
  addLegacy.run("odl_044_1", "pmr_044_1", connectionId, "pending", 0, at, null, null, null, at, at);
  database.prepare("INSERT INTO outbound_delivery_attempts(id,outbound_delivery_id,attempt_number,outcome,safe_error_category,occurred_at) VALUES(?,?,?,?,?,?)").run("oda_044_1", "odl_044_1", 1, "retryable", "timeout", at);
  database.prepare("INSERT INTO conversation_events(sequence,id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(5, "cev_044_5", context.workspaceId, company.id, conversation.id, "inbound_message_received", null, null, null, inbound.id, null, at);
  database.prepare("INSERT INTO conversation_events(sequence,id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(10, "cev_044_10", context.workspaceId, company.id, conversation.id, "assistant_message_created", null, null, null, outbound.id, null, at);
  return { workspaceId: context.workspaceId, companyId: company.id, conversationId: conversation.id, inboundId: inbound.id, outboundId: outbound.id, assetId, connectionId, deliveryId: "odl_044_1", legacyRowids: (database.prepare("SELECT rowid FROM outbound_deliveries ORDER BY rowid").all() as Array<{ rowid: number }>).map((row) => row.rowid) };
}

function seedDeferredVoiceDelivery(database: DatabaseSync, value: ReturnType<typeof seed>): string {
  const id = "odl_04400000000000000000000000000002";
  database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_04400000000000000000000000000002", "whatsapp", "meta", "outbound", "connection-voice", value.outboundId, "external-voice", at, at);
  database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "pmr_04400000000000000000000000000002", "connection-voice", "accepted", 0, at, "audio", "deferred_voice", value.assetId, 1, at, at);
  return id;
}

test("EPIC044 upgrades 0059 data without changing delivery order or event cursors", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-"));
  const path = join(directory, "atlas.sqlite");
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA foreign_keys=ON");
    runMigrations(database, 59);
    const value = seed(database);
    runMigrations(database);
    assert.deepEqual((database.prepare("SELECT rowid FROM outbound_deliveries ORDER BY rowid").all() as Array<{ rowid: number }>).map((row) => row.rowid), value.legacyRowids);
    assert.deepEqual({ ...(database.prepare("SELECT payload_kind,response_policy,media_asset_id,expected_authority_generation FROM outbound_deliveries WHERE id=?").get(value.deliveryId) as Record<string, unknown>) }, { payload_kind: "text", response_policy: "standard", media_asset_id: null, expected_authority_generation: null });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM outbound_delivery_attempts WHERE outbound_delivery_id=?").get(value.deliveryId) as { count: number }).count, 1);
    assert.deepEqual((database.prepare("SELECT sequence FROM conversation_events ORDER BY sequence").all() as Array<{ sequence: number }>).map((row) => row.sequence), [5, 10]);
    database.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES(?,?,?,?,?,?,?)").run("cev_044_next", value.workspaceId, value.companyId, value.conversationId, "voice_state_changed", value.inboundId, at);
    assert.ok((database.prepare("SELECT sequence FROM conversation_events WHERE id='cev_044_next'").get() as { sequence: number }).sequence > 10);
    assert.deepEqual({ ...(database.prepare("SELECT voice_ai_enabled,audio_response_mode,version FROM whatsapp_voice_policies WHERE whatsapp_connection_id=?").get(value.connectionId) as Record<string, unknown>) }, { voice_ai_enabled: 0, audio_response_mode: "text_only", version: 1 });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_audio_transcripts").get() as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM voice_response_visibility").get() as { count: number }).count, 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    database.close();
    const reopened = new DatabaseSync(path); reopened.exec("PRAGMA foreign_keys=ON"); runMigrations(reopened);
    assert.deepEqual({ ...(reopened.prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>) }, { id: 69, name: "0069_shared_rate_limit_windows" });
    assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=60").get() as { count: number }).count, 1);
    assert.equal(reopened.prepare("SELECT id FROM schema_migrations WHERE id=61").get(), undefined);
    assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=62").get() as { count: number }).count, 1);
    assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=63").get() as { count: number }).count, 1);
    assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=64").get() as { count: number }).count, 1);
    assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=65").get() as { count: number }).count, 1);
    assert.deepEqual((reopened.prepare("SELECT rowid FROM outbound_deliveries ORDER BY rowid").all() as Array<{ rowid: number }>).map((row) => row.rowid), value.legacyRowids);
    reopened.close();
  } finally { if (database.isOpen) database.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("EPIC044 upgrades file-backed 0060 data to 0062 without recreating historical event sequences", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-0060-0062-")), path = join(directory, "atlas.sqlite");
  let database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA foreign_keys=ON"); runMigrations(database, 60);
    const value = seed(database);
    assert.deepEqual((database.prepare("SELECT sequence FROM conversation_events ORDER BY sequence").all() as Array<{ sequence: number }>).map(row => row.sequence), [5, 10]);
    assert.equal((database.prepare("SELECT seq FROM sqlite_sequence WHERE name='conversation_events'").get() as { seq: number }).seq, 10);
    runMigrations(database);
    assert.deepEqual((database.prepare("SELECT sequence FROM conversation_events ORDER BY sequence").all() as Array<{ sequence: number }>).map(row => row.sequence), [5, 10]);
    assert.equal((database.prepare("SELECT seq FROM sqlite_sequence WHERE name='conversation_events'").get() as { seq: number }).seq, 10);
    database.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES(?,?,?,?,?,?,?)").run("cev_044_0062", value.workspaceId, value.companyId, value.conversationId, "voice_state_changed", value.inboundId, at);
    const next = database.prepare("SELECT sequence FROM conversation_events WHERE id='cev_044_0062'").get() as { sequence: number }; assert.equal(next.sequence, 11);
    assert.deepEqual(new ConversationRepository(database).listConversationEventsAfter(createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), value.companyId, 10, 10).map(event => event.sequence), [11]);
    database.close(); database = new DatabaseSync(path); database.exec("PRAGMA foreign_keys=ON"); runMigrations(database);
    assert.deepEqual(new ConversationRepository(database).listConversationEventsAfter(createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), value.companyId, 10, 10).map(event => event.sequence), [11]);
  } finally { if (database.isOpen) database.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("EPIC044 persistence rejects cross-scope, immutable, and invalid Voice states", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database);
    assert.throws(() => database.prepare("INSERT INTO whatsapp_voice_policies(workspace_id,company_id,whatsapp_connection_id,created_at,updated_at) VALUES(?,?,?,?,?)").run(value.workspaceId, value.companyId, value.connectionId, at, at));
    assert.throws(() => database.prepare("UPDATE whatsapp_voice_policies SET audio_response_mode='invalid' WHERE whatsapp_connection_id=?").run(value.connectionId));
    const transcript = "INSERT INTO conversation_audio_transcripts(id,workspace_id,company_id,conversation_id,conversation_message_id,media_asset_id,normalized_transcript,language_tag,input_digest,outcome,safe_failure_category,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)";
    database.prepare(transcript).run("cat_044", value.workspaceId, value.companyId, value.conversationId, value.inboundId, value.assetId, "hola", "es", "b".repeat(64), "completed", null, at);
    assert.throws(() => database.prepare(transcript).run("cat_044_duplicate", value.workspaceId, value.companyId, value.conversationId, value.inboundId, value.assetId, "hola", null, "c".repeat(64), "completed", null, at));
    assert.throws(() => database.prepare(transcript).run("cat_044_foreign_message", value.workspaceId, value.companyId, value.conversationId, value.outboundId, value.assetId, "hola", null, "c".repeat(64), "completed", null, at));
    database.prepare("INSERT INTO media_blobs(id,workspace_id,company_id,sha256_digest,size_bytes,media_type,storage_reference,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run("mbl_044_other", value.workspaceId, value.companyId, "d".repeat(64), 13, "audio/ogg", "media-044-other", "active", at);
    database.prepare("INSERT INTO media_assets(id,workspace_id,company_id,blob_id,kind,media_type,size_bytes,safe_filename,metadata_json,status,created_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("mas_044_other", value.workspaceId, value.companyId, "mbl_044_other", "audio", "audio/ogg", 13, "other.ogg", "{}", "ready", at, null, null);
    assert.throws(() => database.prepare(transcript).run("cat_044_foreign_media", value.workspaceId, value.companyId, value.conversationId, value.inboundId, "mas_044_other", "hola", null, "c".repeat(64), "completed", null, at));
    assert.throws(() => database.prepare("UPDATE conversation_audio_transcripts SET normalized_transcript='changed' WHERE id='cat_044'").run());
    assert.throws(() => database.prepare("DELETE FROM conversation_audio_transcripts WHERE id='cat_044'").run());
    assert.throws(() => database.prepare("UPDATE conversation_messages SET content='changed' WHERE id=?").run(value.inboundId));
    assert.throws(() => database.prepare("DELETE FROM conversation_messages WHERE id=?").run(value.inboundId));
    assert.throws(() => database.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,occurred_at) VALUES(?,?,?,?,?,?)").run("cev_044_invalid", value.workspaceId, value.companyId, value.conversationId, "voice_state_changed", at));
    assert.throws(() => database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("odl_044_invalid", "pmr_044_1", value.connectionId, "blocked_by_synthesis", 0, at, "text", "standard", null, at, at));
    assert.throws(() => database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("odl_044_audio", "pmr_044_1", value.connectionId, "pending", 0, at, "audio", "standard", null, at, at));
    database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_044_voice", "whatsapp", "meta", "outbound", "connection-voice", value.outboundId, "external-voice", at, at);
    database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("odl_044_voice", "pmr_044_voice", "connection-voice", "accepted", 0, at, "audio", "deferred_voice", value.assetId, 1, at, at);
    const visibility = "INSERT INTO voice_response_visibility(workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id,kind,committed_at,created_at) VALUES(?,?,?,?,?,?,?,?)";
    database.prepare(visibility).run(value.workspaceId, value.companyId, value.conversationId, value.outboundId, "odl_044_voice", "externally_committed", at, at);
    assert.throws(() => database.prepare(visibility).run(value.workspaceId, value.companyId, value.conversationId, value.outboundId, value.deliveryId, "externally_committed", at, at));
    assert.throws(() => database.prepare("UPDATE voice_response_visibility SET committed_at=?").run("2026-08-27T12:01:00.000Z"));
    assert.throws(() => database.prepare("DELETE FROM voice_response_visibility").run());
    assert.throws(() => database.prepare("INSERT INTO whatsapp_outbound_media_uploads(id,workspace_id,company_id,outbound_delivery_id,media_asset_id,provider_media_id,state,attempt_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("wou_044", value.workspaceId, value.companyId, value.deliveryId, value.assetId, "x".repeat(201), "pending_upload", 0, at, at));
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});

test("EPIC044 restart retains message immutability after migration 0060", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-restart-"));
  const path = join(directory, "atlas.sqlite");
  const database = createDatabase(path);
  try {
    const value = seed(database);
    database.close();
    const reopened = new DatabaseSync(path);
    reopened.exec("PRAGMA foreign_keys=ON");
    runMigrations(reopened);
    assert.throws(() => reopened.prepare("UPDATE conversation_messages SET content='changed' WHERE id=?").run(value.inboundId));
    assert.throws(() => reopened.prepare("DELETE FROM conversation_messages WHERE id=?").run(value.inboundId));
    assert.equal((reopened.prepare("SELECT COUNT(*) AS count FROM conversation_message_teardowns").get() as { count: number }).count, 0);
    reopened.close();
  } finally { if (database.isOpen) database.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("EPIC044 PASS7A retains safe Voice read state and metadata-only events after file-backed restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-read-restart-")), path = join(directory, "atlas.sqlite");
  let database = createDatabase(path);
  try {
    const value = seed(database); database.prepare("DELETE FROM outbound_deliveries WHERE id=?").run(value.deliveryId); database.prepare("DELETE FROM provider_message_records WHERE id='pmr_044_1'").run(); const voiceDeliveryId = seedDeferredVoiceDelivery(database, value), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), voices = new WhatsAppVoiceRepository(database);
    assert.equal(voices.enqueueTranscription(context, value.companyId, { id: "atr_read_044", workspaceId: value.workspaceId, companyId: value.companyId, conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, expectedAuthorityGeneration: 1, createdAt: at, updatedAt: at }).kind, "created");
    assert.equal(voices.createTranscript(context, value.companyId, { id: "cat_read_044", conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, normalizedTranscript: "canonical transcript", languageTag: "en", inputDigest: "a".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: at }).kind, "created");
    database.close(); database = createDatabase(path);
    const projection = new WhatsAppVoiceRepository(database).findMessageReadModel(context, value.companyId, value.conversationId, value.inboundId)!;
    assert.deepEqual(projection, { messageId: value.inboundId, direction: "inbound", modality: "audio", transcript: "canonical transcript", transcriptLanguageTag: "en", transcriptionState: "completed", deferredState: null, fallbackAvailable: false, playbackAvailable: true });
    assert.deepEqual(new WhatsAppVoiceRepository(database).findMessageReadModel(context, value.companyId, value.conversationId, value.outboundId), { messageId: value.outboundId, direction: "outbound", modality: "voice", transcript: null, transcriptLanguageTag: null, transcriptionState: null, deferredState: "accepted", fallbackAvailable: false, playbackAvailable: true });
    database.prepare("UPDATE outbound_deliveries SET state='delivered',updated_at=? WHERE id=?").run(at, voiceDeliveryId); assert.equal(new WhatsAppVoiceRepository(database).findMessageReadModel(context, value.companyId, value.conversationId, value.outboundId)?.deferredState, "delivered"); database.prepare("UPDATE outbound_deliveries SET state='read',updated_at=? WHERE id=?").run(at, voiceDeliveryId); assert.equal(new WhatsAppVoiceRepository(database).findMessageReadModel(context, value.companyId, value.conversationId, value.outboundId)?.deferredState, "read");
    const events = new ConversationRepository(database).listConversationEventsAfter(context, value.companyId, 0, 50).filter(event => event.type === "voice_state_changed");
    assert.deepEqual(events.map(event => event.relatedMessageId), [value.inboundId, value.outboundId, value.outboundId]);
    assert.equal(JSON.stringify(events).includes("canonical transcript"), false);
  } finally { if (database.isOpen) database.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("EPIC044 Voice repository persists policy replay, transcript replay, and recovered leases", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database);
    const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
    const repository = new WhatsAppVoiceRepository(database);
    const mutation = { actorId: "usr_044", operationId: "voice-policy-044", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback" as const, occurredAt: at };
    assert.equal(repository.applyPolicy(context, value.companyId, value.connectionId, mutation).kind, "applied");
    assert.equal(repository.applyPolicy(context, value.companyId, value.connectionId, mutation).kind, "replayed_applied");
    assert.equal(repository.applyPolicy(context, value.companyId, value.connectionId, { ...mutation, voiceAiEnabled: false }).kind, "replay_mismatch");
    const transcriptValue = { id: "cat_repo_044", conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, normalizedTranscript: "hola atlas", languageTag: "es", inputDigest: "e".repeat(64), outcome: "completed" as const, safeFailureCategory: null, createdAt: at };
    assert.equal(repository.createTranscript(context, value.companyId, transcriptValue).kind, "created");
    assert.equal(repository.createTranscript(context, value.companyId, transcriptValue).kind, "replayed");
    assert.equal(repository.createTranscript(context, value.companyId, { ...transcriptValue, normalizedTranscript: "otro" }).kind, "conflict");
    const queued = repository.enqueueTranscription(context, value.companyId, { id: "atr_repo_044", workspaceId: value.workspaceId, companyId: value.companyId, conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, expectedAuthorityGeneration: 1, createdAt: at, updatedAt: at });
    assert.equal(queued.kind, "created");
    const lease = repository.leaseTranscriptions(context, value.companyId, { owner: "worker-a", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 });
    assert.equal(lease.length, 1);
    assert.equal(repository.settleTranscription(context, value.companyId, lease[0]!.id, "worker-b", { state: "completed", safeOutcome: "ok", safeFailureCategory: null, completedAt: at, updatedAt: at }), null);
    const recovered = repository.leaseTranscriptions(context, value.companyId, { owner: "worker-c", now: "2026-08-27T12:06:00.000Z", expiresAt: "2026-08-27T12:10:00.000Z", limit: 1 });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]!.attemptCount, 2);
    assert.equal(repository.settleTranscription(context, value.companyId + 1, recovered[0]!.id, "worker-c", { state: "completed", safeOutcome: "ok", safeFailureCategory: null, completedAt: at, updatedAt: at }), null);
    assert.equal(repository.settleTranscription(context, value.companyId, recovered[0]!.id, "worker-c", { state: "completed", safeOutcome: "ok", safeFailureCategory: null, completedAt: at, updatedAt: at })?.state, "completed");
  } finally { database.close(); }
});

test("EPIC044 PASS2B Voice repository durably replays stale policy and synthesis work", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database);
    const voiceDeliveryId = seedDeferredVoiceDelivery(database, value);
    const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
    const repository = new WhatsAppVoiceRepository(database);
    const stale = { actorId: "usr_044", operationId: "voice-policy-stale-044", expectedVersion: 2, voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback" as const, occurredAt: at };
    assert.deepEqual(repository.applyPolicy(context, value.companyId, value.connectionId, stale), { kind: "stale_version", policy: repository.findPolicy(context, value.companyId, value.connectionId) });
    assert.equal(repository.applyPolicy(context, value.companyId, value.connectionId, { ...stale, operationId: "voice-policy-later-044", expectedVersion: 1 }).kind, "applied");
    const replay = repository.applyPolicy(context, value.companyId, value.connectionId, stale);
    assert.equal(replay.kind, "replayed_stale");
    if (replay.kind === "replayed_stale") assert.deepEqual({ version: replay.policy?.version, voiceAiEnabled: replay.policy?.voiceAiEnabled, audioResponseMode: replay.policy?.audioResponseMode }, { version: 1, voiceAiEnabled: false, audioResponseMode: "text_only" });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM whatsapp_voice_policy_operations WHERE operation_id=?").get(stale.operationId) as { count: number }).count, 1);

    const synthesis = { id: "vsr_repo_044", workspaceId: value.workspaceId, companyId: value.companyId, conversationId: value.conversationId, messageId: value.outboundId, outboundDeliveryId: voiceDeliveryId, expectedAuthorityGeneration: 1, createdAt: at, updatedAt: at };
    assert.equal(repository.enqueueSynthesis(context, value.companyId, synthesis).kind, "created");
    assert.equal(repository.enqueueSynthesis(context, value.companyId, synthesis).kind, "replayed");
    assert.equal(repository.enqueueSynthesis(context, value.companyId, { ...synthesis, expectedAuthorityGeneration: 2 }).kind, "conflict");
    assert.equal(repository.enqueueSynthesis(context, value.companyId, { ...synthesis, messageId: value.inboundId }).kind, "conflict");
    const leased = repository.leaseSynthesis(context, value.companyId, { owner: "synthesis-a", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 });
    assert.equal(leased.length, 1);
    assert.equal(repository.settleSynthesis(context, value.companyId, leased[0]!.id, "synthesis-b", { state: "completed", safeOutcome: "ok", safeFailureCategory: null, completedAt: at, updatedAt: at }), null);
    assert.equal(repository.settleSynthesis(context, value.companyId, leased[0]!.id, "synthesis-a", { state: "completed", safeOutcome: "ok", safeFailureCategory: null, completedAt: "2026-08-27T12:05:00.000Z", updatedAt: "2026-08-27T12:05:00.000Z" }), null);
    const recovered = repository.leaseSynthesis(context, value.companyId, { owner: "synthesis-c", now: "2026-08-27T12:06:00.000Z", expiresAt: "2026-08-27T12:10:00.000Z", limit: 1 });
    assert.equal(recovered[0]!.attemptCount, 2);
    assert.equal(repository.settleSynthesis(context, value.companyId, recovered[0]!.id, "synthesis-c", { state: "completed", safeOutcome: "ok", safeFailureCategory: null, completedAt: "2026-08-27T12:06:00.000Z", updatedAt: "2026-08-27T12:06:00.000Z" })?.state, "completed");
  } finally { database.close(); }
});

test("EPIC044 PASS3A atomically blocks then opens an eligible transcription gate", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), repository = new WhatsAppVoiceRepository(database);
    database.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?)").run(value.conversationId, at, at);
    database.prepare("UPDATE channel_execution_requests SET media_gate_state='blocked_by_media' WHERE id='cex_04400000000000000000000000000001'").run();
    assert.equal(repository.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: "voice-enable-044", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "text_only", occurredAt: at }).kind, "applied");
    assert.equal(repository.enqueueTranscriptionAndBlockExecution(context, value.companyId, value.connectionId, "cpe_04400000000000000000000000000001", { id: "atr_pass3a", mediaAssetId: value.assetId, createdAt: at, updatedAt: at }).kind, "created");
    assert.equal((database.prepare("SELECT media_gate_state FROM channel_execution_requests WHERE id='cex_04400000000000000000000000000001'").get() as { media_gate_state: string }).media_gate_state, "blocked_by_transcript");
    const leased = repository.leaseTranscriptions(context, value.companyId, { owner: "stt-worker", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    assert.equal(repository.finalizeTranscription(context, value.companyId, leased.id, "stt-worker", { transcript: { id: "cat_pass3a", conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, normalizedTranscript: "hola atlas", languageTag: "es", inputDigest: "f".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: at }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: at, updatedAt: at } }).kind, "opened");
    const execution = database.prepare("SELECT state,media_gate_state FROM channel_execution_requests WHERE id='cex_04400000000000000000000000000001'").get() as { state: string; media_gate_state: string };
    assert.deepEqual({ state: execution.state, media_gate_state: execution.media_gate_state }, { state: "pending", media_gate_state: "open" });
  } finally { database.close(); }
});

test("EPIC044 PASS3A suppresses a leased transcription after authority takeover or policy disable on a second SQLite connection", () => {
  for (const change of ["takeover", "policy_disable"] as const) {
    const directory = mkdtempSync(join(tmpdir(), `atlas-epic044-${change}-`)), path = join(directory, "atlas.sqlite"), first = createDatabase(path), second = new DatabaseSync(path);
    second.exec("PRAGMA foreign_keys=ON");
    try {
      const value = seed(first), context = createWorkspaceContext(new WorkspaceRepository(first).resolveDefault()), primary = new WhatsAppVoiceRepository(first), concurrent = new WhatsAppVoiceRepository(second);
      first.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?)").run(value.conversationId, at, at);
       first.prepare("UPDATE channel_execution_requests SET media_gate_state='blocked_by_media' WHERE id='cex_04400000000000000000000000000001'").run();
      assert.equal(primary.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: `voice-enable-${change}`, expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "text_only", occurredAt: at }).kind, "applied");
       assert.equal(primary.enqueueTranscriptionAndBlockExecution(context, value.companyId, value.connectionId, "cpe_04400000000000000000000000000001", { id: `atr-${change}`, mediaAssetId: value.assetId, createdAt: at, updatedAt: at }).kind, "created");
      const leased = primary.leaseTranscriptions(context, value.companyId, { owner: "first-worker", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
      if (change === "takeover") assert.equal(new ConversationRepository(second).applyConversationControlOperation(context, value.companyId, value.conversationId as never, { operationId: "takeover-044", operation: "takeover", actorId: "usr_operator" as never, expectedVersion: 1, occurredAt: "2026-08-27T12:01:00.000Z" }).kind, "applied");
      else assert.equal(concurrent.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: "voice-disable-044", expectedVersion: 2, voiceAiEnabled: false, audioResponseMode: "text_only", occurredAt: "2026-08-27T12:01:00.000Z" }).kind, "applied");
      const result = primary.finalizeTranscription(context, value.companyId, leased.id, "first-worker", { transcript: { id: `cat-${change}`, conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, normalizedTranscript: "hola atlas", languageTag: "es", inputDigest: "f".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: "2026-08-27T12:01:00.000Z" }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: "2026-08-27T12:01:00.000Z", updatedAt: "2026-08-27T12:01:00.000Z" } });
      assert.equal(result.kind, "suppressed");
       assert.deepEqual({ ...(first.prepare("SELECT state,media_gate_state FROM channel_execution_requests WHERE id='cex_04400000000000000000000000000001'").get() as Record<string, unknown>) }, { state: "completed", media_gate_state: "blocked_by_transcript" });
      assert.equal(first.prepare("SELECT state FROM audio_transcription_requests WHERE id=?").get(leased.id) && (first.prepare("SELECT state FROM audio_transcription_requests WHERE id=?").get(leased.id) as { state: string }).state, "suppressed");
    } finally { first.close(); second.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  }
});

test("EPIC044 PASS3A suppresses STT finalized after a real human-required transition", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-human-required-")), path = join(directory, "atlas.sqlite"), first = createDatabase(path), second = new DatabaseSync(path);
  second.exec("PRAGMA foreign_keys=ON");
  try {
    const value = seed(first), context = createWorkspaceContext(new WorkspaceRepository(first).resolveDefault()), voices = new WhatsAppVoiceRepository(first);
    first.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?)").run(value.conversationId, at, at);
    first.prepare("UPDATE channel_execution_requests SET media_gate_state='blocked_by_media' WHERE id='cex_04400000000000000000000000000001'").run();
    assert.equal(voices.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: "voice-enable-human-required", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "text_only", occurredAt: at }).kind, "applied");
    assert.equal(voices.enqueueTranscriptionAndBlockExecution(context, value.companyId, value.connectionId, "cpe_04400000000000000000000000000001", { id: "atr-human-required", mediaAssetId: value.assetId, createdAt: at, updatedAt: at }).kind, "created");
    const leased = voices.leaseTranscriptions(context, value.companyId, { owner: "stt", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    const controls = new ConversationRepository(second);
    assert.equal(controls.applyConversationControlOperation(context, value.companyId, value.conversationId as never, { operationId: "takeover-human-required", operation: "takeover", actorId: "usr_operator" as never, expectedVersion: 1, occurredAt: "2026-08-27T12:01:00.000Z" }).kind, "applied");
    assert.equal(controls.applyConversationControlOperation(context, value.companyId, value.conversationId as never, { operationId: "release-human-required", operation: "release", actorId: "usr_operator" as never, expectedVersion: 2, occurredAt: "2026-08-27T12:02:00.000Z" }).kind, "applied");
    assert.equal(voices.finalizeTranscription(context, value.companyId, leased.id, "stt", { transcript: { id: "cat-human-required", conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, normalizedTranscript: "hola", languageTag: "es", inputDigest: "d".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: "2026-08-27T12:02:00.000Z" }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: "2026-08-27T12:02:00.000Z", updatedAt: "2026-08-27T12:02:00.000Z" } }).kind, "suppressed");
    assert.deepEqual({ ...(first.prepare("SELECT state,media_gate_state FROM channel_execution_requests WHERE id='cex_04400000000000000000000000000001'").get() as Record<string, unknown>) }, { state: "completed", media_gate_state: "blocked_by_transcript" });
  } finally { first.close(); second.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("EPIC044 PASS3A replays an expired transcription lease after restart before opening its gate", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-replay-")), path = join(directory, "atlas.sqlite");
  let database = createDatabase(path);
  try {
    const value = seed(database), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), repository = new WhatsAppVoiceRepository(database);
    database.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?)").run(value.conversationId, at, at);
    database.prepare("UPDATE channel_execution_requests SET media_gate_state='blocked_by_media' WHERE id='cex_04400000000000000000000000000001'").run();
    repository.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: "voice-enable-replay", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "text_only", occurredAt: at });
    repository.enqueueTranscriptionAndBlockExecution(context, value.companyId, value.connectionId, "cpe_04400000000000000000000000000001", { id: "atr-replay", mediaAssetId: value.assetId, createdAt: at, updatedAt: at });
    assert.equal(repository.leaseTranscriptions(context, value.companyId, { owner: "crashed-worker", now: at, expiresAt: "2026-08-27T12:01:00.000Z", limit: 1 }).length, 1);
    database.close();
    database = createDatabase(path);
    const replayed = new WhatsAppVoiceRepository(database).leaseTranscriptions(context, value.companyId, { owner: "restarted-worker", now: "2026-08-27T12:02:00.000Z", expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    assert.equal(replayed.attemptCount, 2);
    assert.equal(new WhatsAppVoiceRepository(database).finalizeTranscription(context, value.companyId, replayed.id, "restarted-worker", { transcript: { id: "cat-replay", conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: value.assetId, normalizedTranscript: "hola atlas", languageTag: "es", inputDigest: "e".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: "2026-08-27T12:02:00.000Z" }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: "2026-08-27T12:02:00.000Z", updatedAt: "2026-08-27T12:02:00.000Z" } }).kind, "opened");
    assert.deepEqual({ ...(database.prepare("SELECT state,media_gate_state FROM channel_execution_requests WHERE id='cex_04400000000000000000000000000001'").get() as Record<string, unknown>) }, { state: "pending", media_gate_state: "open" });
  } finally { if (database.isOpen) database.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("EPIC044 PASS3A execution leasing permits only an open pending request", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database), events = new ChannelProviderEventRepository(database);
    for (const gate of ["blocked_by_media", "blocked_by_transcript"] as const) { database.prepare("UPDATE channel_execution_requests SET state='pending',media_gate_state=? WHERE id='cex_04400000000000000000000000000001'").run(gate); assert.equal(events.leaseExecutionRequests("executor", at, "2026-08-27T12:05:00.000Z", 1).length, 0); }
    database.prepare("UPDATE channel_execution_requests SET media_gate_state='open' WHERE id='cex_04400000000000000000000000000001'").run();
    assert.deepEqual(events.leaseExecutionRequests("executor", at, "2026-08-27T12:05:00.000Z", 1).map(request => request.id), ["cex_04400000000000000000000000000001"]);
    for (const [state, outcome] of [["completed", null], ["completed", "suppressed"], ["unsupported", "unsupported"]] as const) { database.prepare("UPDATE channel_execution_requests SET state=?,outcome=?,media_gate_state='open',lease_owner=NULL,lease_expires_at=NULL WHERE id='cex_04400000000000000000000000000001'").run(state, outcome); assert.equal(events.leaseExecutionRequests("terminal-executor", "2026-08-27T12:06:00.000Z", "2026-08-27T12:10:00.000Z", 1).length, 0); }
    database.prepare("UPDATE channel_execution_requests SET state='pending',media_gate_state='blocked_by_transcript' WHERE id='cex_04400000000000000000000000000001'").run();
    assert.equal(events.leaseExecutionRequests("second-executor", "2026-08-27T12:06:00.000Z", "2026-08-27T12:10:00.000Z", 1).length, 0);
    assert.equal(value.companyId > 0, true);
  } finally { database.close(); }
});

test("EPIC044 PASS2B Voice repository makes upload and visibility idempotent within tenant scope", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database);
    const voiceDeliveryId = seedDeferredVoiceDelivery(database, value);
    const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
    const repository = new WhatsAppVoiceRepository(database);
    const upload = { id: "wou_repo_044", workspaceId: value.workspaceId, companyId: value.companyId, outboundDeliveryId: voiceDeliveryId, mediaAssetId: value.assetId, createdAt: at, updatedAt: at };
    assert.equal(repository.createUpload(context, value.companyId, upload).kind, "created");
    assert.equal(repository.createUpload(context, value.companyId, upload).kind, "replayed");
    assert.equal(repository.createUpload(context, value.companyId, { ...upload, mediaAssetId: "mas_044_other" }).kind, "conflict");
    const leased = repository.leaseUploads(context, value.companyId, { owner: "upload-a", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 });
    assert.equal(repository.settleUpload(context, value.companyId, leased[0]!.id, "upload-b", "uploaded", "provider-media", null, at), null);
    assert.equal(repository.settleUpload(context, value.companyId, leased[0]!.id, "upload-a", "uploaded", "provider-media", null, "2026-08-27T12:05:00.000Z"), null);
    const recovered = repository.leaseUploads(context, value.companyId, { owner: "upload-c", now: "2026-08-27T12:06:00.000Z", expiresAt: "2026-08-27T12:10:00.000Z", limit: 1 });
    assert.equal(recovered[0]!.attemptCount, 2);
    assert.equal(repository.settleUpload(context, value.companyId, recovered[0]!.id, "upload-c", "uploaded", "provider-media", null, "2026-08-27T12:06:00.000Z")?.state, "uploaded");
    const visibility = { workspaceId: value.workspaceId, companyId: value.companyId, conversationId: value.conversationId, messageId: value.outboundId, outboundDeliveryId: voiceDeliveryId, kind: "externally_committed" as const, committedAt: at, createdAt: at };
    assert.equal(repository.appendVisibility(context, value.companyId, visibility).kind, "created");
    assert.equal(repository.appendVisibility(context, value.companyId, visibility).kind, "replayed");
    assert.equal(repository.appendVisibility(context, value.companyId, { ...visibility, committedAt: "2026-08-27T12:01:00.000Z" }).kind, "conflict");
    assert.equal(repository.findPolicy(context, value.companyId + 1, value.connectionId), null);
    assert.equal(repository.leaseSynthesis(context, value.companyId + 1, { owner: "foreign", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 }).length, 0);
    assert.equal(repository.appendVisibility(context, value.companyId + 1, { ...visibility, companyId: value.companyId + 1 }).kind, "not_found");
  } finally { database.close(); }
});

test("EPIC044 PASS6A upload authorization fences policy and authority without sending", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), repository = new WhatsAppVoiceRepository(database); database.prepare("DELETE FROM outbound_deliveries WHERE id='odl_044_1'").run(); database.prepare("DELETE FROM provider_message_records WHERE id='pmr_044_1'").run(); const deliveryId = seedDeferredVoiceDelivery(database, value);
    database.prepare("UPDATE provider_message_records SET transport_connection_id=? WHERE id='pmr_04400000000000000000000000000002'").run(value.connectionId); database.prepare("UPDATE outbound_deliveries SET transport_connection_id=?,state='pending',payload_kind='audio',media_asset_id=? WHERE id=?").run(value.connectionId, value.assetId, deliveryId);
    database.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?)").run(value.conversationId, at, at);
    assert.equal(repository.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: "enable-pass6a", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", occurredAt: at }).kind, "applied");
    assert.equal(repository.createUpload(context, value.companyId, { id: "wou_pass6a", workspaceId: value.workspaceId, companyId: value.companyId, outboundDeliveryId: deliveryId, mediaAssetId: value.assetId, createdAt: at, updatedAt: at }).kind, "created");
    const leased = repository.leaseUploads(context, value.companyId, { owner: "upload", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    assert.deepEqual(repository.authorizeUpload(context, value.companyId, leased.id, "upload", at), { kind: "authorized", connectionId: value.connectionId, mediaType: "audio/ogg", filename: null });
    database.prepare("UPDATE conversation_controls SET state='human_required',authority_generation=2 WHERE conversation_id=?").run(value.conversationId);
    assert.equal(repository.finalizeUpload(context, value.companyId, leased.id, "upload", { kind: "uploaded", providerMediaId: "meta-media" }, at)?.state, "failed");
    assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "suppressed", payload_kind: "audio" });
    assert.deepEqual({ ...(database.prepare("SELECT provider_media_id,state,safe_error_category FROM whatsapp_outbound_media_uploads WHERE id='wou_pass6a'").get() as Record<string, unknown>) }, { provider_media_id: null, state: "failed", safe_error_category: "suppressed" });
  } finally { database.close(); }
});

test("EPIC044 PASS5A retains the reserved slot until audio, fallback, or suppression", () => {
  const database = createDatabase(":memory:");
  try {
    const value = seed(database), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), repository = new WhatsAppVoiceRepository(database); database.prepare("DELETE FROM outbound_deliveries WHERE id='odl_044_1'").run(); database.prepare("DELETE FROM provider_message_records WHERE id='pmr_044_1'").run(); const deliveryId = seedDeferredVoiceDelivery(database, value); database.prepare("UPDATE provider_message_records SET transport_connection_id=? WHERE id='pmr_04400000000000000000000000000002'").run(value.connectionId); database.prepare("UPDATE outbound_deliveries SET transport_connection_id=?,state='blocked_by_synthesis',payload_kind='deferred_voice',media_asset_id=NULL WHERE id=?").run(value.connectionId,deliveryId);
    database.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?)").run(value.conversationId, at, at);
    assert.equal(repository.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: "enable-pass5a", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", occurredAt: at }).kind, "applied");
    const enqueue = (id: string) => repository.enqueueSynthesis(context, value.companyId, { id, workspaceId: value.workspaceId, companyId: value.companyId, conversationId: value.conversationId, messageId: value.outboundId, outboundDeliveryId: deliveryId, expectedAuthorityGeneration: 1, createdAt: at, updatedAt: at });
    database.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,?,?,?,?,?)").run("cmsg_044_later", value.conversationId, "cpt_04400000000000000000000000000002", "outbound", "Later", "later", null, at);
    database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_04400000000000000000000000000003", "whatsapp", "meta", "outbound", value.connectionId, "cmsg_044_later", null, at, at);
    database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?)").run("odl_04400000000000000000000000000003", "pmr_04400000000000000000000000000003", value.connectionId, at, at, at);
    const deliveries = new OutboundDeliveryRepository(database);
    assert.deepEqual(deliveries.leaseReady("dispatch", at, "2026-08-27T12:05:00.000Z", 10), []);
    assert.equal(enqueue("vsr_pass5a_retry").kind, "created");
    let request = repository.leaseSynthesis(context, value.companyId, { owner: "tts", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    assert.deepEqual(repository.authorizeSynthesis(context, value.companyId, request.id, "tts", at), { kind: "authorized", text: "Answer" });
    assert.equal(repository.finalizeSynthesis(context, value.companyId, request.id, "tts", { kind: "retryable", safeFailureCategory: "provider_unavailable", updatedAt: at })?.state, "retryable");
    assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "blocked_by_synthesis", payload_kind: "deferred_voice" });
    request = repository.leaseSynthesis(context, value.companyId, { owner: "tts", now: "2026-08-27T12:01:00.000Z", expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    assert.equal(repository.finalizeSynthesis(context, value.companyId, request.id, "tts", { kind: "completed", mediaAssetId: value.assetId, updatedAt: "2026-08-27T12:01:00.000Z" })?.state, "completed");
    assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind,media_asset_id FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "pending", payload_kind: "audio", media_asset_id: value.assetId });
    const automaticUpload = database.prepare("SELECT id,workspace_id,company_id,outbound_delivery_id,media_asset_id,state FROM whatsapp_outbound_media_uploads WHERE outbound_delivery_id=?").get(deliveryId) as Record<string, unknown>;
    assert.match(automaticUpload.id as string, /^wou_[0-9a-f]{16}$/);
    assert.deepEqual({ ...automaticUpload, id: undefined }, { id: undefined, workspace_id: value.workspaceId, company_id: value.companyId, outbound_delivery_id: deliveryId, media_asset_id: value.assetId, state: "pending_upload" });
    assert.equal(repository.createUpload(context, value.companyId, { id: "wou_replay_044", workspaceId: value.workspaceId, companyId: value.companyId, outboundDeliveryId: deliveryId, mediaAssetId: value.assetId, createdAt: "2026-08-27T12:01:00.000Z", updatedAt: "2026-08-27T12:01:00.000Z" }).kind, "replayed");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM whatsapp_outbound_media_uploads WHERE outbound_delivery_id=?").get(deliveryId) as { count: number }).count, 1);
    assert.deepEqual(deliveries.leaseReady("dispatch", "2026-08-27T12:01:00.000Z", "2026-08-27T12:05:00.000Z", 10), []);
    assert.deepEqual(deliveries.leaseReady("dispatch-later", "2026-08-27T12:01:00.000Z", "2026-08-27T12:05:00.000Z", 10), []);
    assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "pending", payload_kind: "audio" });
    const assistantRowid = (database.prepare("SELECT rowid FROM conversation_messages WHERE id=?").get(value.outboundId) as { rowid: number }).rowid;
    const retryableUpload = repository.leaseUploads(context, value.companyId, { owner: "upload-retry", now: "2026-08-27T12:01:00.000Z", expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    assert.equal(repository.finalizeUpload(context, value.companyId, retryableUpload.id, "upload-retry", { kind: "retryable", safeFailureCategory: "provider_unavailable" }, "2026-08-27T12:01:00.000Z")?.state, "expired");
    assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind,media_asset_id FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "pending", payload_kind: "audio", media_asset_id: value.assetId });
    assert.deepEqual(deliveries.leaseReady("dispatch-retryable", "2026-08-27T12:01:00.000Z", "2026-08-27T12:05:00.000Z", 10), []);
    const failedUpload = repository.leaseUploads(context, value.companyId, { owner: "upload-failed", now: "2026-08-27T12:02:00.000Z", expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
    assert.equal(repository.finalizeUpload(context, value.companyId, failedUpload.id, "upload-failed", { kind: "failed", safeFailureCategory: "provider_rejected" }, "2026-08-27T12:02:00.000Z")?.state, "failed");
    assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind,response_policy,media_asset_id FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "pending", payload_kind: "text", response_policy: "deferred_voice", media_asset_id: null });
    assert.equal((database.prepare("SELECT rowid FROM conversation_messages WHERE id=?").get(value.outboundId) as { rowid: number }).rowid, assistantRowid);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM voice_response_visibility WHERE outbound_delivery_id=?").get(deliveryId) as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_messages WHERE conversation_message_id=?").get(value.outboundId) as { count: number }).count, 0);
    assert.deepEqual(deliveries.leaseReady("dispatch-fallback", "2026-08-27T12:02:00.000Z", "2026-08-27T12:05:00.000Z", 10).map(delivery => delivery.id), [deliveryId]);

  } finally { database.close(); }
});

test("EPIC044 PASS5A terminal fallback and authority loss settle the same reservation", () => {
  for (const outcome of ["failed", "suppressed"] as const) {
    const database = createDatabase(":memory:");
    try {
      const value = seed(database), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), repository = new WhatsAppVoiceRepository(database); database.prepare("DELETE FROM outbound_deliveries WHERE id='odl_044_1'").run(); database.prepare("DELETE FROM provider_message_records WHERE id='pmr_044_1'").run(); const deliveryId = seedDeferredVoiceDelivery(database, value); database.prepare("UPDATE provider_message_records SET transport_connection_id=? WHERE id='pmr_04400000000000000000000000000002'").run(value.connectionId); database.prepare("UPDATE outbound_deliveries SET transport_connection_id=?,state='blocked_by_synthesis',payload_kind='deferred_voice',media_asset_id=NULL WHERE id=?").run(value.connectionId,deliveryId);
      database.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?)").run(value.conversationId, at, at);
      repository.applyPolicy(context, value.companyId, value.connectionId, { actorId: "usr_044", operationId: `enable-${outcome}`, expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", occurredAt: at });
      assert.equal(repository.enqueueSynthesis(context, value.companyId, { id: `vsr_pass5a_${outcome}`, workspaceId: value.workspaceId, companyId: value.companyId, conversationId: value.conversationId, messageId: value.outboundId, outboundDeliveryId: deliveryId, expectedAuthorityGeneration: 1, createdAt: at, updatedAt: at }).kind, "created");
      const request = repository.leaseSynthesis(context, value.companyId, { owner: "tts", now: at, expiresAt: "2026-08-27T12:05:00.000Z", limit: 1 })[0]!;
      if (outcome === "failed") {
        assert.equal(repository.finalizeSynthesis(context, value.companyId, request.id, "tts", { kind: "failed", safeFailureCategory: "provider_rejected", updatedAt: at })?.state, "failed");
        assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "pending", payload_kind: "text" });
      } else {
        database.prepare("UPDATE conversation_controls SET state='human_required',authority_generation=2 WHERE conversation_id=?").run(value.conversationId);
        assert.deepEqual(repository.authorizeSynthesis(context, value.companyId, request.id, "tts", at), { kind: "suppressed" });
        assert.deepEqual({ ...(database.prepare("SELECT state,payload_kind FROM outbound_deliveries WHERE id=?").get(deliveryId) as Record<string, unknown>) }, { state: "suppressed", payload_kind: "deferred_voice" });
      }
    } finally { database.close(); }
  }
});
