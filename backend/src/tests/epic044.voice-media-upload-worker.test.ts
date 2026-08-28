import assert from "node:assert/strict";
import test from "node:test";
import type { MediaService } from "../media/services/mediaService.js";
import type { WhatsAppOutboundMediaUploadPort } from "../whatsapp/application/outboundMediaUploadPort.js";
import type { VoiceRepositoryPort } from "../whatsapp/application/voicePorts.js";
import type { WhatsAppOutboundMediaUpload } from "../whatsapp/domain/voice.js";
import { VoiceMediaUploadWorkerService } from "../whatsapp/services/voiceMediaUploadWorkerService.js";
import { WhatsAppOutboundDeliveryService } from "../whatsapp/services/WhatsAppOutboundDeliveryService.js";
import type { OutboundDelivery } from "../transport/domain/providerDelivery.js";

const at = "2026-08-27T12:00:00.000Z", context = { workspaceId: 1, workspaceKey: "test" }, upload = { id: "wou_1", workspaceId: 1, companyId: 1, outboundDeliveryId: "odl_1", mediaAssetId: "mas_1", providerMediaId: null, state: "uploading", leaseOwner: "worker", leaseExpiresAt: "2026-08-27T12:01:00.000Z", attemptCount: 1, safeErrorCategory: null, createdAt: at, updatedAt: at } as WhatsAppOutboundMediaUpload;

function worker(repository: Partial<VoiceRepositoryPort>, provider: WhatsAppOutboundMediaUploadPort): VoiceMediaUploadWorkerService { return new VoiceMediaUploadWorkerService(repository as VoiceRepositoryPort, { open: async () => new Uint8Array([1, 2, 3]) } as Pick<MediaService, "open">, provider, { now: () => at }, { owner: "worker", batchSize: 1, leaseMilliseconds: 60_000, uploadTimeoutMilliseconds: 50 }); }

test("EPIC044 PASS6A uploads one authorized leased record without dispatching", async () => {
  let sent = 0, finalized: Parameters<VoiceRepositoryPort["finalizeUpload"]>[4] | undefined;
  const repository: Partial<VoiceRepositoryPort> = { leaseUploads: () => [upload], authorizeUpload: () => ({ kind: "authorized", connectionId: "wac_1", mediaType: "audio/ogg", filename: "assistant.ogg" }), finalizeUpload: (_context, _company, id, owner, value) => { assert.equal(id, upload.id); assert.equal(owner, "worker"); finalized = value; return { ...upload, state: "uploaded", providerMediaId: "meta-media" }; } };
  const provider: WhatsAppOutboundMediaUploadPort = { upload: async (_context, _company, connectionId, input) => { sent++; assert.equal(connectionId, "wac_1"); assert.equal(input.mediaType, "audio/ogg"); assert.deepEqual(input.content, new Uint8Array([1, 2, 3])); return { kind: "uploaded", providerMediaId: "meta-media" }; } };
  assert.deepEqual(await worker(repository, provider).runOnce(context, 1), [{ kind: "uploaded", uploadId: upload.id }]);
  assert.equal(sent, 1); assert.deepEqual(finalized, { kind: "uploaded", providerMediaId: "meta-media" });
});

test("EPIC044 PASS6A suppresses before upload and maps retryable and permanent results durably", async () => {
  let calls = 0;
  const suppressed: Partial<VoiceRepositoryPort> = { leaseUploads: () => [upload], authorizeUpload: () => ({ kind: "suppressed" }) };
  const provider: WhatsAppOutboundMediaUploadPort = { upload: async () => { calls++; return { kind: "uploaded", providerMediaId: "never" }; } };
  assert.deepEqual(await worker(suppressed, provider).runOnce(context, 1), [{ kind: "suppressed", uploadId: upload.id }]);
  const values: string[] = [];
  const retrying: Partial<VoiceRepositoryPort> = { leaseUploads: () => [upload], authorizeUpload: () => ({ kind: "authorized", connectionId: "wac_1", mediaType: "audio/ogg", filename: null }), finalizeUpload: (_context, _company, _id, _owner, result) => { values.push(result.kind); return { ...upload, state: result.kind === "retryable" ? "expired" : "failed" }; } };
  assert.deepEqual(await worker(retrying, { upload: async () => ({ kind: "retryable", safeFailureCategory: "provider_unavailable" }) }).runOnce(context, 1), [{ kind: "retryable", uploadId: upload.id }]);
  assert.deepEqual(await worker(retrying, { upload: async () => ({ kind: "failed", safeFailureCategory: "provider_rejected" }) }).runOnce(context, 1), [{ kind: "failed", uploadId: upload.id }]);
  assert.equal(calls, 0); assert.deepEqual(values, ["retryable", "failed"]);
});

test("EPIC044 PASS6A reports authority loss during upload without exposing a send result", async () => {
  const repository: Partial<VoiceRepositoryPort> = { leaseUploads: () => [upload], authorizeUpload: () => ({ kind: "authorized", connectionId: "wac_1", mediaType: "audio/ogg", filename: null }), finalizeUpload: () => ({ ...upload, state: "failed", providerMediaId: null, safeErrorCategory: "suppressed" }) };
  assert.deepEqual(await worker(repository, { upload: async () => ({ kind: "uploaded", providerMediaId: "meta-media" }) }).runOnce(context, 1), [{ kind: "suppressed", uploadId: upload.id }]);
});

test("EPIC044 PASS6A generic dispatch refuses an audio delivery", async () => {
  let providerCalls = 0;
  const audio = { id: "odl_audio", providerMessageRecordId: "pmr_audio", transportConnectionId: "wac_audio", state: "pending", attemptCount: 0, nextAttemptAt: at, leaseOwner: null, leaseExpiresAt: null, safeErrorCategory: null, payloadKind: "audio", responsePolicy: "deferred_voice", mediaAssetId: "mas_audio", expectedAuthorityGeneration: 1, createdAt: at, updatedAt: at } as OutboundDelivery;
  const service = new WhatsAppOutboundDeliveryService({} as never, {} as never, {} as never, { leaseReady: () => [audio] } as never, {} as never, () => { providerCalls++; return {} as never; }, { now: () => at });
  await service.dispatchReady("worker");
  assert.equal(providerCalls, 0);
});
