import assert from "node:assert/strict";
import test from "node:test";
import { assistantProfileId, reconstructAssistantProfile, type AssistantProfile } from "../assistant/domain/assistantProfile.js";
import { createDatabase } from "../config/database.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { MediaRepository } from "../repositories/mediaRepository.js";
import { createMediaCore } from "../media/composition.js";
import { ConversationMessageMediaAssociationOwnerResolver } from "../repositories/mediaAssociationOwnerResolvers.js";
import { MediaDomainError } from "../media/domain/media.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { ChannelProviderEventRepository } from "../repositories/channelProviderEventRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WhatsAppInboundMediaRepository } from "../repositories/whatsappInboundMediaRepository.js";
import { MetaInboundMediaProvider } from "../whatsapp/providers/MetaInboundMediaProvider.js";
import { WhatsAppInboundMediaDownloadStreamError } from "../whatsapp/application/mediaPorts.js";
import { WhatsAppInboundMediaRecoveryService } from "../whatsapp/services/WhatsAppInboundMediaRecoveryService.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";
import { SafeConversationAttachmentRepository } from "../repositories/safeConversationAttachmentRepository.js";
import { SafeConversationAttachmentService } from "../media/services/safeConversationAttachmentService.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { reconstructChannelExecutionRequest, reconstructChannelProviderEvent, reconstructProviderMessageRecord } from "../transport/domain/providerDelivery.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { reconstructWhatsAppConnection, whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";

const fixtureNow = "2026-08-20T12:00:00.000Z";
const fixtureLeaseExpiresAt = "2026-08-20T12:01:00.000Z";

class FixtureClock {
  public now(): string { return fixtureNow; }
}

function fixtureProfile(companyId: number): AssistantProfile {
  return reconstructAssistantProfile({
    id: assistantProfileId("asp_04000000000000000000000000000000"), companyId, name: "EPIC040", normalizedName: "epic040", description: null,
    businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback",
    status: "ready", createdAt: fixtureNow, updatedAt: fixtureNow, archivedAt: null,
  });
}

export function createEpic040MediaFixture() {
  const db = createDatabase(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault());
  const company = new CompanyRepository(db).create(context, { name: "EPIC040", website: "https://epic040.test", status: "ready" });
  const profile = fixtureProfile(company.id);
  const profileCreated = new AssistantProfileRepository(db).create(context, company.id, profile);
  if (profileCreated.status !== "created") throw new Error("EPIC040 fixture profile was not created.");
  const connection = reconstructWhatsAppConnection({
    id: whatsAppConnectionId("wac_04000000000000000000000000000000"), workspaceId: context.workspaceId, companyId: company.id, assistantProfileId: profile.id,
    phoneNumberId: "phone-epic040", whatsappBusinessAccountId: "waba-epic040", status: "active", createdAt: fixtureNow, updatedAt: fixtureNow,
  });
  if (!new WhatsAppConnectionRepository(db).create(context, connection)) throw new Error("EPIC040 fixture connection was not created.");
  const conversations = new ConversationService(new ConversationRepository(db), new FixtureClock());
  const conversation = conversations.open(context, company.id, "whatsapp");
  const participant = conversations.addParticipant(context, company.id, conversation.id, { type: "whatsapp_contact", reference: "customer-epic040" });
  const event = reconstructChannelProviderEvent({
    id: "cpe_04000000000000000000000000000000" as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", transportConnectionId: connection.id,
    externalEventId: "wamid-epic040", state: "claimed", conversationId: null, conversationMessageId: null, createdAt: fixtureNow, updatedAt: fixtureNow,
  });
  const inbound = conversations.addMessage(context, company.id, conversation.id, { senderParticipantId: participant.id, direction: "inbound", content: "[attachment received]", idempotencyKey: "whatsapp-inbound:epic040", executionRecordId: null });
  const providerMessage = reconstructProviderMessageRecord({
    id: "pmr_04000000000000000000000000000000" as never, communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "inbound",
    transportConnectionId: connection.id, conversationMessageId: inbound.id, externalMessageId: "wamid-epic040", createdAt: fixtureNow, updatedAt: fixtureNow,
  });
  const execution = reconstructChannelExecutionRequest({
    id: "cex_04000000000000000000000000000000" as never, channelProviderEventId: event.id, state: "pending", mediaGateState: "blocked_by_media", snapshot: { version: "epic040" },
    leaseOwner: null, leaseExpiresAt: null, outcome: null, createdAt: fixtureNow, updatedAt: fixtureNow,
  });
  const ledgerId = "wim_04000000000000000000000000000000";
  const captured = new ChannelProviderEventRepository(db).captureInboundExecution(event, inbound, providerMessage, execution, [{
    id: ledgerId, workspaceId: context.workspaceId, companyId: company.id, connectionId: connection.id, eventId: event.id, conversationMessageId: inbound.id,
    descriptor: { wamid: "wamid-epic040", providerMediaId: "media-epic040", kind: "image", declaredMime: "image/jpeg", filename: "epic040.jpg", caption: null, ordinal: 0 },
    state: "pending_download", mediaAssetId: null, failureCode: null, attemptCount: 0, nextAttemptAt: null, createdAt: fixtureNow, updatedAt: fixtureNow, completedAt: null,
  }]);
  const mediaAssetId = "mas_04000000000000000000000000000000";
  const media = new MediaRepository(db);
  const reserved = media.reserve(context, company.id, "ingest", "epic040-media", "0".repeat(64), {
    id: mediaAssetId, workspaceId: context.workspaceId, companyId: company.id, kind: "image", mediaType: "image/jpeg", sizeBytes: null, filename: "epic040.jpg", metadata: {}, status: "pending", createdAt: fixtureNow, archivedAt: null, deletedAt: null,
  }, fixtureNow);
  if (reserved.kind !== "reserved") throw new Error("EPIC040 fixture media asset was not reserved.");
  if (!media.complete(context, company.id, mediaAssetId, { id: "mbl_04000000000000000000000000000000", workspaceId: context.workspaceId, companyId: company.id, digest: "a".repeat(64), sizeBytes: 1, mediaType: "image/jpeg", storageReference: "memory://epic040", state: "active", createdAt: fixtureNow }, fixtureNow)) throw new Error("EPIC040 fixture media asset was not completed.");
  const claim = new WhatsAppInboundMediaRepository(db).claimInboundMediaForRecovery(context, company.id, connection.id, "epic040-worker", fixtureNow, fixtureLeaseExpiresAt);
  if (!claim) throw new Error("EPIC040 fixture ledger was not leased.");
  return { db, workspaceId: context.workspaceId, companyId: company.id, connectionId: connection.id, conversationId: conversation.id, messageId: captured.inbound.id, providerEventId: captured.event.id, executionRequestId: captured.request.id, ledgerId, leaseToken: claim.leaseToken, mediaAssetId, close: (): void => db.close() };
}

interface DurableLedgerState {
  readonly state: string;
  readonly media_asset_id: string | null;
  readonly lease_token: string | null;
  readonly lease_owner: string | null;
  readonly lease_acquired_at: string | null;
  readonly lease_expires_at: string | null;
  readonly attempt_count: number;
  readonly failure_code: string | null;
  readonly last_retry_failure_code: string | null;
  readonly last_retry_failure_at: string | null;
  readonly next_attempt_at: string | null;
}

function durableLedgerState(db: ReturnType<typeof createDatabase>, ledgerId: string): DurableLedgerState {
  const row = db.prepare("SELECT state,media_asset_id,lease_token,lease_owner,lease_acquired_at,lease_expires_at,attempt_count,failure_code,last_retry_failure_code,last_retry_failure_at,next_attempt_at FROM whatsapp_inbound_media WHERE id=?").get(ledgerId) as DurableLedgerState | undefined;
  if (!row) throw new Error("EPIC040 fixture ledger was not found.");
  return { ...row };
}

interface DurableExecutionRequestState {
  readonly state: string;
  readonly media_gate_state: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly updated_at: string;
}

function durableExecutionRequestState(db: ReturnType<typeof createDatabase>, executionRequestId: string): DurableExecutionRequestState {
  const row = db.prepare("SELECT state,media_gate_state,lease_owner,lease_expires_at,updated_at FROM channel_execution_requests WHERE id=?").get(executionRequestId) as DurableExecutionRequestState | undefined;
  if (!row) throw new Error("EPIC040 fixture execution request was not found.");
  return { ...row };
}

function addExecutionMedia(fixture: ReturnType<typeof createEpic040MediaFixture>, ordinal: number): string {
  const id = `wim_0400000000000000000000000000000${ordinal}`;
  new WhatsAppInboundMediaRepository(fixture.db).reserve({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, {
    id, workspaceId: fixture.workspaceId, companyId: fixture.companyId, connectionId: fixture.connectionId, eventId: fixture.providerEventId, conversationMessageId: fixture.messageId,
    descriptor: { wamid: "wamid-epic040", providerMediaId: `media-${ordinal}`, kind: "image", declaredMime: "image/jpeg", filename: `media-${ordinal}.jpg`, caption: null, ordinal },
    state: "pending_download", mediaAssetId: null, failureCode: null, attemptCount: 0, nextAttemptAt: null, createdAt: fixtureNow, updatedAt: fixtureNow, completedAt: null,
  });
  return id;
}

function mediaDescriptor() { return { wamid: "wamid-epic040", providerMediaId: "meta-media", kind: "image" as const, declaredMime: "image/jpeg", filename: "photo.jpg", caption: null, ordinal: 0 }; }
function mediaProvider(fixture: ReturnType<typeof createEpic040MediaFixture>, fetcher: typeof fetch, token = "connection-token", maximumBytes = 100): MetaInboundMediaProvider { return new MetaInboundMediaProvider(new WhatsAppConnectionRepository(fixture.db), { resolve: () => token }, { graphVersion: "v26.0", metadataTimeoutMs: 100, downloadTimeoutMs: 100, maximumBytes }, fetcher); }
async function contentBytes(content: AsyncIterable<Uint8Array>): Promise<Uint8Array> { const chunks: Uint8Array[] = []; let size = 0; for await (const chunk of content) { chunks.push(chunk); size += chunk.byteLength; } const value = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.byteLength; } return value; }
function inboundPayload(message: Record<string, unknown>): Buffer { return Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-epic040" }, messages: [message] } }] }] })); }
function captureWebhook(fixture: ReturnType<typeof createEpic040MediaFixture>): WhatsAppWebhookService { const customer = fixture.db.prepare("SELECT sender_participant_id AS id FROM conversation_messages WHERE id=?").get(fixture.messageId) as { id: string }; return new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, { resolveActiveByPhoneNumberId: () => ({ id: fixture.connectionId, workspaceId: fixture.workspaceId, companyId: fixture.companyId, assistantProfileId: "asp_04000000000000000000000000000000", phoneNumberId: "phone-epic040" }), recordWebhookActivity: () => undefined } as never, { findBinding: () => ({ conversationId: fixture.conversationId, customerParticipantId: customer.id, assistantParticipantId: "cpt_04000000000000000000000000000000", waId: "wa-customer" }) } as never, new ChannelProviderEventRepository(fixture.db), {} as never, undefined, new FixtureClock()); }
function capturedMedia(fixture: ReturnType<typeof createEpic040MediaFixture>, wamid: string): { provider_media_id: string; provider_kind: string; declared_mime: string; safe_filename: string | null; content: string; media_gate_state: string } { const row = fixture.db.prepare("SELECT m.provider_media_id,m.provider_kind,m.declared_mime,m.safe_filename,cm.content,r.media_gate_state FROM whatsapp_inbound_media m JOIN channel_provider_events e ON e.id=m.channel_provider_event_id JOIN conversation_messages cm ON cm.id=m.conversation_message_id JOIN channel_execution_requests r ON r.channel_provider_event_id=e.id WHERE e.external_event_id=?").get(wamid) as { provider_media_id: string; provider_kind: string; declared_mime: string; safe_filename: string | null; content: string; media_gate_state: string } | undefined; if (!row) throw new Error("Captured media was not found."); return { ...row }; }
function readyAsset(fixture: ReturnType<typeof createEpic040MediaFixture>, id: string, kind: "image" | "document" | "audio", mediaType: string, filename: string | null): void { const context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, repository = new MediaRepository(fixture.db), reserved = repository.reserve(context, fixture.companyId, "ingest", `projection-${id}`, id.slice(-1).repeat(64), { id, workspaceId: fixture.workspaceId, companyId: fixture.companyId, kind, mediaType, sizeBytes: null, filename, metadata: {}, status: "pending", createdAt: fixtureNow, archivedAt: null, deletedAt: null }, fixtureNow); if (reserved.kind !== "reserved") throw new Error("Projection asset was not reserved."); if (!repository.complete(context, fixture.companyId, id, { id: `mbl_${id.slice(4)}`, workspaceId: fixture.workspaceId, companyId: fixture.companyId, digest: id.slice(-1).repeat(64), sizeBytes: 1, mediaType, storageReference: `private://${id}`, state: "active", createdAt: fixtureNow }, fixtureNow)) throw new Error("Projection asset was not completed."); }

test("EPIC040 migrates a fresh database through the 0053 head", () => {
  const database = createDatabase(":memory:");
  try {
    const head = database.prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as { id: number; name: string };
    assert.equal(head.id, 53);
    assert.equal(head.name, "0053_whatsapp_inbound_media_retry_diagnostics");
  } finally {
    database.close();
  }
});

test("EPIC040 fixture creates a valid scoped media recovery graph", () => {
  const fixture = createEpic040MediaFixture();
  try {
    assert.deepEqual(fixture.db.prepare("PRAGMA foreign_key_check").all(), []);
    for (const [table, id] of [["workspaces", fixture.workspaceId], ["companies", fixture.companyId], ["whatsapp_connections", fixture.connectionId], ["conversation_messages", fixture.messageId], ["channel_provider_events", fixture.providerEventId], ["whatsapp_inbound_media", fixture.ledgerId], ["media_assets", fixture.mediaAssetId]] as const) {
      assert.ok(fixture.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id));
    }
    const ledger = fixture.db.prepare("SELECT workspace_id,company_id,whatsapp_connection_id,conversation_message_id,channel_provider_event_id,state,lease_token,media_asset_id FROM whatsapp_inbound_media WHERE id=?").get(fixture.ledgerId) as { workspace_id: number; company_id: number; whatsapp_connection_id: string; conversation_message_id: string; channel_provider_event_id: string; state: string; lease_token: string; media_asset_id: string | null };
    assert.deepEqual({ ...ledger }, { workspace_id: fixture.workspaceId, company_id: fixture.companyId, whatsapp_connection_id: fixture.connectionId, conversation_message_id: fixture.messageId, channel_provider_event_id: fixture.providerEventId, state: "ingesting", lease_token: fixture.leaseToken, media_asset_id: null });
    assert.equal((fixture.db.prepare("SELECT status FROM media_assets WHERE id=? AND workspace_id=? AND company_id=?").get(fixture.mediaAssetId, fixture.workspaceId, fixture.companyId) as { status: string }).status, "ready");
  } finally {
    fixture.close();
  }
});

test("EPIC040 markAssociated applies a matching active lease", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db);
  try {
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    const outcome = repository.markAssociated({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:30.000Z");
    assert.equal(outcome.kind, "applied");
    const after = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.equal(after.state, "associated");
    assert.equal(after.media_asset_id, fixture.mediaAssetId);
    assert.equal(after.lease_token, null);
    assert.equal(after.lease_owner, null);
    assert.equal(after.lease_acquired_at, null);
    assert.equal(after.lease_expires_at, null);
    assert.equal(after.failure_code, null);
    assert.equal(after.last_retry_failure_code, before.last_retry_failure_code);
    assert.equal(after.last_retry_failure_at, before.last_retry_failure_at);
    assert.equal(after.next_attempt_at, null);
    assert.equal(repository.pending({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, 10).some((media) => media.id === fixture.ledgerId), false);
    assert.equal(repository.claimInboundMediaForRecovery({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, fixture.connectionId, "another-worker", fixtureLeaseExpiresAt, "2026-08-20T12:02:00.000Z"), null);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markAssociated replays without a durable mutation", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.equal(repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:30.000Z").kind, "applied");
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    const outcome = repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "unused-token", fixture.mediaAssetId, "2026-08-20T12:00:31.000Z");
    assert.equal(outcome.kind, "replayed");
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markAssociated conflicts without a durable mutation", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.equal(repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:30.000Z").kind, "applied");
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    const outcome = repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "unused-token", "mas_04000000000000000000000000000001", "2026-08-20T12:00:31.000Z");
    assert.deepEqual(outcome, { kind: "conflict", currentState: "associated" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markAssociated conflicts with a terminal lifecycle without a durable mutation", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.equal(repository.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", "2026-08-20T12:00:30.000Z").kind, "applied");
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    const outcome = repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:31.000Z");
    assert.deepEqual(outcome, { kind: "conflict", currentState: "failed" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markAssociated loses wrong and stale leases without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const beforeWrongToken = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.deepEqual(repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "wrong-token", fixture.mediaAssetId, "2026-08-20T12:00:30.000Z"), { kind: "lease_lost" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), beforeWrongToken);
    const laterLease = repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "later-worker", fixtureLeaseExpiresAt, "2026-08-20T12:02:00.000Z");
    assert.ok(laterLease);
    const beforeStaleToken = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.deepEqual(repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:01:01.000Z"), { kind: "lease_lost" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), beforeStaleToken);
  } finally {
    fixture.close();
  }
});

test("EPIC040 settlement rejects an expired lease without a competing reclaim", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    for (const outcome of [repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, fixtureLeaseExpiresAt), repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", "2026-08-20T12:05:00.000Z", fixtureLeaseExpiresAt), repository.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", fixtureLeaseExpiresAt)]) assert.deepEqual(outcome, { kind: "lease_lost" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally { fixture.close(); }
});

test("EPIC040 association settlement rejects a foreign ready asset without mutation", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const other = new CompanyRepository(fixture.db).create(context, { name: "EPIC040 Foreign", website: "https://foreign.epic040.test", status: "ready" }), media = new MediaRepository(fixture.db), assetId = "mas_04000000000000000000000000000099";
    const reserved = media.reserve(context, other.id, "ingest", "epic040-foreign-asset", "f".repeat(64), { id: assetId, workspaceId: fixture.workspaceId, companyId: other.id, kind: "image", mediaType: "image/jpeg", sizeBytes: null, filename: "foreign.jpg", metadata: {}, status: "pending", createdAt: fixtureNow, archivedAt: null, deletedAt: null }, fixtureNow);
    assert.equal(reserved.kind, "reserved");
    assert.ok(media.complete(context, other.id, assetId, { id: "mbl_04000000000000000000000000000099", workspaceId: fixture.workspaceId, companyId: other.id, digest: "f".repeat(64), sizeBytes: 1, mediaType: "image/jpeg", storageReference: "private://foreign", state: "active", createdAt: fixtureNow }, fixtureNow));
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.deepEqual(repository.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, assetId, "2026-08-20T12:00:30.000Z"), { kind: "conflict", currentState: "ingesting" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally { fixture.close(); }
});

test("EPIC040 markAssociated returns scoped not_found outcomes without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const wrongWorkspace = createWorkspaceContext(new WorkspaceRepository(fixture.db).createForSystemUse({ key: "epic040-other", name: "EPIC040 Other" }));
    for (const [scope, companyId, connectionId, ledgerId] of [[context, fixture.companyId, fixture.connectionId, "wim_missing"], [wrongWorkspace, fixture.companyId, fixture.connectionId, fixture.ledgerId], [context, fixture.companyId + 1, fixture.connectionId, fixture.ledgerId], [context, fixture.companyId, "wac_missing", fixture.ledgerId]] as const) {
      const before = durableLedgerState(fixture.db, fixture.ledgerId);
      assert.deepEqual(repository.markAssociated(scope, companyId, connectionId, ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:30.000Z"), { kind: "not_found" });
      assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
    }
  } finally {
    fixture.close();
  }
});

test("EPIC040 markRetryableFailure applies a matching active lease", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, retryAt = "2026-08-20T12:05:00.000Z", appliedAt = "2026-08-20T12:00:30.000Z";
  try {
    const outcome = repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", retryAt, appliedAt);
    assert.equal(outcome.kind, "applied");
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), { state: "pending_download", media_asset_id: null, lease_token: null, lease_owner: null, lease_acquired_at: null, lease_expires_at: null, attempt_count: 1, failure_code: null, last_retry_failure_code: "provider_temporary_failure", last_retry_failure_at: appliedAt, next_attempt_at: retryAt });
  } finally {
    fixture.close();
  }
});

test("EPIC040 markRetryableFailure replays an identical retry without a durable mutation", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, retryAt = "2026-08-20T12:05:00.000Z";
  try {
    assert.equal(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", retryAt, "2026-08-20T12:00:30.000Z").kind, "applied");
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.equal(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "unused-token", "provider_temporary_failure", retryAt, "2026-08-20T12:00:31.000Z").kind, "replayed");
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markRetryableFailure conflicts for different pending retry semantics without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, retryAt = "2026-08-20T12:05:00.000Z";
  try {
    assert.equal(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", retryAt, "2026-08-20T12:00:30.000Z").kind, "applied");
    for (const [code, nextAttemptAt] of [["media_download_failed", retryAt], ["provider_temporary_failure", "2026-08-20T12:06:00.000Z"]] as const) {
      const before = durableLedgerState(fixture.db, fixture.ledgerId);
      assert.deepEqual(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "unused-token", code, nextAttemptAt, "2026-08-20T12:00:31.000Z"), { kind: "conflict", currentState: "pending_download" });
      assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
    }
  } finally {
    fixture.close();
  }
});

test("EPIC040 markRetryableFailure conflicts with associated and terminal lifecycles without durable mutations", () => {
  const associated = createEpic040MediaFixture(), terminal = createEpic040MediaFixture(), retryAt = "2026-08-20T12:05:00.000Z";
  try {
    const associatedRepository = new WhatsAppInboundMediaRepository(associated.db), associatedContext = { workspaceId: associated.workspaceId, workspaceKey: "default" };
    assert.equal(associatedRepository.markAssociated(associatedContext, associated.companyId, associated.connectionId, associated.ledgerId, associated.leaseToken, associated.mediaAssetId, "2026-08-20T12:00:30.000Z").kind, "applied");
    const associatedBefore = durableLedgerState(associated.db, associated.ledgerId);
    assert.deepEqual(associatedRepository.markRetryableFailure(associatedContext, associated.companyId, associated.connectionId, associated.ledgerId, "unused-token", "provider_temporary_failure", retryAt, "2026-08-20T12:00:31.000Z"), { kind: "conflict", currentState: "associated" });
    assert.deepEqual(durableLedgerState(associated.db, associated.ledgerId), associatedBefore);
    const terminalRepository = new WhatsAppInboundMediaRepository(terminal.db), terminalContext = { workspaceId: terminal.workspaceId, workspaceKey: "default" };
    assert.equal(terminalRepository.markTerminalFailure(terminalContext, terminal.companyId, terminal.connectionId, terminal.ledgerId, terminal.leaseToken, "media_download_failed", "2026-08-20T12:00:30.000Z").kind, "applied");
    const terminalBefore = durableLedgerState(terminal.db, terminal.ledgerId);
    assert.deepEqual(terminalRepository.markRetryableFailure(terminalContext, terminal.companyId, terminal.connectionId, terminal.ledgerId, "unused-token", "provider_temporary_failure", retryAt, "2026-08-20T12:00:31.000Z"), { kind: "conflict", currentState: "failed" });
    assert.deepEqual(durableLedgerState(terminal.db, terminal.ledgerId), terminalBefore);
  } finally {
    associated.close();
    terminal.close();
  }
});

test("EPIC040 markRetryableFailure loses wrong and stale leases without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, retryAt = "2026-08-20T12:05:00.000Z";
  try {
    const beforeWrongToken = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.deepEqual(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "wrong-token", "provider_temporary_failure", retryAt, "2026-08-20T12:00:30.000Z"), { kind: "lease_lost" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), beforeWrongToken);
    assert.ok(repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "later-worker", fixtureLeaseExpiresAt, "2026-08-20T12:02:00.000Z"));
    const beforeStaleToken = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.deepEqual(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", retryAt, "2026-08-20T12:01:01.000Z"), { kind: "lease_lost" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), beforeStaleToken);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markRetryableFailure returns scoped not_found outcomes without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, retryAt = "2026-08-20T12:05:00.000Z";
  try {
    const wrongWorkspace = createWorkspaceContext(new WorkspaceRepository(fixture.db).createForSystemUse({ key: "epic040-retry-other", name: "EPIC040 Retry Other" }));
    for (const [scope, companyId, connectionId, ledgerId] of [[context, fixture.companyId, fixture.connectionId, "wim_missing"], [wrongWorkspace, fixture.companyId, fixture.connectionId, fixture.ledgerId], [context, fixture.companyId + 1, fixture.connectionId, fixture.ledgerId], [context, fixture.companyId, "wac_missing", fixture.ledgerId]] as const) {
      const before = durableLedgerState(fixture.db, fixture.ledgerId);
      assert.deepEqual(repository.markRetryableFailure(scope, companyId, connectionId, ledgerId, fixture.leaseToken, "provider_temporary_failure", retryAt, "2026-08-20T12:00:30.000Z"), { kind: "not_found" });
      assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
    }
  } finally {
    fixture.close();
  }
});

test("EPIC040 markTerminalFailure applies and preserves retry diagnostics", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, retryAt = "2026-08-20T12:05:00.000Z", retryRecordedAt = "2026-08-20T12:00:30.000Z", terminalAt = "2026-08-20T12:05:30.000Z";
  try {
    assert.equal(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", retryAt, retryRecordedAt).kind, "applied");
    const retryLease = repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "terminal-worker", retryAt, "2026-08-20T12:06:00.000Z");
    assert.ok(retryLease);
    assert.equal(repository.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, retryLease.leaseToken, "media_download_failed", terminalAt).kind, "applied");
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), { state: "failed", media_asset_id: null, lease_token: null, lease_owner: null, lease_acquired_at: null, lease_expires_at: null, attempt_count: 2, failure_code: "media_download_failed", last_retry_failure_code: "provider_temporary_failure", last_retry_failure_at: retryRecordedAt, next_attempt_at: null });
    assert.equal(repository.pending(context, fixture.companyId, 10).some((media) => media.id === fixture.ledgerId), false);
    assert.equal(repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "another-worker", "2026-08-20T12:07:00.000Z", "2026-08-20T12:08:00.000Z"), null);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markTerminalFailure replays an identical terminal failure without a durable mutation", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.equal(repository.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", "2026-08-20T12:00:30.000Z").kind, "applied");
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.equal(repository.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "unused-token", "media_download_failed", "2026-08-20T12:00:31.000Z").kind, "replayed");
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markTerminalFailure conflicts with incompatible terminal and lifecycle states without durable mutations", () => {
  const failed = createEpic040MediaFixture(), associated = createEpic040MediaFixture(), unsupported = createEpic040MediaFixture();
  try {
    const failedRepository = new WhatsAppInboundMediaRepository(failed.db), failedContext = { workspaceId: failed.workspaceId, workspaceKey: "default" };
    assert.equal(failedRepository.markTerminalFailure(failedContext, failed.companyId, failed.connectionId, failed.ledgerId, failed.leaseToken, "media_download_failed", "2026-08-20T12:00:30.000Z").kind, "applied");
    const failedBefore = durableLedgerState(failed.db, failed.ledgerId);
    assert.deepEqual(failedRepository.markTerminalFailure(failedContext, failed.companyId, failed.connectionId, failed.ledgerId, "unused-token", "media_ingest_failed", "2026-08-20T12:00:31.000Z"), { kind: "conflict", currentState: "failed" });
    assert.deepEqual(durableLedgerState(failed.db, failed.ledgerId), failedBefore);
    const associatedRepository = new WhatsAppInboundMediaRepository(associated.db), associatedContext = { workspaceId: associated.workspaceId, workspaceKey: "default" };
    assert.equal(associatedRepository.markAssociated(associatedContext, associated.companyId, associated.connectionId, associated.ledgerId, associated.leaseToken, associated.mediaAssetId, "2026-08-20T12:00:30.000Z").kind, "applied");
    const associatedBefore = durableLedgerState(associated.db, associated.ledgerId);
    assert.deepEqual(associatedRepository.markTerminalFailure(associatedContext, associated.companyId, associated.connectionId, associated.ledgerId, "unused-token", "media_download_failed", "2026-08-20T12:00:31.000Z"), { kind: "conflict", currentState: "associated" });
    assert.deepEqual(durableLedgerState(associated.db, associated.ledgerId), associatedBefore);
    const unsupportedRepository = new WhatsAppInboundMediaRepository(unsupported.db), unsupportedContext = { workspaceId: unsupported.workspaceId, workspaceKey: "default" };
    assert.equal(unsupportedRepository.markTerminalFailure(unsupportedContext, unsupported.companyId, unsupported.connectionId, unsupported.ledgerId, unsupported.leaseToken, "unsupported_media", "2026-08-20T12:00:30.000Z").kind, "applied");
    const unsupportedBefore = durableLedgerState(unsupported.db, unsupported.ledgerId);
    assert.deepEqual(unsupportedRepository.markTerminalFailure(unsupportedContext, unsupported.companyId, unsupported.connectionId, unsupported.ledgerId, "unused-token", "media_download_failed", "2026-08-20T12:00:31.000Z"), { kind: "conflict", currentState: "unsupported" });
    assert.deepEqual(durableLedgerState(unsupported.db, unsupported.ledgerId), unsupportedBefore);
  } finally {
    failed.close();
    associated.close();
    unsupported.close();
  }
});

test("EPIC040 markTerminalFailure loses wrong and stale leases without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const beforeWrongToken = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.deepEqual(repository.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, "wrong-token", "media_download_failed", "2026-08-20T12:00:30.000Z"), { kind: "lease_lost" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), beforeWrongToken);
    assert.ok(repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "later-worker", fixtureLeaseExpiresAt, "2026-08-20T12:02:00.000Z"));
    const beforeStaleToken = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.deepEqual(repository.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", "2026-08-20T12:01:01.000Z"), { kind: "lease_lost" });
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), beforeStaleToken);
  } finally {
    fixture.close();
  }
});

test("EPIC040 markTerminalFailure returns scoped not_found outcomes without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const wrongWorkspace = createWorkspaceContext(new WorkspaceRepository(fixture.db).createForSystemUse({ key: "epic040-terminal-other", name: "EPIC040 Terminal Other" }));
    for (const [scope, companyId, connectionId, ledgerId] of [[context, fixture.companyId, fixture.connectionId, "wim_missing"], [wrongWorkspace, fixture.companyId, fixture.connectionId, fixture.ledgerId], [context, fixture.companyId + 1, fixture.connectionId, fixture.ledgerId], [context, fixture.companyId, "wac_missing", fixture.ledgerId]] as const) {
      const before = durableLedgerState(fixture.db, fixture.ledgerId);
      assert.deepEqual(repository.markTerminalFailure(scope, companyId, connectionId, ledgerId, fixture.leaseToken, "media_download_failed", "2026-08-20T12:00:30.000Z"), { kind: "not_found" });
      assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
    }
  } finally {
    fixture.close();
  }
});

test("EPIC040 lease claim acquires an immediately eligible pending row", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, ledgerId = "wim_04000000000000000000000000000001";
  try {
    repository.reserve(context, { id: ledgerId, workspaceId: fixture.workspaceId, companyId: fixture.companyId, connectionId: fixture.connectionId, eventId: fixture.providerEventId, conversationMessageId: fixture.messageId, descriptor: { wamid: "wamid-epic040", providerMediaId: "media-immediate", kind: "image", declaredMime: "image/jpeg", filename: "immediate.jpg", caption: null, ordinal: 1 }, state: "pending_download", mediaAssetId: null, failureCode: null, attemptCount: 0, nextAttemptAt: null, createdAt: fixtureNow, updatedAt: fixtureNow, completedAt: null });
    const before = durableLedgerState(fixture.db, ledgerId);
    const claim = repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "immediate-worker", fixtureNow, fixtureLeaseExpiresAt);
    assert.ok(claim);
    assert.equal(claim.media.id, ledgerId);
    assert.notEqual(claim.leaseToken, "");
    assert.deepEqual(durableLedgerState(fixture.db, ledgerId), { ...before, state: "ingesting", lease_token: claim.leaseToken, lease_owner: "immediate-worker", lease_acquired_at: fixtureNow, lease_expires_at: fixtureLeaseExpiresAt, attempt_count: before.attempt_count + 1 });
  } finally {
    fixture.close();
  }
});

test("EPIC040 lease claim honors retry timing before, at, and after due", () => {
  const beforeDue = createEpic040MediaFixture(), exactlyDue = createEpic040MediaFixture(), afterDue = createEpic040MediaFixture(), retryAt = "2026-08-20T12:05:00.000Z";
  try {
    const beforeRepository = new WhatsAppInboundMediaRepository(beforeDue.db), beforeContext = { workspaceId: beforeDue.workspaceId, workspaceKey: "default" };
    assert.equal(beforeRepository.markRetryableFailure(beforeContext, beforeDue.companyId, beforeDue.connectionId, beforeDue.ledgerId, beforeDue.leaseToken, "provider_temporary_failure", retryAt, "2026-08-20T12:00:30.000Z").kind, "applied");
    const before = durableLedgerState(beforeDue.db, beforeDue.ledgerId);
    assert.equal(beforeRepository.claimInboundMediaForRecovery(beforeContext, beforeDue.companyId, beforeDue.connectionId, "before-worker", "2026-08-20T12:04:59.000Z", "2026-08-20T12:06:00.000Z"), null);
    assert.deepEqual(durableLedgerState(beforeDue.db, beforeDue.ledgerId), before);
    const exactRepository = new WhatsAppInboundMediaRepository(exactlyDue.db), exactContext = { workspaceId: exactlyDue.workspaceId, workspaceKey: "default" };
    assert.equal(exactRepository.markRetryableFailure(exactContext, exactlyDue.companyId, exactlyDue.connectionId, exactlyDue.ledgerId, exactlyDue.leaseToken, "provider_temporary_failure", retryAt, "2026-08-20T12:00:30.000Z").kind, "applied");
    const exactClaim = exactRepository.claimInboundMediaForRecovery(exactContext, exactlyDue.companyId, exactlyDue.connectionId, "exact-worker", retryAt, "2026-08-20T12:06:00.000Z");
    assert.ok(exactClaim);
    assert.deepEqual(durableLedgerState(exactlyDue.db, exactlyDue.ledgerId), { state: "ingesting", media_asset_id: null, lease_token: exactClaim.leaseToken, lease_owner: "exact-worker", lease_acquired_at: retryAt, lease_expires_at: "2026-08-20T12:06:00.000Z", attempt_count: 2, failure_code: null, last_retry_failure_code: "provider_temporary_failure", last_retry_failure_at: "2026-08-20T12:00:30.000Z", next_attempt_at: retryAt });
    const afterRepository = new WhatsAppInboundMediaRepository(afterDue.db), afterContext = { workspaceId: afterDue.workspaceId, workspaceKey: "default" };
    assert.equal(afterRepository.markRetryableFailure(afterContext, afterDue.companyId, afterDue.connectionId, afterDue.ledgerId, afterDue.leaseToken, "provider_temporary_failure", retryAt, "2026-08-20T12:00:30.000Z").kind, "applied");
    const afterClaim = afterRepository.claimInboundMediaForRecovery(afterContext, afterDue.companyId, afterDue.connectionId, "after-worker", "2026-08-20T12:05:01.000Z", "2026-08-20T12:06:00.000Z");
    assert.ok(afterClaim);
    assert.equal(durableLedgerState(afterDue.db, afterDue.ledgerId).attempt_count, 2);
  } finally {
    beforeDue.close();
    exactlyDue.close();
    afterDue.close();
  }
});

test("EPIC040 lease claim does not steal an active lease", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const before = durableLedgerState(fixture.db, fixture.ledgerId);
    assert.equal(repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "second-worker", "2026-08-20T12:00:30.000Z", "2026-08-20T12:02:00.000Z"), null);
    assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 lease claim reclaims expired leases at and after expiry", () => {
  const afterExpiry = createEpic040MediaFixture(), atExpiry = createEpic040MediaFixture();
  try {
    const afterRepository = new WhatsAppInboundMediaRepository(afterExpiry.db), afterContext = { workspaceId: afterExpiry.workspaceId, workspaceKey: "default" }, afterBefore = durableLedgerState(afterExpiry.db, afterExpiry.ledgerId);
    const afterClaim = afterRepository.claimInboundMediaForRecovery(afterContext, afterExpiry.companyId, afterExpiry.connectionId, "reclaim-worker", "2026-08-20T12:01:01.000Z", "2026-08-20T12:02:00.000Z");
    assert.ok(afterClaim);
    assert.notEqual(afterClaim.leaseToken, afterBefore.lease_token);
    assert.deepEqual(durableLedgerState(afterExpiry.db, afterExpiry.ledgerId), { ...afterBefore, lease_token: afterClaim.leaseToken, lease_owner: "reclaim-worker", lease_acquired_at: "2026-08-20T12:01:01.000Z", lease_expires_at: "2026-08-20T12:02:00.000Z", attempt_count: afterBefore.attempt_count + 1 });
    const boundaryRepository = new WhatsAppInboundMediaRepository(atExpiry.db), boundaryContext = { workspaceId: atExpiry.workspaceId, workspaceKey: "default" }, boundaryBefore = durableLedgerState(atExpiry.db, atExpiry.ledgerId);
    const boundaryClaim = boundaryRepository.claimInboundMediaForRecovery(boundaryContext, atExpiry.companyId, atExpiry.connectionId, "boundary-worker", fixtureLeaseExpiresAt, "2026-08-20T12:02:00.000Z");
    assert.ok(boundaryClaim);
    assert.notEqual(boundaryClaim.leaseToken, boundaryBefore.lease_token);
    assert.equal(durableLedgerState(atExpiry.db, atExpiry.ledgerId).attempt_count, boundaryBefore.attempt_count + 1);
  } finally {
    afterExpiry.close();
    atExpiry.close();
  }
});

test("EPIC040 lease claim enforces workspace company and connection isolation", () => {
  const fixture = createEpic040MediaFixture(), repository = new WhatsAppInboundMediaRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.equal(repository.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", fixtureNow, "2026-08-20T12:00:30.000Z").kind, "applied");
    const wrongWorkspace = createWorkspaceContext(new WorkspaceRepository(fixture.db).createForSystemUse({ key: "epic040-lease-other", name: "EPIC040 Lease Other" }));
    for (const [scope, companyId, connectionId] of [[wrongWorkspace, fixture.companyId, fixture.connectionId], [context, fixture.companyId + 1, fixture.connectionId], [context, fixture.companyId, "wac_missing"]] as const) {
      const before = durableLedgerState(fixture.db, fixture.ledgerId);
      assert.equal(repository.claimInboundMediaForRecovery(scope, companyId, connectionId, "losing-worker", fixtureNow, fixtureLeaseExpiresAt), null);
      assert.deepEqual(durableLedgerState(fixture.db, fixture.ledgerId), before);
    }
    const claim = repository.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "correct-worker", fixtureNow, fixtureLeaseExpiresAt);
    assert.ok(claim);
    assert.equal(claim.media.id, fixture.ledgerId);
  } finally {
    fixture.close();
  }
});

test("EPIC040 lease claim never recovers associated or terminal rows", () => {
  const associated = createEpic040MediaFixture(), failed = createEpic040MediaFixture(), unsupported = createEpic040MediaFixture();
  try {
    const associatedRepository = new WhatsAppInboundMediaRepository(associated.db), associatedContext = { workspaceId: associated.workspaceId, workspaceKey: "default" };
    assert.equal(associatedRepository.markAssociated(associatedContext, associated.companyId, associated.connectionId, associated.ledgerId, associated.leaseToken, associated.mediaAssetId, "2026-08-20T12:00:30.000Z").kind, "applied");
    const associatedBefore = durableLedgerState(associated.db, associated.ledgerId);
    assert.equal(associatedRepository.claimInboundMediaForRecovery(associatedContext, associated.companyId, associated.connectionId, "losing-worker", "2026-08-20T12:02:00.000Z", "2026-08-20T12:03:00.000Z"), null);
    assert.deepEqual(durableLedgerState(associated.db, associated.ledgerId), associatedBefore);
    const failedRepository = new WhatsAppInboundMediaRepository(failed.db), failedContext = { workspaceId: failed.workspaceId, workspaceKey: "default" };
    assert.equal(failedRepository.markTerminalFailure(failedContext, failed.companyId, failed.connectionId, failed.ledgerId, failed.leaseToken, "media_download_failed", "2026-08-20T12:00:30.000Z").kind, "applied");
    const failedBefore = durableLedgerState(failed.db, failed.ledgerId);
    assert.equal(failedRepository.claimInboundMediaForRecovery(failedContext, failed.companyId, failed.connectionId, "losing-worker", "2026-08-20T12:02:00.000Z", "2026-08-20T12:03:00.000Z"), null);
    assert.deepEqual(durableLedgerState(failed.db, failed.ledgerId), failedBefore);
    const unsupportedRepository = new WhatsAppInboundMediaRepository(unsupported.db), unsupportedContext = { workspaceId: unsupported.workspaceId, workspaceKey: "default" };
    assert.equal(unsupportedRepository.markTerminalFailure(unsupportedContext, unsupported.companyId, unsupported.connectionId, unsupported.ledgerId, unsupported.leaseToken, "unsupported_media", "2026-08-20T12:00:30.000Z").kind, "applied");
    const unsupportedBefore = durableLedgerState(unsupported.db, unsupported.ledgerId);
    assert.equal(unsupportedRepository.claimInboundMediaForRecovery(unsupportedContext, unsupported.companyId, unsupported.connectionId, "losing-worker", "2026-08-20T12:02:00.000Z", "2026-08-20T12:03:00.000Z"), null);
    assert.deepEqual(durableLedgerState(unsupported.db, unsupported.ledgerId), unsupportedBefore);
  } finally {
    associated.close();
    failed.close();
    unsupported.close();
  }
});

test("EPIC040 recompute keeps pending media blocked and is idempotent", () => {
  const fixture = createEpic040MediaFixture(), media = new WhatsAppInboundMediaRepository(fixture.db), events = new ChannelProviderEventRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.equal(media.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", "2026-08-20T12:05:00.000Z", "2026-08-20T12:00:30.000Z").kind, "applied");
    const before = durableExecutionRequestState(fixture.db, fixture.executionRequestId);
    assert.deepEqual(events.recomputeExecutionMediaGate(context, fixture.companyId, fixture.connectionId, fixture.executionRequestId as never, "2026-08-20T12:00:31.000Z"), { kind: "unchanged", gate: "blocked_by_media" });
    assert.deepEqual(durableExecutionRequestState(fixture.db, fixture.executionRequestId), before);
    assert.deepEqual(events.recomputeExecutionMediaGate(context, fixture.companyId, fixture.connectionId, fixture.executionRequestId as never, "2026-08-20T12:00:32.000Z"), { kind: "unchanged", gate: "blocked_by_media" });
    assert.deepEqual(durableExecutionRequestState(fixture.db, fixture.executionRequestId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 recompute opens settled media exactly once and releases execution leasing", () => {
  const fixture = createEpic040MediaFixture(), media = new WhatsAppInboundMediaRepository(fixture.db), events = new ChannelProviderEventRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.deepEqual(events.leaseExecutionRequests("execution-worker", fixtureNow, fixtureLeaseExpiresAt, 10), []);
    assert.equal(media.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:30.000Z").kind, "applied");
    assert.deepEqual(events.recomputeExecutionMediaGate(context, fixture.companyId, fixture.connectionId, fixture.executionRequestId as never, "2026-08-20T12:00:31.000Z"), { kind: "updated", gate: "open" });
    const opened = durableExecutionRequestState(fixture.db, fixture.executionRequestId);
    assert.equal(opened.media_gate_state, "open");
    assert.deepEqual(events.recomputeExecutionMediaGate(context, fixture.companyId, fixture.connectionId, fixture.executionRequestId as never, "2026-08-20T12:00:32.000Z"), { kind: "unchanged", gate: "open" });
    assert.deepEqual(durableExecutionRequestState(fixture.db, fixture.executionRequestId), opened);
    assert.deepEqual(events.leaseExecutionRequests("execution-worker", "2026-08-20T12:00:33.000Z", fixtureLeaseExpiresAt, 10).map((request) => request.id), [fixture.executionRequestId]);
  } finally {
    fixture.close();
  }
});

test("EPIC040 recompute derives the gate from every attachment state", () => {
  const run = (first: "pending" | "ingesting" | "associated" | "failed", second: "associated" | "failed" | "unsupported" | "pending", expected: "open" | "blocked_by_media"): void => {
    const fixture = createEpic040MediaFixture(), media = new WhatsAppInboundMediaRepository(fixture.db), events = new ChannelProviderEventRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, secondId = addExecutionMedia(fixture, 2);
    try {
      if (first === "pending") assert.equal(media.markRetryableFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "provider_temporary_failure", "2026-08-20T12:05:00.000Z", "2026-08-20T12:00:30.000Z").kind, "applied");
      if (first === "associated") assert.equal(media.markAssociated(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:30.000Z").kind, "applied");
      if (first === "failed") assert.equal(media.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", "2026-08-20T12:00:30.000Z").kind, "applied");
      const secondLease = media.claimInboundMediaForRecovery(context, fixture.companyId, fixture.connectionId, "second-media-worker", fixtureNow, fixtureLeaseExpiresAt);
      if (second !== "pending") {
        assert.ok(secondLease);
        if (second === "associated") assert.equal(media.markAssociated(context, fixture.companyId, fixture.connectionId, secondId, secondLease.leaseToken, fixture.mediaAssetId, "2026-08-20T12:00:31.000Z").kind, "applied");
        if (second === "failed") assert.equal(media.markTerminalFailure(context, fixture.companyId, fixture.connectionId, secondId, secondLease.leaseToken, "media_download_failed", "2026-08-20T12:00:31.000Z").kind, "applied");
        if (second === "unsupported") assert.equal(media.markTerminalFailure(context, fixture.companyId, fixture.connectionId, secondId, secondLease.leaseToken, "unsupported_media", "2026-08-20T12:00:31.000Z").kind, "applied");
      }
      assert.deepEqual(events.recomputeExecutionMediaGate(context, fixture.companyId, fixture.connectionId, fixture.executionRequestId as never, "2026-08-20T12:00:32.000Z"), expected === "open" ? { kind: "updated", gate: "open" } : { kind: "unchanged", gate: "blocked_by_media" });
    } finally {
      fixture.close();
    }
  };
  run("pending", "associated", "blocked_by_media");
  run("ingesting", "associated", "blocked_by_media");
  run("associated", "associated", "open");
  run("associated", "failed", "open");
  run("failed", "unsupported", "open");
  run("pending", "failed", "blocked_by_media");
});

test("EPIC040 recompute fails closed for scoped misses without durable mutations", () => {
  const fixture = createEpic040MediaFixture(), events = new ChannelProviderEventRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    const wrongWorkspace = createWorkspaceContext(new WorkspaceRepository(fixture.db).createForSystemUse({ key: "epic040-gate-other", name: "EPIC040 Gate Other" }));
    for (const [scope, companyId, connectionId, executionRequestId] of [[context, fixture.companyId, fixture.connectionId, "cex_missing"], [wrongWorkspace, fixture.companyId, fixture.connectionId, fixture.executionRequestId], [context, fixture.companyId + 1, fixture.connectionId, fixture.executionRequestId], [context, fixture.companyId, "wac_missing", fixture.executionRequestId]] as const) {
      const before = durableExecutionRequestState(fixture.db, fixture.executionRequestId);
      assert.deepEqual(events.recomputeExecutionMediaGate(scope, companyId, connectionId, executionRequestId as never, "2026-08-20T12:00:30.000Z"), { kind: "not_found" });
      assert.deepEqual(durableExecutionRequestState(fixture.db, fixture.executionRequestId), before);
    }
  } finally {
    fixture.close();
  }
});

test("EPIC040 recompute fails closed for a blocked request without coherent media", () => {
  const fixture = createEpic040MediaFixture(), events = new ChannelProviderEventRepository(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    fixture.db.prepare("DELETE FROM whatsapp_inbound_media WHERE id=?").run(fixture.ledgerId);
    const before = durableExecutionRequestState(fixture.db, fixture.executionRequestId);
    assert.deepEqual(events.recomputeExecutionMediaGate(context, fixture.companyId, fixture.connectionId, fixture.executionRequestId as never, "2026-08-20T12:00:30.000Z"), { kind: "conflict" });
    assert.deepEqual(durableExecutionRequestState(fixture.db, fixture.executionRequestId), before);
  } finally {
    fixture.close();
  }
});

test("EPIC040 conversation_message ownership resolves durable tenant authority", () => {
  const fixture = createEpic040MediaFixture(), resolver = new ConversationMessageMediaAssociationOwnerResolver(fixture.db), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.deepEqual(resolver.resolve(context, fixture.companyId, fixture.messageId), { workspaceId: fixture.workspaceId, companyId: fixture.companyId });
    assert.equal(resolver.resolve(context, fixture.companyId, "cmsg_missing"), null);
    assert.equal(resolver.resolve(context, fixture.companyId + 1, fixture.messageId), null);
    const otherWorkspace = createWorkspaceContext(new WorkspaceRepository(fixture.db).createForSystemUse({ key: "epic040-owner-other", name: "EPIC040 Owner Other" }));
    assert.equal(resolver.resolve(otherWorkspace, fixture.companyId, fixture.messageId), null);
  } finally {
    fixture.close();
  }
});

test("EPIC040 Media Core associates only ready same-tenant conversation message assets", () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock());
  try {
    const association = core.service.attach(context, fixture.companyId, fixture.mediaAssetId, "conversation_message", fixture.messageId);
    assert.equal(association.ownerId, fixture.messageId);
    const pendingAssetId = "mas_04000000000000000000000000000001";
    const reserved = new MediaRepository(fixture.db).reserve(context, fixture.companyId, "ingest", "epic040-pending-asset", "b".repeat(64), { id: pendingAssetId, workspaceId: fixture.workspaceId, companyId: fixture.companyId, kind: "image", mediaType: "image/jpeg", sizeBytes: null, filename: "pending.jpg", metadata: {}, status: "pending", createdAt: fixtureNow, archivedAt: null, deletedAt: null }, fixtureNow);
    assert.equal(reserved.kind, "reserved");
    assert.throws(() => core.service.attach(context, fixture.companyId, pendingAssetId, "conversation_message", fixture.messageId), (error: unknown) => error instanceof MediaDomainError && error.code === "media_not_associable");
    const otherCompany = new CompanyRepository(fixture.db).create(context, { name: "EPIC040 Other", website: "https://epic040-other.test", status: "ready" });
    const conversations = new ConversationService(new ConversationRepository(fixture.db), new FixtureClock()), otherConversation = conversations.open(context, otherCompany.id, "whatsapp"), otherParticipant = conversations.addParticipant(context, otherCompany.id, otherConversation.id, { type: "whatsapp_contact", reference: "other-customer" }), otherMessage = conversations.addMessage(context, otherCompany.id, otherConversation.id, { senderParticipantId: otherParticipant.id, direction: "inbound", content: "Other", idempotencyKey: "epic040-other", executionRecordId: null });
    for (const assetId of [fixture.mediaAssetId, "mas_missing"]) assert.throws(() => core.service.attach(context, otherCompany.id, assetId, "conversation_message", otherMessage.id), (error: unknown) => error instanceof MediaDomainError && error.code === "media_not_associable");
    assert.equal((fixture.db.prepare("SELECT COUNT(*) AS count FROM media_asset_associations WHERE asset_id=?").get(fixture.mediaAssetId) as { count: number }).count, 1);
  } finally {
    fixture.close();
  }
});

test("EPIC040 Media Core composition registers conversation ownership and fails closed otherwise", () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock());
  try {
    assert.equal(core.owners.owns(context, fixture.companyId, "conversation_message", fixture.messageId), true);
    assert.equal(core.owners.owns(context, fixture.companyId, "tool_result", "unknown"), false);
    assert.throws(() => core.owners.register(new ConversationMessageMediaAssociationOwnerResolver(fixture.db)), /already registered/u);
  } finally {
    fixture.close();
  }
});

test("EPIC040 parser preserves text capture with an open gate and no media ledger row", async () => {
  const fixture = createEpic040MediaFixture();
  try {
    await captureWebhook(fixture).acknowledge(inboundPayload({ type: "text", from: "wa-customer", id: "wamid-parser-text", text: { body: "  Hello parser  " } }));
    const event = fixture.db.prepare("SELECT e.id,cm.content,r.media_gate_state FROM channel_provider_events e JOIN conversation_messages cm ON cm.id=e.conversation_message_id JOIN channel_execution_requests r ON r.channel_provider_event_id=e.id WHERE e.external_event_id='wamid-parser-text'").get() as { id: string; content: string; media_gate_state: string };
    assert.deepEqual({ ...event }, { id: event.id, content: "Hello parser", media_gate_state: "open" });
    assert.equal((fixture.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_inbound_media WHERE channel_provider_event_id=?").get(event.id) as { count: number }).count, 0);
  } finally { fixture.close(); }
});

test("EPIC040 parser captures image and document descriptors with captions", async () => {
  const fixture = createEpic040MediaFixture(), webhook = captureWebhook(fixture);
  try {
    await webhook.acknowledge(inboundPayload({ type: "image", from: "wa-customer", id: "wamid-parser-image", image: { id: "media-image", mime_type: "image/jpeg", caption: "An image caption", sha256: "ignored" } }));
    await webhook.acknowledge(inboundPayload({ type: "document", from: "wa-customer", id: "wamid-parser-document", document: { id: "media-document", mime_type: "application/pdf", filename: "invoice.pdf", caption: "Invoice" } }));
    assert.deepEqual(capturedMedia(fixture, "wamid-parser-image"), { provider_media_id: "media-image", provider_kind: "image", declared_mime: "image/jpeg", safe_filename: null, content: "An image caption", media_gate_state: "blocked_by_media" });
    assert.deepEqual(capturedMedia(fixture, "wamid-parser-document"), { provider_media_id: "media-document", provider_kind: "document", declared_mime: "application/pdf", safe_filename: "invoice.pdf", content: "Invoice", media_gate_state: "blocked_by_media" });
  } finally { fixture.close(); }
});

test("EPIC040 parser captures audio-only messages with the neutral attachment marker", async () => {
  const fixture = createEpic040MediaFixture();
  try {
    await captureWebhook(fixture).acknowledge(inboundPayload({ type: "audio", from: "wa-customer", id: "wamid-parser-audio", audio: { id: "media-audio", mime_type: "audio/ogg" } }));
    assert.deepEqual(capturedMedia(fixture, "wamid-parser-audio"), { provider_media_id: "media-audio", provider_kind: "audio", declared_mime: "audio/ogg", safe_filename: null, content: "[attachment received]", media_gate_state: "blocked_by_media" });
  } finally { fixture.close(); }
});

test("EPIC040 parser rejects malformed media without durable capture and rejects divergent replay", async () => {
  const fixture = createEpic040MediaFixture(), webhook = captureWebhook(fixture);
  try {
    await webhook.acknowledge(inboundPayload({ type: "image", from: "wa-customer", id: "wamid-invalid", image: { mime_type: "image/jpeg" } }));
    assert.equal(fixture.db.prepare("SELECT 1 FROM channel_provider_events WHERE external_event_id='wamid-invalid'").get(), undefined);
    const replay = inboundPayload({ type: "image", from: "wa-customer", id: "wamid-replay", image: { id: "media-replay", mime_type: "image/jpeg" } });
    await webhook.acknowledge(replay); await webhook.acknowledge(replay);
    assert.equal((fixture.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_inbound_media WHERE provider_media_id='media-replay'").get() as { count: number }).count, 1);
    await assert.rejects(webhook.acknowledge(inboundPayload({ type: "image", from: "wa-customer", id: "wamid-replay", image: { id: "media-replay", mime_type: "image/png" } })));
    assert.equal(capturedMedia(fixture, "wamid-replay").declared_mime, "image/jpeg");
  } finally { fixture.close(); }
});

test("EPIC040 parser-captured media is immediately recoverable and opens its gate", async () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "whatsapp" }, ledger = new WhatsAppInboundMediaRepository(fixture.db), gates = new ChannelProviderEventRepository(fixture.db), core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock());
  try {
    await captureWebhook(fixture).acknowledge(inboundPayload({ type: "image", from: "wa-customer", id: "wamid-parser-recovery", image: { id: "media-parser-recovery", mime_type: "image/jpeg" } }));
    const service = new WhatsAppInboundMediaRecoveryService(ledger, { download: async () => ({ kind: "downloaded" as const, download: { mediaType: "image/jpeg", filename: null, content: (async function* (): AsyncIterable<Uint8Array> { yield Uint8Array.from([0xff, 0xd8, 0xff, 0x00]); })() } }) }, core.service, gates, new FixtureClock());
    assert.equal((await service.recoverNext(context, fixture.companyId, fixture.connectionId, "parser-recovery")).kind, "associated");
    assert.equal(capturedMedia(fixture, "wamid-parser-recovery").media_gate_state, "open");
  } finally { fixture.close(); }
});

test("EPIC040 projects only ready, scoped conversation-message associations with safe bounded metadata", () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock()), attachments = new SafeConversationAttachmentService(new SafeConversationAttachmentRepository(fixture.db));
  try {
    assert.deepEqual(attachments.getSafeConversationAttachments(context, fixture.companyId, fixture.messageId), []);
    readyAsset(fixture, "mas_04000000000000000000000000000011", "document", "application/pdf", "invoice.pdf");
    readyAsset(fixture, "mas_04000000000000000000000000000012", "audio", "audio/ogg", null);
    core.service.attach(context, fixture.companyId, fixture.mediaAssetId, "conversation_message", fixture.messageId);
    core.service.attach(context, fixture.companyId, "mas_04000000000000000000000000000011", "conversation_message", fixture.messageId);
    core.service.attach(context, fixture.companyId, "mas_04000000000000000000000000000012", "conversation_message", fixture.messageId);
    const projected = attachments.getSafeConversationAttachments(context, fixture.companyId, fixture.messageId);
    assert.deepEqual(projected, [{ kind: "audio", status: "available", mimeType: "audio/ogg" }, { kind: "document", status: "available", mimeType: "application/pdf", filename: "invoice.pdf" }, { kind: "image", status: "available", mimeType: "image/jpeg", filename: "epic040.jpg" }]);
    const serialized = JSON.stringify(projected);
    for (const secret of [fixture.mediaAssetId, "private://", "media-epic040", "lookaside.fbsbx.com", "sha256"]) assert.equal(serialized.includes(secret), false);
    assert.deepEqual(attachments.getSafeConversationAttachments({ workspaceId: fixture.workspaceId + 1, workspaceKey: "other" }, fixture.companyId, fixture.messageId), []);
    assert.deepEqual(attachments.getSafeConversationAttachments(context, fixture.companyId + 1, fixture.messageId), []);
    assert.deepEqual(attachments.getSafeConversationAttachments(context, fixture.companyId, "cmsg_missing"), []);
  } finally { fixture.close(); }
});

test("EPIC040 runtime request represents available attachments without attachment contents", async () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock()), attachments = new SafeConversationAttachmentService(new SafeConversationAttachmentRepository(fixture.db));
  try {
    core.service.attach(context, fixture.companyId, fixture.mediaAssetId, "conversation_message", fixture.messageId);
    const projected = attachments.getSafeConversationAttachments(context, fixture.companyId, fixture.messageId); let request: import("../assistant/application/assistantExecution.js").AssistantExecutionRequest | undefined;
    const runtime = new OperationalAssistantRuntime({ execute: async (value) => { request = value; return { outcome: "answered", answer: "Acknowledged" }; } }, { create: () => ({} as never), complete: () => true }, new FixtureClock());
    await runtime.execute({ id: fixture.companyId, workspaceId: fixture.workspaceId } as never, fixtureProfile(fixture.companyId), { id: "ckv_040", companyId: fixture.companyId, knowledge: { company: { name: "EPIC040", website: null, phone: "", email: "" }, business: { services: [], hours: "", locations: [] }, faq: [] } } as never, "[attachment received]", [], { purpose: "operational_execution", provider: "gemini", fallbackOnUnavailable: true, attachments: projected });
    assert.deepEqual(request?.attachments, projected);
    const prompt = (await import("../assistant/application/assistantExecution.js")).assistantModelPrompt(request!);
    assert.match(prompt, /contents were not interpreted/u);
    assert.equal(prompt.includes(fixture.mediaAssetId), false);
    assert.equal(prompt.includes("private://"), false);
  } finally { fixture.close(); }
});

test("EPIC040 recovery stores, associates, settles, and opens the execution gate", async () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, ledger = new WhatsAppInboundMediaRepository(fixture.db), gates = new ChannelProviderEventRepository(fixture.db), core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock());
  try {
    assert.equal(ledger.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", fixtureNow).kind, "applied");
    const ledgerId = addExecutionMedia(fixture, 1);
    const provider = { download: async () => ({ kind: "downloaded" as const, download: { mediaType: "image/jpeg", filename: "recovered.jpg", content: (async function* (): AsyncIterable<Uint8Array> { yield Uint8Array.from([0xff, 0xd8, 0xff, 0x00]); })() } }) };
    const service = new WhatsAppInboundMediaRecoveryService(ledger, provider, core.service, gates, new FixtureClock());
    const outcome = await service.recoverNext(context, fixture.companyId, fixture.connectionId, "recovery-worker");
    assert.equal(outcome.kind, "associated");
    assert.equal(outcome.kind === "associated" && outcome.ledgerId, ledgerId);
    assert.equal(durableLedgerState(fixture.db, ledgerId).state, "associated");
    assert.equal(durableExecutionRequestState(fixture.db, fixture.executionRequestId).media_gate_state, "open");
    assert.equal((fixture.db.prepare("SELECT COUNT(*) AS count FROM media_asset_associations WHERE owner_id=?").get(fixture.messageId) as { count: number }).count, 1);
  } finally { fixture.close(); }
});

test("EPIC040 recovery schedules bounded provider retries and leaves the gate blocked", async () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, ledger = new WhatsAppInboundMediaRepository(fixture.db), gates = new ChannelProviderEventRepository(fixture.db), core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock());
  try {
    assert.equal(ledger.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", fixtureNow).kind, "applied");
    const ledgerId = addExecutionMedia(fixture, 1);
    const service = new WhatsAppInboundMediaRecoveryService(ledger, { download: async () => ({ kind: "unavailable" as const }) }, core.service, gates, new FixtureClock());
    assert.deepEqual(await service.recoverNext(context, fixture.companyId, fixture.connectionId, "recovery-worker"), { kind: "retry_scheduled", ledgerId, failureCode: "provider_temporary_failure" });
    const saved = durableLedgerState(fixture.db, ledgerId);
    assert.equal(saved.state, "pending_download");
    assert.equal(saved.next_attempt_at, "2026-08-20T12:00:30.000Z");
    assert.equal(durableExecutionRequestState(fixture.db, fixture.executionRequestId).media_gate_state, "blocked_by_media");
  } finally { fixture.close(); }
});

test("EPIC040 recovery discovers eligible scoped media without caller-provided tenant scope", async () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, ledger = new WhatsAppInboundMediaRepository(fixture.db), gates = new ChannelProviderEventRepository(fixture.db), core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock());
  try {
    assert.equal(ledger.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", fixtureNow).kind, "applied");
    const ledgerId = addExecutionMedia(fixture, 1);
    const service = new WhatsAppInboundMediaRecoveryService(ledger, { download: async () => ({ kind: "unavailable" as const }) }, core.service, gates, new FixtureClock());
    assert.deepEqual(await service.recoverAvailable("production-media-worker"), [{ kind: "retry_scheduled", ledgerId, failureCode: "provider_temporary_failure" }]);
  } finally { fixture.close(); }
});

test("EPIC040 recovery repairs a gate left blocked after durable settlement", async () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" }, ledger = new WhatsAppInboundMediaRepository(fixture.db), gates = new ChannelProviderEventRepository(fixture.db), core = createMediaCore(fixture.db, "C:\\ATLAS\\media-test", new FixtureClock());
  try {
    assert.equal(ledger.markTerminalFailure(context, fixture.companyId, fixture.connectionId, fixture.ledgerId, fixture.leaseToken, "media_download_failed", fixtureNow).kind, "applied");
    assert.equal(durableExecutionRequestState(fixture.db, fixture.executionRequestId).media_gate_state, "blocked_by_media");
    const service = new WhatsAppInboundMediaRecoveryService(ledger, { download: async () => ({ kind: "unavailable" as const }) }, core.service, gates, new FixtureClock());
    assert.deepEqual(await service.recoverAvailable("production-media-worker"), []);
    assert.equal(durableExecutionRequestState(fixture.db, fixture.executionRequestId).media_gate_state, "open");
  } finally { fixture.close(); }
});

test("EPIC040 Meta inbound media provider downloads authenticated bounded bytes", async () => {
  const fixture = createEpic040MediaFixture(), requests: Array<{ url: string; authorization: string | null; redirect: RequestRedirect | undefined }> = [], bytes = Uint8Array.from([1, 2, 3]);
  try {
    const provider = mediaProvider(fixture, (async (url, init) => { requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization"), redirect: init?.redirect }); return requests.length === 1 ? new Response(JSON.stringify({ id: "meta-media", url: "https://lookaside.fbsbx.com/whatsapp_business/attachments?id=opaque", mime_type: "image/jpeg", file_size: 3 })) : new Response(bytes, { headers: { "content-length": "3" } }); }) as typeof fetch);
    const result = await provider.download({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, fixture.connectionId, mediaDescriptor());
    assert.equal(result.kind, "downloaded");
    if (result.kind === "downloaded") { assert.equal(result.download.mediaType, "image/jpeg"); assert.equal(result.download.filename, "photo.jpg"); assert.deepEqual(await contentBytes(result.download.content), bytes); }
    assert.deepEqual(requests.map((request) => ({ authorization: request.authorization, redirect: request.redirect })), [{ authorization: "Bearer connection-token", redirect: "error" }, { authorization: "Bearer connection-token", redirect: "error" }]);
    assert.match(requests[0]!.url, /^https:\/\/graph\.facebook\.com\/v26\.0\/meta-media$/u);
  } finally { fixture.close(); }
});

test("EPIC040 Meta inbound media provider rejects unsafe provider locations without leaking them", async () => {
  const fixture = createEpic040MediaFixture();
  try {
    for (const url of ["http://lookaside.fbsbx.com/file", "https://localhost/file", "https://127.0.0.1/file", "https://169.254.169.254/file", "https://private.example/file"]) {
      let calls = 0;
      const provider = mediaProvider(fixture, (async () => { calls += 1; return new Response(JSON.stringify({ id: "meta-media", url, mime_type: "image/jpeg" })); }) as typeof fetch);
      assert.deepEqual(await provider.download({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, fixture.connectionId, mediaDescriptor()), { kind: "unsafe_location" });
      assert.equal(calls, 1);
    }
    const redirected = mediaProvider(fixture, (async () => new Response(null, { status: 200 })) as typeof fetch);
    const response = await redirected.download({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, fixture.connectionId, mediaDescriptor());
    assert.equal(response.kind, "invalid_response");
  } finally { fixture.close(); }
});

test("EPIC040 Meta inbound media provider enforces declared and streamed byte bounds", async () => {
  const fixture = createEpic040MediaFixture();
  try {
    const overLength = mediaProvider(fixture, (async (_url, _init) => new Response(JSON.stringify({ id: "meta-media", url: "https://lookaside.fbsbx.com/file", mime_type: "image/jpeg", file_size: 101 }))) as typeof fetch, "connection-token", 100);
    assert.deepEqual(await overLength.download({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, fixture.connectionId, mediaDescriptor()), { kind: "too_large" });
    let calls = 0;
    const overStream = mediaProvider(fixture, (async () => { calls += 1; return calls === 1 ? new Response(JSON.stringify({ id: "meta-media", url: "https://lookaside.fbsbx.com/file", mime_type: "image/jpeg" })) : new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([1, 2, 3, 4])); controller.close(); } })); }) as typeof fetch, "connection-token", 3);
    const result = await overStream.download({ workspaceId: fixture.workspaceId, workspaceKey: "default" }, fixture.companyId, fixture.connectionId, mediaDescriptor());
    assert.equal(result.kind, "downloaded");
    if (result.kind === "downloaded") await assert.rejects(contentBytes(result.download.content), (error: unknown) => error instanceof WhatsAppInboundMediaDownloadStreamError && error.kind === "too_large");
  } finally { fixture.close(); }
});

test("EPIC040 Meta inbound media provider maps provider failures without raw errors", async () => {
  const fixture = createEpic040MediaFixture(), context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    for (const [response, expected] of [[new Response(null, { status: 404 }), "not_found"], [new Response(null, { status: 401 }), "unauthorized"], [new Response(null, { status: 503 }), "unavailable"], [new Response("not-json"), "invalid_response"]] as const) {
      const provider = mediaProvider(fixture, (async () => response) as typeof fetch);
      assert.equal((await provider.download(context, fixture.companyId, fixture.connectionId, mediaDescriptor())).kind, expected);
    }
    const timeout = mediaProvider(fixture, (async () => { throw new DOMException("timeout", "AbortError"); }) as typeof fetch);
    assert.equal((await timeout.download(context, fixture.companyId, fixture.connectionId, mediaDescriptor())).kind, "timeout");
    const mismatch = mediaProvider(fixture, (async () => new Response(JSON.stringify({ id: "other", url: "https://lookaside.fbsbx.com/file", mime_type: "image/jpeg" }))) as typeof fetch);
    assert.equal((await mismatch.download(context, fixture.companyId, fixture.connectionId, mediaDescriptor())).kind, "invalid_response");
  } finally { fixture.close(); }
});

test("EPIC040 Meta inbound media provider fails closed for credentials and scope", async () => {
  const fixture = createEpic040MediaFixture(), fetcher = (async () => { throw new Error("must not fetch"); }) as typeof fetch, context = { workspaceId: fixture.workspaceId, workspaceKey: "default" };
  try {
    assert.deepEqual(await mediaProvider(fixture, fetcher, "").download(context, fixture.companyId, fixture.connectionId, mediaDescriptor()), { kind: "unauthorized" });
    assert.deepEqual(await mediaProvider(fixture, fetcher).download(context, fixture.companyId + 1, fixture.connectionId, mediaDescriptor()), { kind: "unauthorized" });
    const otherWorkspace = createWorkspaceContext(new WorkspaceRepository(fixture.db).createForSystemUse({ key: "epic040-meta-other", name: "EPIC040 Meta Other" }));
    assert.deepEqual(await mediaProvider(fixture, fetcher).download(otherWorkspace, fixture.companyId, fixture.connectionId, mediaDescriptor()), { kind: "unauthorized" });
  } finally { fixture.close(); }
});
