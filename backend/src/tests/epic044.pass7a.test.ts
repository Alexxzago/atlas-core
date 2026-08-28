import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { createDatabase } from "../config/database.js";
import { encodeConversationEventFeedCursor } from "../conversation/domain/conversationEventFeed.js";
import { ConversationEventFeedService } from "../conversation/services/conversationEventFeedService.js";
import { createConversationEventFeedController } from "../controllers/conversationEventFeedController.js";
import { createVoicePlaybackController, createVoiceReadController } from "../controllers/voiceReadController.js";
import { createMediaCore } from "../media/composition.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WhatsAppVoiceRepository } from "../repositories/whatsappVoiceRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { VoiceReadService } from "../whatsapp/services/voiceReadService.js";

const at = "2026-08-28T12:00:00.000Z";
const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4]);

async function* content(): AsyncIterable<Uint8Array> { yield bytes; }

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-pass7a-"));
  const database = createDatabase(join(directory, "atlas.sqlite"));
  const workspace = new WorkspaceRepository(database).resolveDefault(), context = createWorkspaceContext(workspace);
  const company = new CompanyRepository(database).create(context, { name: "PASS7A", website: "https://pass7a.test" });
  const media = createMediaCore(database, join(directory, "media"), { now: () => at }).service;
  const asset = await media.store(context, company.id, { operation: "ingest", idempotencyKey: "pass7a-audio", declaredMediaType: "audio/ogg", filename: "voice.ogg", content: content() });
  const conversationId = "cnv_" + "7".repeat(32), customerId = "cpt_" + "7".repeat(32), assistantId = "cpt_" + "8".repeat(32);
  const inboundId = "cmsg_" + "7".repeat(32), unsupportedId = "cmsg_" + "6".repeat(32), audioId = "cmsg_" + "5".repeat(32), fallbackId = "cmsg_" + "4".repeat(32), standardId = "cmsg_" + "3".repeat(32);
  database.prepare("INSERT INTO conversations(id,company_id,channel,state,created_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,NULL)").run(conversationId, company.id, "whatsapp", "open", at, at);
  database.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) VALUES(?,?,?,?,?)").run(customerId, conversationId, "customer", null, at);
  database.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) VALUES(?,?,?,?,?)").run(assistantId, conversationId, "assistant", null, at);
  for (const [id, sender, direction, text] of [[inboundId, customerId, "inbound", "[audio]"], [unsupportedId, customerId, "inbound", "[audio]"], [audioId, assistantId, "outbound", "Audio answer"], [fallbackId, assistantId, "outbound", "Fallback answer"], [standardId, assistantId, "outbound", "Standard answer"]] as const) database.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)").run(id, conversationId, sender, direction, text, id, at);
  const webConversationId = "cnv_" + "2".repeat(32), webParticipantId = "cpt_" + "2".repeat(32), webMessageId = "cmsg_" + "2".repeat(32);
  database.prepare("INSERT INTO conversations(id,company_id,channel,state,created_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,NULL)").run(webConversationId, company.id, "web_chat", "open", at, at);
  database.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) VALUES(?,?,?,?,?)").run(webParticipantId, webConversationId, "assistant", null, at);
  database.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)").run(webMessageId, webConversationId, webParticipantId, "outbound", "Web response", webMessageId, at);
  const profileId = "asp_" + "7".repeat(32), connectionId = "wac_" + "7".repeat(32);
  database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run(profileId, company.id, "Voice", "voice", "friendly", "en", "Fallback", "ready", at, at);
  database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, company.id, profileId, "phone", "waba", "active", at, at);
  for (const [eventId, messageId, state] of [["cpe_" + "7".repeat(32), inboundId, "pending"], ["cpe_" + "6".repeat(32), unsupportedId, "unsupported"]] as const) {
    database.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)").run(eventId, "whatsapp", "meta", connectionId, eventId, conversationId, messageId, at, at);
    database.prepare("INSERT INTO channel_execution_requests(id,channel_provider_event_id,state,snapshot_json,lease_owner,lease_expires_at,outcome,created_at,updated_at,media_gate_state) VALUES(?,?,?,'{}',NULL,NULL,?,?,?,'open')").run(`cex_${eventId.slice(4)}`, eventId, state, state === "unsupported" ? "unsupported" : null, at, at);
    database.prepare("INSERT INTO whatsapp_inbound_media(id,workspace_id,company_id,whatsapp_connection_id,channel_provider_event_id,conversation_message_id,provider_media_id,provider_kind,declared_mime,safe_filename,ordinal,caption_present,state,media_asset_id,failure_code,attempt_count,next_attempt_at,created_at,updated_at,completed_at,lease_token,lease_owner,lease_acquired_at,lease_expires_at,last_retry_failure_code,last_retry_failure_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,'associated',?,NULL,0,NULL,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL)").run(`wim_${eventId.slice(4)}`, context.workspaceId, company.id, connectionId, eventId, messageId, `media_${messageId}`, "audio", "audio/ogg", null, asset.id, at, at, at);
  }
  const voices = new WhatsAppVoiceRepository(database);
  assert.equal(voices.enqueueTranscription(context, company.id, { id: "atr_" + "7".repeat(32), workspaceId: context.workspaceId, companyId: company.id, conversationId, messageId: inboundId, mediaAssetId: asset.id, expectedAuthorityGeneration: 1, createdAt: at, updatedAt: at }).kind, "created");
  assert.equal(voices.createTranscript(context, company.id, { id: "cat_" + "7".repeat(32), conversationId, messageId: inboundId, mediaAssetId: asset.id, normalizedTranscript: "Canonical customer request", languageTag: "en", inputDigest: "a".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: at }).kind, "created");
  for (const [messageId, deliveryId, state, payload, policy] of [[audioId, "odl_" + "5".repeat(32), "accepted", "audio", "deferred_voice"], [fallbackId, "odl_" + "4".repeat(32), "pending", "text", "deferred_voice"], [standardId, "odl_" + "3".repeat(32), "accepted", "text", "standard"]] as const) {
    const recordId = `pmr_${messageId.slice(5)}`;
    database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(recordId, "whatsapp", "meta", "outbound", connectionId, messageId, state === "accepted" ? `wamid_${messageId}` : null, at, at);
    database.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,?,?, ?,NULL,NULL,NULL,?,?,?,?,?,?)").run(deliveryId, recordId, connectionId, state, 0, at, payload, policy, payload === "audio" ? asset.id : null, policy === "deferred_voice" ? 1 : null, at, at);
  }
  database.prepare("INSERT INTO whatsapp_outbound_media_uploads(id,workspace_id,company_id,outbound_delivery_id,media_asset_id,provider_media_id,state,lease_owner,lease_expires_at,attempt_count,safe_error_category,created_at,updated_at) VALUES(?,?,?,?,?,?,'uploaded',NULL,NULL,0,NULL,?,?)").run("wou_" + "5".repeat(32), context.workspaceId, company.id, "odl_" + "5".repeat(32), asset.id, "internal-media-id", at, at);
  database.prepare("INSERT INTO voice_synthesis_requests(id,workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id,expected_authority_generation,state,lease_owner,lease_expires_at,attempt_count,safe_outcome,safe_failure_category,rendition_settlement_id,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,1,'failed',NULL,NULL,1,'failed','provider_unavailable',NULL,?,?,?)").run("vsr_" + "4".repeat(32), context.workspaceId, company.id, conversationId, fallbackId, "odl_" + "4".repeat(32), at, at, at);
  return { directory, database, context, workspacePublicId: workspace.publicId, company, media, voices, conversationId, inboundId, unsupportedId, audioId, fallbackId, standardId, webConversationId, webMessageId };
}

test("EPIC044 PASS7A reads persisted Voice state and playback after restart without exposing internal state", async () => {
  const value = await fixture();
  try {
    value.database.close();
    const restarted = createDatabase(join(value.directory, "atlas.sqlite"));
    const voices = new WhatsAppVoiceRepository(restarted), service = new VoiceReadService(voices, createMediaCore(restarted, join(value.directory, "media"), { now: () => at }).service);
    const feed = new ConversationEventFeedService(new ConversationRepository(restarted)), app = express();
    app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "reader" ? { userId: raw } : null, validateCsrf: () => true } as never, users: { findById: () => ({ id: "reader", status: "active" }) } as never, authorization: { authorize: (_user: unknown, workspace: string, permission: string) => { if (workspace !== value.workspacePublicId || permission !== "company:read") throw new Error("denied"); return { userId: "reader", membershipId: "member", role: "operator", capabilities: new Set([permission]), workspaceId: value.context.workspaceId, workspacePublicId: workspace, permission }; } } as never, resolver: { resolve: () => value.context } as never, controllers: {} as never, assistantControllers: {} as never, conversationReadControllers: { list: () => ((_req, res) => res.end()), get: () => ((_req, res) => res.end()), feed: scoped => createConversationEventFeedController(feed, scoped), voice: scoped => createVoiceReadController(service, scoped), playback: scoped => createVoicePlaybackController(service, scoped) } }));
    const listener = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => listener.once("listening", resolve));
    const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`, base = `${origin}/workspaces/${value.workspacePublicId}/companies/${value.company.id}/conversations/${value.conversationId}/messages`, headers = { cookie: "atlas=reader" };
    try {
      const beforeReadEvents = (restarted.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed'").get() as { count: number }).count;
      const read = await fetch(`${base}/${value.inboundId}/voice`, { headers }); assert.equal(read.status, 200); assert.deepEqual(await read.json(), { messageId: value.inboundId, direction: "inbound", modality: "audio", transcript: "Canonical customer request", transcriptLanguageTag: "en", transcriptionState: "completed", deferredState: null, fallbackAvailable: false, playbackAvailable: true });
      const playback = await fetch(`${base}/${value.inboundId}/voice/playback`, { headers }); assert.equal(playback.status, 200); assert.deepEqual(new Uint8Array(await playback.arrayBuffer()), bytes); assert.equal(playback.headers.get("cache-control"), "no-store, private"); assert.equal(playback.headers.get("content-type"), "audio/ogg"); assert.equal(playback.headers.get("content-length"), String(bytes.byteLength)); assert.equal(playback.headers.get("content-disposition"), "inline; filename=voice-audio"); assert.equal(playback.headers.get("content-security-policy"), "sandbox"); assert.equal(playback.headers.get("x-content-type-options"), "nosniff"); assert.equal(playback.headers.get("accept-ranges"), "none"); assert.equal((restarted.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed'").get() as { count: number }).count, beforeReadEvents);
      assert.deepEqual(voices.findMessageReadModel(value.context, value.company.id, value.conversationId, value.unsupportedId), { messageId: value.unsupportedId, direction: "inbound", modality: "audio", transcript: null, transcriptLanguageTag: null, transcriptionState: "unsupported", deferredState: null, fallbackAvailable: false, playbackAvailable: true });
      const outbound = await fetch(`${base}/${value.audioId}/voice`, { headers }); assert.equal(outbound.status, 200); assert.deepEqual(await outbound.json(), { messageId: value.audioId, direction: "outbound", modality: "voice", transcript: null, transcriptLanguageTag: null, transcriptionState: null, deferredState: "accepted", fallbackAvailable: false, playbackAvailable: true });
      assert.equal(voices.findMessageReadModel(value.context, value.company.id, value.conversationId, value.fallbackId)?.deferredState, "fallback"); assert.equal(voices.findMessageReadModel(value.context, value.company.id, value.conversationId, value.standardId), null); assert.equal(voices.findMessageReadModel(value.context, value.company.id, value.webConversationId, value.webMessageId), null);
      assert.equal((await fetch(`${base}/${value.standardId}/voice`, { headers })).status, 404); restarted.prepare("UPDATE outbound_deliveries SET payload_kind='audio',media_asset_id=? WHERE id=?").run((restarted.prepare("SELECT media_asset_id FROM outbound_deliveries WHERE id=?").get("odl_" + "5".repeat(32)) as { media_asset_id: string }).media_asset_id, "odl_" + "3".repeat(32)); assert.equal((await fetch(`${base}/${value.standardId}/voice/playback`, { headers })).status, 404); assert.equal((await fetch(`${base}/${value.inboundId}/voice/playback`, { headers: { ...headers, range: "bytes=0-1" } })).status, 416); assert.equal((await fetch(`${base}/${value.inboundId}/voice`, { headers: { cookie: "atlas=missing" } })).status, 404); assert.equal((await fetch(`${origin}/workspaces/not-a-workspace/companies/${value.company.id}/conversations/${value.conversationId}/messages/${value.inboundId}/voice`, { headers })).status, 404); assert.equal((await fetch(`${origin}/workspaces/${value.workspacePublicId}/companies/${value.company.id + 1}/conversations/${value.conversationId}/messages/${value.inboundId}/voice`, { headers })).status, 404); assert.equal((await fetch(`${origin}/workspaces/${value.workspacePublicId}/companies/${value.company.id}/conversations/${value.webConversationId}/messages/${value.inboundId}/voice/playback`, { headers })).status, 404);
      const bootstrap = await (await fetch(`${origin}/workspaces/${value.workspacePublicId}/companies/${value.company.id}/conversations/feed`, { headers })).json() as { nextCursor: string };
      const before = (restarted.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed'").get() as { count: number }).count; restarted.prepare("UPDATE outbound_deliveries SET state='read',updated_at=? WHERE id=?").run(at, "odl_" + "5".repeat(32)); restarted.prepare("UPDATE outbound_deliveries SET state='read',updated_at=? WHERE id=?").run(at, "odl_" + "5".repeat(32)); assert.equal((restarted.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed'").get() as { count: number }).count, before + 1);
      const feedUrl = `${origin}/workspaces/${value.workspacePublicId}/companies/${value.company.id}/conversations/feed?after=${encodeURIComponent(bootstrap.nextCursor)}`, response = await fetch(feedUrl, { headers }), body = await response.json() as { events: Array<Record<string, unknown>> }; assert.equal(response.status, 200); assert.deepEqual(body.events.map(event => event.type), ["voice_state_changed"]); assert.deepEqual((await (await fetch(feedUrl, { headers })).json() as { events: Array<Record<string, unknown>> }).events, body.events);
      const feedResponse = await fetch(`${origin}/workspaces/${value.workspacePublicId}/companies/${value.company.id}/conversations/feed?after=${encodeURIComponent(encodeConversationEventFeedCursor({ v: 1, w: value.context.workspaceId, c: value.company.id, s: 0 }))}`, { headers }); const safe = JSON.stringify(await feedResponse.json()); for (const forbidden of ["Canonical customer request", "internal-media-id", "provider_unavailable", "sequence", "storage", "lease"]) assert.equal(safe.includes(forbidden), false);
      restarted.prepare("UPDATE outbound_deliveries SET state='delivered',updated_at=? WHERE id=?").run(at, "odl_" + "5".repeat(32)); assert.equal(voices.findMessageReadModel(value.context, value.company.id, value.conversationId, value.audioId)?.deferredState, "delivered"); restarted.prepare("UPDATE outbound_deliveries SET state='read',updated_at=? WHERE id=?").run(at, "odl_" + "5".repeat(32)); assert.equal(voices.findMessageReadModel(value.context, value.company.id, value.conversationId, value.audioId)?.deferredState, "read");
    } finally { await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); restarted.close(); }
  } finally { if (value.database.isOpen) value.database.close(); rmSync(value.directory, { recursive: true, force: true }); }
});

test("EPIC044 PASS7A maps uncertain and permanent Voice delivery outcomes safely", async () => {
  const value = await fixture();
  try {
    value.database.prepare("UPDATE outbound_deliveries SET state='uncertain' WHERE id=?").run("odl_" + "5".repeat(32));
    assert.equal(value.voices.findMessageReadModel(value.context, value.company.id, value.conversationId, value.audioId)?.deferredState, "uncertain");
    value.database.prepare("UPDATE outbound_deliveries SET state='permanent_failure' WHERE id=?").run("odl_" + "5".repeat(32));
    assert.equal(value.voices.findMessageReadModel(value.context, value.company.id, value.conversationId, value.audioId)?.deferredState, "failed");
  } finally { value.database.close(); rmSync(value.directory, { recursive: true, force: true }); }
});

test("EPIC044 PASS7A emits bounded Voice invalidations only for visible state changes", async () => {
  const value = await fixture();
  try {
    const count = () => (value.database.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='voice_state_changed'").get() as { count: number }).count;
    const initial = count();
    assert.equal(value.voices.createTranscript(value.context, value.company.id, { id: "cat_replay", conversationId: value.conversationId, messageId: value.inboundId, mediaAssetId: (value.database.prepare("SELECT media_asset_id FROM whatsapp_inbound_media WHERE conversation_message_id=?").get(value.inboundId) as { media_asset_id: string }).media_asset_id, normalizedTranscript: "Canonical customer request", languageTag: "en", inputDigest: "a".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: at }).kind, "replayed");
    value.database.prepare("UPDATE voice_synthesis_requests SET state='failed',lease_owner='retry',lease_expires_at='2026-08-28T12:05:00.000Z' WHERE conversation_message_id=?").run(value.fallbackId);
    value.database.prepare("UPDATE whatsapp_outbound_media_uploads SET lease_owner='retry',lease_expires_at='2026-08-28T12:05:00.000Z' WHERE outbound_delivery_id=?").run("odl_" + "5".repeat(32));
    value.database.prepare("UPDATE outbound_deliveries SET state='accepted' WHERE id=?").run("odl_" + "5".repeat(32));
    assert.equal(count(), initial);
    value.database.prepare("UPDATE outbound_deliveries SET state='delivered' WHERE id=?").run("odl_" + "5".repeat(32));
    value.database.prepare("UPDATE outbound_deliveries SET state='delivered' WHERE id=?").run("odl_" + "5".repeat(32));
    assert.equal(count(), initial + 1);
  } finally { value.database.close(); rmSync(value.directory, { recursive: true, force: true }); }
});
