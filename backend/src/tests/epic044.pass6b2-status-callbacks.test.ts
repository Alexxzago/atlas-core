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
import { OutboundDeliveryRepository } from "../repositories/outboundDeliveryRepository.js";
import { ProviderMessageRecordRepository } from "../repositories/providerMessageRecordRepository.js";
import { WhatsAppVoiceRepository } from "../repositories/whatsappVoiceRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { DeliveryLifecyclePolicy } from "../transport/domain/providerDelivery.js";
import { MetaDeliveryStatusMapper } from "../whatsapp/services/MetaDeliveryStatusMapper.js";
import { VoiceDeferredSemanticRecoveryService } from "../whatsapp/services/voiceDeferredSemanticRecoveryService.js";
import { WhatsAppDeliveryStatusService } from "../whatsapp/services/WhatsAppDeliveryStatusService.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

const at = "2026-08-28T12:00:00.000Z";
const connectionId = "wac_" + "6".repeat(32);
const phoneNumberId = "phone-pass6b2";

async function setup(path = ":memory:") {
  const database = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), companies = new CompanyRepository(database);
  const company = await companies.findById(context, 1) ?? await companies.create(context, { name: "PASS6B2", website: "https://pass6b2.test" });
  const conversations = new ConversationService(new ConversationRepository(database), { now: () => at }), voices = new WhatsAppVoiceRepository(database), deliveries = new OutboundDeliveryRepository(database), messages = new ProviderMessageRecordRepository(database), derived: string[] = [];
  const intelligence = new ConversationIntelligenceService(new ConversationIntelligenceRepository(database), { derive: async ({ message }) => { derived.push(message.id); return [{ kind: "set_fact", key: "voice", value: message.content }] as const; } }, { now: () => at });
  const recovery = new VoiceDeferredSemanticRecoveryService(voices, intelligence);
  const status = new WhatsAppDeliveryStatusService(messages, deliveries, new MetaDeliveryStatusMapper(), new DeliveryLifecyclePolicy(), { now: () => at }, { resolveActiveByPhoneNumberId: (phone: unknown) => phone === phoneNumberId ? { id: connectionId } : null, recordWebhookActivity: () => undefined } as never);
  const webhook = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, undefined, undefined, undefined, undefined, undefined, { now: () => at }, undefined, undefined, status);
  let ordinal = 0;
  const add = async (suffix: string, responsePolicy: "deferred_voice" | "standard" = "deferred_voice", state: "accepted" | "uncertain" = "accepted") => {
    const conversation = await conversations.open(context, company.id, "whatsapp"), participant = await conversations.addParticipant(context, company.id, conversation.id, { type: "assistant" }), message = await conversations.addMessage(context, company.id, conversation.id, { senderParticipantId: participant.id, direction: "outbound", content: `reply ${suffix}` });
    database.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at,authority_generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(conversation.id, "automated", null, null, null, null, null, null, null, null, 1, at, at, 1);
    const token = (++ordinal).toString(16).padStart(32, "0"), recordId = `pmr_${token}`, deliveryId = `odl_${token}`, externalMessageId = `wamid-${suffix}`;
    database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(recordId, "whatsapp", "meta_whatsapp_cloud", "outbound", connectionId, message.id, null, at, at);
    database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,payload_kind,response_policy,expected_authority_generation,send_started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(deliveryId, recordId, connectionId, "leased", 1, at, "worker", at, "text", responsePolicy, responsePolicy === "deferred_voice" ? 1 : null, at, at, at);
    if (state === "uncertain") {
      assert.ok(messages.attachExternalMessageId(recordId as never, externalMessageId, at));
      database.prepare("UPDATE outbound_deliveries SET state='uncertain',lease_owner=NULL,lease_expires_at=NULL WHERE id=?").run(deliveryId);
    } else assert.equal(deliveries.acceptSend(deliveryId as never, "worker", externalMessageId, at)?.state, "accepted");
    return { conversation, message, deliveryId, externalMessageId };
  };
  return { database, context, company, deliveries, recovery, derived, webhook, add };
}

function callbacks(phone: string, statuses: readonly { readonly id: string; readonly status: string }[]): Buffer { return Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phone }, statuses } }] }] })); }
function deliveryState(value: Awaited<ReturnType<typeof setup>>, id: string): string { return (value.database.prepare("SELECT state FROM outbound_deliveries WHERE id=?").get(id) as { state: string }).state; }
function visibility(value: Awaited<ReturnType<typeof setup>>, id: string): number { return (value.database.prepare("SELECT COUNT(*) AS count FROM voice_response_visibility WHERE outbound_delivery_id=?").get(id) as { count: number }).count; }

test("EPIC044 PASS6B2 routes Voice callbacks through the Meta lifecycle once without post-acceptance side effects", async () => {
  const fixture = await setup();
  try {
    const voice = await fixture.add("voice"), standard = await fixture.add("standard", "standard"), voiceEventsBeforeCallbacks = (fixture.database.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed' AND related_message_id=?").get(voice.message.id) as { count: number }).count;
    assert.equal(visibility(fixture, voice.deliveryId), 1); assert.equal(visibility(fixture, standard.deliveryId), 0);
    await fixture.webhook.acknowledge(callbacks(phoneNumberId, [{ id: voice.externalMessageId, status: "read" }, { id: voice.externalMessageId, status: "delivered" }, { id: voice.externalMessageId, status: "read" }, { id: standard.externalMessageId, status: "delivered" }]));
    assert.equal(deliveryState(fixture, voice.deliveryId), "read"); assert.equal(deliveryState(fixture, standard.deliveryId), "delivered");
    assert.equal((fixture.database.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed' AND related_message_id=?").get(voice.message.id) as { count: number }).count, voiceEventsBeforeCallbacks + 1);
    assert.equal(visibility(fixture, voice.deliveryId), 1); assert.equal((fixture.database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_messages").get() as { count: number }).count, 0);
    assert.equal(await fixture.recovery.recover(fixture.context, fixture.company.id), 1); assert.deepEqual(fixture.derived, [voice.message.id]);
    await fixture.webhook.acknowledge(callbacks(phoneNumberId, [{ id: voice.externalMessageId, status: "read" }, { id: voice.externalMessageId, status: "sent" }]));
    assert.equal(await fixture.recovery.recover(fixture.context, fixture.company.id), 0); assert.equal(visibility(fixture, voice.deliveryId), 1);
    assert.equal((fixture.database.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed' AND related_message_id=?").get(voice.message.id) as { count: number }).count, voiceEventsBeforeCallbacks + 1);
  } finally { fixture.database.close(); }
});

test("EPIC044 PASS6B2 ignores malformed and foreign callbacks and preserves uncertain no-visibility behavior", async () => {
  const fixture = await setup();
  try {
    const voice = await fixture.add("foreign"), uncertain = await fixture.add("uncertain", "deferred_voice", "uncertain");
    await fixture.webhook.acknowledge(callbacks("foreign-phone", [{ id: voice.externalMessageId, status: "read" }]));
    await fixture.webhook.acknowledge(callbacks(phoneNumberId, [{ id: " ", status: "read" }, { id: "x".repeat(257), status: "read" }, { id: "unknown", status: "read" }]));
    assert.equal(deliveryState(fixture, voice.deliveryId), "accepted"); assert.equal(deliveryState(fixture, uncertain.deliveryId), "uncertain"); assert.equal(visibility(fixture, uncertain.deliveryId), 0);
    await fixture.webhook.acknowledge(callbacks(phoneNumberId, [{ id: uncertain.externalMessageId, status: "read" }]));
    assert.equal(deliveryState(fixture, uncertain.deliveryId), "read"); assert.equal(visibility(fixture, uncertain.deliveryId), 0); assert.equal(await fixture.recovery.recover(fixture.context, fixture.company.id), 1); assert.deepEqual(fixture.derived, [voice.message.id]);
  } finally { fixture.database.close(); }
});

test("EPIC044 PASS6B2 recovers atomic Voice acceptance after restart and retains callbacks after authority takeover", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-pass6b2-")), path = join(directory, "atlas.sqlite"), first = await setup(path);
  try {
    const voice = await first.add("restart");
    first.database.prepare("UPDATE conversation_controls SET state='human_required',authority_generation=2 WHERE conversation_id=?").run(voice.conversation.id);
    first.database.close();
    const restarted = await setup(path);
    try {
      assert.equal(visibility(restarted, voice.deliveryId), 1); assert.equal(await restarted.recovery.recover(restarted.context, restarted.company.id), 1); assert.deepEqual(restarted.derived, [voice.message.id]);
      await restarted.webhook.acknowledge(callbacks(phoneNumberId, [{ id: voice.externalMessageId, status: "delivered" }, { id: voice.externalMessageId, status: "read" }]));
      assert.equal(deliveryState(restarted, voice.deliveryId), "read"); assert.equal(visibility(restarted, voice.deliveryId), 1); assert.equal(await restarted.recovery.recover(restarted.context, restarted.company.id), 0);
    } finally { restarted.database.close(); }
  } finally { if (first.database.isOpen) first.database.close(); rmSync(directory, { recursive: true, force: true }); }
});
