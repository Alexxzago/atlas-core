import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { OutboundDeliveryRepository } from "../repositories/outboundDeliveryRepository.js";
import { ProviderMessageRecordRepository } from "../repositories/providerMessageRecordRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WhatsAppVoiceRepository } from "../repositories/whatsappVoiceRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { FakeWhatsAppOutboundProvider } from "./support/fakeWhatsAppOutboundProvider.js";
import { WhatsAppOutboundDeliveryService } from "../whatsapp/services/WhatsAppOutboundDeliveryService.js";
import { WhatsAppCloudApiError } from "../whatsapp/providers/WhatsAppCloudApiProvider.js";
import { ProviderDeliveryDomainError } from "../transport/domain/providerDelivery.js";

const at = "2026-08-27T12:00:00.000Z";

function setup(beforeBegin?: () => void) {
  const database = createDatabase(":memory:"), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
  const company = new CompanyRepository(database).create(context, { name: "PASS6B1", website: "https://pass6b1.test" });
  const profileId = "asp_" + "2".repeat(32), connectionId = "wac_" + "2".repeat(32);
  database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(profileId, company.id, "Voice", "voice", "friendly", "en", "Fallback", "ready", at, at, null);
  database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, company.id, profileId, "phone", "waba", "active", at, at);
  database.prepare("UPDATE whatsapp_voice_policies SET voice_ai_enabled=1,audio_response_mode='voice_with_text_fallback' WHERE whatsapp_connection_id=?").run(connectionId);
  const conversationId = "cnv_" + "1".repeat(32), participantId = "cpt_" + "1".repeat(32), messageId = "cmsg_" + "1".repeat(32);
  database.prepare("INSERT INTO conversations(id,company_id,channel,state,created_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,?)").run(conversationId, company.id, "whatsapp", "open", at, at, null);
  database.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at,authority_generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(conversationId, "automated", null, null, null, null, null, null, null, null, 1, at, at, 1);
  database.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) VALUES(?,?,?,?,?)").run(participantId, conversationId, "assistant", null, at);
  database.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,?,?,?,?,?)").run(messageId, conversationId, participantId, "outbound", "Voice reply", null, null, at);
  database.prepare("INSERT INTO media_blobs(id,workspace_id,company_id,sha256_digest,size_bytes,media_type,storage_reference,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run("mbl_pass6b1", context.workspaceId, company.id, "a".repeat(64), 4, "audio/ogg", "memory://voice", "active", at);
  database.prepare("INSERT INTO media_assets(id,workspace_id,company_id,blob_id,kind,media_type,size_bytes,safe_filename,metadata_json,status,created_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("mas_pass6b1", context.workspaceId, company.id, "mbl_pass6b1", "audio", "audio/ogg", 4, "voice.ogg", "{}", "ready", at, null, null);
  const provider = new FakeWhatsAppOutboundProvider(), deliveries = new OutboundDeliveryRepository(database), voices = new WhatsAppVoiceRepository(database);
  let recovered = 0;
  const service = new WhatsAppOutboundDeliveryService(new ConversationRepository(database), new WhatsAppConnectionRepository(database), new ProviderMessageRecordRepository(database), deliveries, { resolve: () => { beforeBegin?.(); return "token"; } } as never, () => provider, { now: () => at }, undefined, { findBindingByConversation: () => ({ whatsAppConnectionId: connectionId, waId: "15551234567" }) } as never, voices, { recover: async () => { recovered += 1; return 0; } } as never);
  const addAudio = (suffix: string) => {
    const id = `odl_${suffix}`, record = `pmr_${suffix}`;
    const outboundMessageId = `cmsg_${suffix}`;
    database.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,?,?,?,?,?)").run(outboundMessageId, conversationId, participantId, "outbound", `Voice reply ${suffix}`, null, null, at);
    database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(record, "whatsapp", "meta_whatsapp_cloud", "outbound", connectionId, outboundMessageId, null, at, at);
    database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, record, connectionId, "pending", 0, at, "audio", "deferred_voice", "mas_pass6b1", 1, at, at);
    database.prepare("INSERT INTO whatsapp_outbound_media_uploads(id,workspace_id,company_id,outbound_delivery_id,media_asset_id,provider_media_id,state,lease_owner,lease_expires_at,attempt_count,safe_error_category,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,0,NULL,?,?)").run(`wou_${suffix}`, context.workspaceId, company.id, id, "mas_pass6b1", "provider-media-id", "uploaded", at, at);
    return id;
  };
  return { database, context, company, deliveries, provider, service, addAudio, recovered: () => recovered };
}

function state(value: ReturnType<typeof setup>, id: string) { return value.database.prepare("SELECT state,send_started_at,attempt_count,safe_error_category FROM outbound_deliveries WHERE id=?").get(id) as { state: string; send_started_at: string | null; attempt_count: number; safe_error_category: string | null }; }
function visibility(value: ReturnType<typeof setup>, id: string) { return (value.database.prepare("SELECT COUNT(*) AS count FROM voice_response_visibility WHERE outbound_delivery_id=?").get(id) as { count: number }).count; }

test("EPIC044 PASS6B1 atomically accepts an uploaded audio delivery and exposes deferred voice once", async () => {
  const value = setup();
  try {
    const id = value.addAudio("a".repeat(32)); value.provider.enqueueAccepted("wamid-audio");
    await value.service.dispatchReady("worker");
    assert.deepEqual(value.provider.calls, [{ kind: "audio", providerMediaId: "provider-media-id" }]);
    assert.deepEqual({ ...(value.database.prepare("SELECT d.state,d.send_started_at,p.external_message_id FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id WHERE d.id=?").get(id) as Record<string, unknown>) }, { state: "accepted", send_started_at: at, external_message_id: "wamid-audio" });
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM voice_response_visibility WHERE outbound_delivery_id=?").get(id) as { count: number }).count, 1);
    assert.equal(value.recovered(), 1);
  } finally { value.database.close(); }
});

test("EPIC044 PASS6B1 persists started sends as uncertain without retrying and lets delayed acceptance win", async () => {
  const value = setup();
  try {
    const id = value.addAudio("b".repeat(32)), delayed = value.provider.enqueueDelayed();
    const first = value.service.dispatchReady("worker-a");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((value.database.prepare("SELECT send_started_at FROM outbound_deliveries WHERE id=?").get(id) as { send_started_at: string }).send_started_at, at);
    await value.service.dispatchReady("worker-b");
    assert.equal((value.database.prepare("SELECT state FROM outbound_deliveries WHERE id=?").get(id) as { state: string }).state, "uncertain");
    assert.equal(value.provider.calls.length, 1);
    delayed.resolve("wamid-late"); await first;
    assert.deepEqual({ ...(value.database.prepare("SELECT d.state,p.external_message_id FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id WHERE d.id=?").get(id) as Record<string, unknown>) }, { state: "accepted", external_message_id: "wamid-late" });
    assert.equal(value.recovered(), 1);
  } finally { value.database.close(); }
});

test("EPIC044 PASS6B1 accepts standard text without deferred visibility and retries only explicit retryable failures", async () => {
  const value = setup();
  try {
    const textId = "odl_" + "c".repeat(32), recordId = "pmr_" + "c".repeat(32);
    value.database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(recordId, "whatsapp", "meta_whatsapp_cloud", "outbound", "wac_" + "2".repeat(32), "cmsg_" + "1".repeat(32), null, at, at);
    value.database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,payload_kind,response_policy,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(textId, recordId, "wac_" + "2".repeat(32), "pending", 0, at, "text", "standard", 1, at, at);
    value.provider.onCall = () => assert.equal(value.database.isTransaction, false); value.provider.enqueueAccepted("wamid-text"); await value.service.dispatchReady("worker");
    assert.equal(state(value, textId).state, "accepted"); assert.equal(visibility(value, textId), 0); assert.equal(value.recovered(), 0);
    const retryId = value.addAudio("d".repeat(32)); value.provider.enqueueFailed(new WhatsAppCloudApiError(429, null)); await value.service.dispatchReady("worker");
    assert.deepEqual({ ...state(value, retryId) }, { state: "retryable", send_started_at: null, attempt_count: 1, safe_error_category: "rate_limited" }); assert.equal(visibility(value, retryId), 0);
  } finally { value.database.close(); }
});

test("EPIC044 PASS6B1 makes permanent failures terminal, gates audio, and releases the next ordered delivery", async () => {
  const value = setup();
  try {
    const first = value.addAudio("e".repeat(32)); const second = value.addAudio("f".repeat(32));
    value.provider.enqueueFailed(new WhatsAppCloudApiError(400, null)); await value.service.dispatchReady("worker");
    assert.equal(state(value, first).state, "permanent_failure"); assert.equal(visibility(value, first), 0);
    value.provider.enqueueAccepted("wamid-second"); await value.service.dispatchReady("worker"); assert.equal(state(value, second).state, "accepted");
    const gated = value.addAudio("0".repeat(32)); value.database.prepare("DELETE FROM whatsapp_outbound_media_uploads WHERE outbound_delivery_id=?").run(gated);
    await value.service.dispatchReady("worker"); assert.equal(state(value, gated).state, "pending"); assert.equal(value.provider.calls.length, 2);
  } finally { value.database.close(); }
});

test("EPIC044 PASS6B1 validates provider IDs atomically and treats accepted replay/divergence safely", () => {
  const value = setup();
  try {
    const id = value.addAudio("9".repeat(32)); const leased = value.deliveries.leaseReady("worker", at, "2026-08-27T12:01:00.000Z", 1)[0]!;
    assert.equal(value.deliveries.beginSend(leased.id, "worker", at), true);
    assert.throws(() => value.deliveries.acceptSend(leased.id, "worker", " ", at), ProviderDeliveryDomainError);
    assert.throws(() => value.deliveries.acceptSend(leased.id, "worker", "x".repeat(257), at), ProviderDeliveryDomainError);
    assert.deepEqual({ ...state(value, id) }, { state: "leased", send_started_at: at, attempt_count: 1, safe_error_category: null }); assert.equal(visibility(value, id), 0);
    assert.equal(value.deliveries.acceptSend(leased.id, "worker", "wamid-safe", at)?.state, "accepted"); assert.equal(visibility(value, id), 1);
    assert.equal(value.deliveries.acceptSend(leased.id, "worker", "wamid-safe", at)?.state, "accepted"); assert.equal(value.deliveries.acceptSend(leased.id, "worker", "wamid-divergent", at), null);
    assert.equal((value.database.prepare("SELECT external_message_id FROM provider_message_records WHERE id=?").get("pmr_" + "9".repeat(32)) as { external_message_id: string }).external_message_id, "wamid-safe"); assert.equal(visibility(value, id), 1);
  } finally { value.database.close(); }
});

test("EPIC044 PASS6B1 never exposes malformed provider acceptance results", async () => {
  const value = setup();
  try {
    const id = value.addAudio("a".repeat(31) + "b"); value.provider.enqueueAccepted("x".repeat(257)); await value.service.dispatchReady("worker");
    assert.deepEqual({ ...state(value, id) }, { state: "uncertain", send_started_at: at, attempt_count: 1, safe_error_category: "send_outcome_unknown" }); assert.equal(visibility(value, id), 0);
    assert.equal((value.database.prepare("SELECT external_message_id FROM provider_message_records WHERE id=?").get("pmr_" + "a".repeat(31) + "b") as { external_message_id: string | null }).external_message_id, null);
  } finally { value.database.close(); }
});

test("EPIC044 PASS6B1 suppresses authority loss before and between start, while acceptance wins after the call starts", async () => {
  const before = setup();
  try {
    const id = before.addAudio("2".repeat(32)); before.database.prepare("UPDATE conversation_controls SET state='human_required',authority_generation=2 WHERE conversation_id=?").run("cnv_" + "1".repeat(32)); await before.service.dispatchReady("worker");
    assert.equal(state(before, id).state, "suppressed"); assert.equal(before.provider.calls.length, 0);
  } finally { before.database.close(); }
  let betweenDatabase: ReturnType<typeof setup>["database"] | null = null;
  const between = setup(() => { betweenDatabase?.prepare("UPDATE conversation_controls SET state='human_required',authority_generation=2 WHERE conversation_id=?").run("cnv_" + "1".repeat(32)); }); betweenDatabase = between.database;
  try {
    const id = between.addAudio("3".repeat(32)); await between.service.dispatchReady("worker"); assert.equal(state(between, id).state, "suppressed"); assert.equal(between.provider.calls.length, 0);
  } finally { between.database.close(); }
  const during = setup();
  try {
    const id = during.addAudio("4".repeat(32)), delayed = during.provider.enqueueDelayed(), dispatch = during.service.dispatchReady("worker"); await new Promise<void>((resolve) => setImmediate(resolve));
    during.database.prepare("UPDATE conversation_controls SET state='human_required',authority_generation=2 WHERE conversation_id=?").run("cnv_" + "1".repeat(32)); delayed.resolve("wamid-during"); await dispatch;
    assert.equal(state(during, id).state, "accepted"); assert.equal(visibility(during, id), 1);
  } finally { during.database.close(); }
});
