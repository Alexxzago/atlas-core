import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { googleCloudSpeechConfiguration, GoogleCloudSpeechConfigurationError } from "../config/googleCloudSpeechConfiguration.js";
import { productionConfiguration } from "../config/productionConfiguration.js";
import { s3MediaStorageConfiguration } from "../config/s3MediaStorageConfiguration.js";
import { MediaStorageError, type MediaBlob } from "../media/domain/media.js";
import { UnavailableMediaStorage } from "../media/infrastructure/unavailableMediaStorage.js";
import { MediaRecoveryService } from "../media/services/mediaRecoveryService.js";
import { MediaService } from "../media/services/mediaService.js";
import { setOperationalLogSinkForTests } from "../observability/operationalLogger.js";
import { VoiceMediaUploadWorkerService } from "../whatsapp/services/voiceMediaUploadWorkerService.js";
import { VoiceSynthesisWorkerService } from "../whatsapp/services/voiceSynthesisWorkerService.js";
import { VoiceTranscriptionWorkerService } from "../whatsapp/services/voiceTranscriptionWorkerService.js";

const at = "2026-09-22T00:00:00.000Z";
const base = (): NodeJS.ProcessEnv => ({ NODE_ENV: "production", DATABASE_PROVIDER: "libsql", TURSO_DATABASE_URL: "libsql://atlas.example.test", TURSO_AUTH_TOKEN: "database-token", ATLAS_VERIFICATION_ORIGIN: "https://portal.example.test", ATLAS_BOOTSTRAP_SECRET: "b".repeat(32), EMAIL_PROVIDER: "resend", RESEND_API_KEY: "email-token", RESEND_FROM: "atlas@example.test" });
const s3 = (): NodeJS.ProcessEnv => ({ ...base(), ATLAS_MEDIA_STORAGE_PROVIDER: "s3", ATLAS_S3_ENDPOINT: "https://storage.example.test", ATLAS_S3_REGION: "auto", ATLAS_S3_BUCKET: "atlas-media", ATLAS_S3_ACCESS_KEY_ID: "access-key", ATLAS_S3_SECRET_ACCESS_KEY: "secret-key" });

test("EPIC056 PASS6 production media fails closed while zero-media production remains explicitly unavailable", async () => {
  assert.equal(productionConfiguration(base()).mediaCapability, "unavailable");
  assert.throws(() => productionConfiguration({ ...base(), WHATSAPP_APP_SECRET: "secret", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify" }), /durable storage/u);
  assert.throws(() => productionConfiguration({ ...s3(), ATLAS_MEDIA_STORAGE_PROVIDER: "local" }), /durable media storage/u);
  await assert.rejects(new UnavailableMediaStorage().read("workspaces/1/companies/1/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object", 1));
});

test("EPIC056 PASS6 validates the private S3 contract and forbids production local fallback", () => {
  assert.equal(s3MediaStorageConfiguration(s3()).bucket, "atlas-media");
  assert.throws(() => s3MediaStorageConfiguration({ ...s3(), ATLAS_S3_ENDPOINT: "http://storage.example.test" }), /S3 media configuration/u);
  const configuration = readFileSync(new URL("../config/productionConfiguration.ts", import.meta.url), "utf8"), storage = readFileSync(new URL("../media/infrastructure/s3MediaStorage.ts", import.meta.url), "utf8");
  assert.match(configuration, /DATABASE_PROVIDER !== "libsql"/u);
  assert.match(storage, /IfNoneMatch:"\*"/u);
  assert.doesNotMatch(configuration, /ATLAS_MEDIA_STORAGE_PROVIDER.*local/u);
});

test("EPIC056 PASS6 restore mismatch reconciliation marks missing and corrupt ready media unavailable and removes only old orphans", async () => {
  const context = { workspaceId: 1, workspaceKey: "restore" }, blob: MediaBlob = { id: "mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", workspaceId: 1, companyId: 1, digest: "a".repeat(64), sizeBytes: 3, mediaType: "audio/ogg", storageReference: "workspaces/1/companies/1/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object", state: "active", createdAt: at }, corrupt: MediaBlob = { ...blob, id: "mbl_cccccccccccccccccccccccccccccccc", storageReference: "workspaces/1/companies/1/media/mbl_cccccccccccccccccccccccccccccccc/object" };
  const unavailable: string[] = [], deleted: string[] = [], logs: Array<Record<string, unknown>> = [], restore = setOperationalLogSinkForTests(line => { logs.push(JSON.parse(line) as Record<string, unknown>); });
  const repository = { leaseIncomplete: async () => [], listReadyBlobs: async () => [blob, corrupt], markBlobUnavailable: async (_context: unknown, _company: number, id: string, category: string) => { unavailable.push(`${id}:${category}`); }, leaseReclaims: async () => [], listRecoveryScopes: async () => [], referencesStorage: async () => false };
  const storage = { read: async (reference: string) => { if(reference===blob.storageReference) throw new MediaStorageError("not_found"); return Uint8Array.of(1, 2, 3); }, listOwned: async () => [{ reference: "workspaces/1/companies/1/media/mbl_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/object", createdAt: "2026-09-20T00:00:00.000Z" }], delete: async (reference: string) => { deleted.push(reference); return { status: "absent" as const }; } };
  try { await new MediaRecoveryService(repository as never, storage as never, { now: () => at }).recover(context, 1, { owner: "restore", limit: 10, leaseMilliseconds: 60_000 }); }
  finally { restore(); }
  assert.deepEqual(unavailable, [`${blob.id}:not_found`, `${corrupt.id}:integrity`]);
  assert.deepEqual(deleted, ["workspaces/1/companies/1/media/mbl_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/object"]);
  assert.deepEqual(logs.map(log => log.event).sort(), ["media_orphans_cleaned", "media_ready_object_corrupt", "media_ready_object_missing"]);
});

test("EPIC056 PASS6 recovery only finalizes reclaim after confirmed absence and retains scope", async () => {
  const context = { workspaceId: 3, workspaceKey: "restore" }, calls: Array<readonly unknown[]> = [], blob = { id: "mbl_cccccccccccccccccccccccccccccccc", storageReference: "workspaces/3/companies/4/media/mbl_cccccccccccccccccccccccccccccccc/object" };
  const repository = { leaseIncomplete: async () => [], listReadyBlobs: async () => [], leaseReclaims: async (receivedContext: unknown, companyId: number) => { calls.push([receivedContext, companyId]); return [blob]; }, finalizeLeasedReclaim: async (receivedContext: unknown, companyId: number, id: string) => { calls.push([receivedContext, companyId, id]); return true; }, listRecoveryScopes: async () => [], referencesStorage: async () => false };
  const storage = { delete: async () => ({ status: "absent" as const }), listOwned: async () => [] };
  const restore = setOperationalLogSinkForTests(() => undefined); try { await new MediaRecoveryService(repository as never, storage as never, { now: () => at }).recover(context, 4, { owner: "reclaim", limit: 1, leaseMilliseconds: 60_000 }); } finally { restore(); }
  assert.equal(calls.length, 2); assert.equal(calls.every(call => call[0] === context && call[1] === 4), true);
});

test("EPIC056 PASS6 Google speech configuration fails closed without a valid approved secret", () => {
  assert.equal(googleCloudSpeechConfiguration({} as NodeJS.ProcessEnv), null);
  assert.throws(() => googleCloudSpeechConfiguration({ GOOGLE_CLOUD_SPEECH_SERVICE_ACCOUNT_JSON_B64: "invalid" } as NodeJS.ProcessEnv), GoogleCloudSpeechConfigurationError);
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const encoded = Buffer.from(JSON.stringify({ type: "service_account", project_id: "atlas", client_email: "speech@atlas.test", private_key: key, token_uri: "https://oauth2.googleapis.com/token" })).toString("base64");
  assert.equal(googleCloudSpeechConfiguration({ GOOGLE_CLOUD_SPEECH_SERVICE_ACCOUNT_JSON_B64: encoded } as NodeJS.ProcessEnv)?.tokenUri, "https://oauth2.googleapis.com/token");
});

test("EPIC056 PASS6 preserves channel and upload boundaries", () => {
  const outbound = readFileSync(new URL("../whatsapp/services/WhatsAppOutboundDeliveryService.ts", import.meta.url), "utf8"), voice = readFileSync(new URL("../whatsapp/infrastructure/asyncWhatsAppVoicePersistence.ts", import.meta.url), "utf8"), webChat = readFileSync(new URL("../webChat/services/publicWebChatSessionService.ts", import.meta.url), "utf8"), media = readFileSync(new URL("../media/services/mediaService.ts", import.meta.url), "utf8"), recovery = readFileSync(new URL("../media/services/mediaRecoveryService.ts", import.meta.url), "utf8"), workers = ["voiceTranscriptionWorkerService.ts", "voiceSynthesisWorkerService.ts", "voiceMediaUploadWorkerService.ts"].map(name => readFileSync(new URL(`../whatsapp/services/${name}`, import.meta.url), "utf8")).join("\n"), backup = readFileSync(new URL("../scripts/backup.ts", import.meta.url), "utf8"), migrations = readFileSync(new URL("../config/migrations.ts", import.meta.url), "utf8");
  assert.match(outbound, /findUploadedProviderMediaId\(context, connection\.companyId, delivery\.id\)/u);
  assert.match(outbound, /settleUncertainSend\(delivery\.id, owner, "send_outcome_unknown"/u);
  assert.match(voice, /workspace_id=\? AND company_id=\?/u);
  assert.doesNotMatch(webChat, /attachment|media\.store|media\.attach|upload/iu);
  assert.match(media, /readonly operation: "ingest"/u);
  for(const event of ["media_ingest_reserved", "media_ingest_staged", "media_ingest_promoted", "media_ingest_settled", "media_ingest_retryable_failure", "media_ingest_terminal_failure"])assert.match(media,new RegExp(event,"u"));
  for(const event of ["media_recovery_claimed", "media_recovery_settled", "media_recovery_failed", "media_reclaim_completed", "media_reclaim_ambiguous", "media_ready_object_missing", "media_ready_object_corrupt", "media_orphans_cleaned"])assert.match(recovery,new RegExp(event,"u"));
  for(const event of ["voice_transcription_failed", "voice_synthesis_failed", "voice_media_upload_failed"])assert.match(workers,new RegExp(event,"u"));
  assert.match(backup, /--writes-quiesced/u);
  assert.match(migrations, /0078_media_reclaim_leases/u);
  assert.doesNotMatch(readFileSync(new URL("../whatsapp/providers/GoogleCloudSpeechProvider.ts", import.meta.url), "utf8"), /application\/pdf|pdf/iu);
});

test("EPIC056 PASS6 logs direct and swept reclaim completion only after storage confirms absence", async () => {
  const context = { workspaceId: 1, workspaceKey: "test" }, blob = { id: "mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", storageReference: "workspaces/1/companies/1/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object" }, logs: Array<Record<string, unknown>> = [], finalized: string[] = [], restore = setOperationalLogSinkForTests(line => { logs.push(JSON.parse(line) as Record<string, unknown>); });
  const repository = { delete: async () => ({ asset: { id: "mas_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, reclaim: blob }), finalizeReclaim: async (_context: unknown, _company: number, id: string) => { finalized.push(id); }, listPendingReclaims: async () => [blob] };
  const service = new MediaService(repository as never, { delete: async () => ({ status: "absent" as const }) } as never, {} as never, {} as never, { now: () => at });
  try { await service.delete(context, 1, "mas_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); await service.sweepPendingReclaims(context, 1); } finally { restore(); }
  assert.deepEqual(finalized, [blob.id, blob.id]); assert.deepEqual(logs.map(log => log.event), ["media_reclaim_completed", "media_reclaim_completed"]); assert.equal(logs.some(log => JSON.stringify(log).includes(blob.storageReference)), false);
});

test("EPIC056 PASS6 logs ambiguous direct and swept reclaims without finalizing", async () => {
  const context = { workspaceId: 1, workspaceKey: "test" }, blob = { id: "mbl_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", storageReference: "workspaces/1/companies/1/media/mbl_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/object" }, logs: Array<Record<string, unknown>> = [], finalized: string[] = [], restore = setOperationalLogSinkForTests(line => { logs.push(JSON.parse(line) as Record<string, unknown>); });
  const repository = { delete: async () => ({ asset: { id: "mas_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, reclaim: blob }), finalizeReclaim: async (_context: unknown, _company: number, id: string) => { finalized.push(id); }, listPendingReclaims: async () => [blob] }, service = new MediaService(repository as never, { delete: async () => { throw new Error("raw storage secret"); } } as never, {} as never, {} as never, { now: () => at });
  try { await assert.rejects(service.delete(context, 1, "mas_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")); await assert.rejects(service.sweepPendingReclaims(context, 1)); } finally { restore(); }
  assert.deepEqual(finalized, []); assert.deepEqual(logs.map(log => log.event), ["media_reclaim_ambiguous", "media_reclaim_ambiguous"]); assert.equal(logs.every(log => log.safeErrorCategory === "media_storage_failed" && !JSON.stringify(log).includes("raw storage secret")), true);
});

test("EPIC056 PASS6 logs synthesis persistence and upload media-open failures once without payloads", async () => {
  const context = { workspaceId: 1, workspaceKey: "test" }, logs: Array<Record<string, unknown>> = [], restore = setOperationalLogSinkForTests(line => { logs.push(JSON.parse(line) as Record<string, unknown>); });
  const synthesisRequest = { id: "vsr_1", state: "leased" }, upload = { id: "wou_1", mediaAssetId: "mas_1", state: "uploading" };
  const synthesis = new VoiceSynthesisWorkerService({ leaseSynthesis: async () => [synthesisRequest], authorizeSynthesis: async () => ({ kind: "authorized", text: "private prompt" }), finalizeSynthesis: async () => ({ state: "retryable" }) } as never, { store: async () => { throw new Error("raw audio"); } } as never, { synthesize: async () => ({ kind: "completed", mimeType: "audio/ogg", audio: Uint8Array.of(7, 8, 9) }) }, { now: () => at }, { owner: "worker", batchSize: 1, leaseMilliseconds: 60_000, synthesisTimeoutMilliseconds: 50 });
  const uploader = new VoiceMediaUploadWorkerService({ leaseUploads: async () => [upload], authorizeUpload: async () => ({ kind: "authorized", connectionId: "secret-connection", mediaType: "audio/ogg", filename: "secret.ogg" }), finalizeUpload: async () => ({ state: "expired", safeErrorCategory: "media_unavailable" }) } as never, { open: async () => { throw new Error("raw audio"); } } as never, { upload: async () => ({ kind: "uploaded", providerMediaId: "never" }) }, { now: () => at }, { owner: "worker", batchSize: 1, leaseMilliseconds: 60_000, uploadTimeoutMilliseconds: 50 });
  try { await synthesis.runOnce(context, 1); await uploader.runOnce(context, 1); } finally { restore(); }
  assert.deepEqual(logs.map(log => [log.event, log.safeErrorCategory]), [["voice_synthesis_failed", "media_persistence_failed"], ["voice_media_upload_failed", "media_unavailable"]]); assert.equal(logs.every(log => !JSON.stringify(log).includes("raw audio") && !JSON.stringify(log).includes("secret")), true);
});

test("EPIC056 PASS6 logs unsupported audio and invalid transcripts once without audio bytes", async () => {
  const context = { workspaceId: 1, workspaceKey: "test" }, logs: Array<Record<string, unknown>> = [], restore = setOperationalLogSinkForTests(line => { logs.push(JSON.parse(line) as Record<string, unknown>); });
  const request = { id: "atr_1", conversationId: "cnv_1", messageId: "msg_1", mediaAssetId: "mas_1", state: "leased" }, repository = { leaseTranscriptions: async () => [request], settleTranscription: async () => request };
  const unsupported = new VoiceTranscriptionWorkerService(repository as never, { open: async () => Uint8Array.of(1, 2, 3) } as never, { transcribe: async () => ({ kind: "completed", transcript: "never", languageTag: null }) }, { now: () => at }, { owner: "worker", batchSize: 1, leaseMilliseconds: 60_000, transcriptionTimeoutMilliseconds: 50, maximumDurationMilliseconds: 2_000, createTranscriptId: () => "cat_1" });
  const invalid = new VoiceTranscriptionWorkerService(repository as never, { open: async () => wav() } as never, { transcribe: async () => ({ kind: "completed", transcript: "   ", languageTag: null }) }, { now: () => at }, { owner: "worker", batchSize: 1, leaseMilliseconds: 60_000, transcriptionTimeoutMilliseconds: 50, maximumDurationMilliseconds: 2_000, createTranscriptId: () => "cat_1" });
  try { await unsupported.runOnce(context, 1); await invalid.runOnce(context, 1); } finally { restore(); }
  assert.deepEqual(logs.map(log => [log.event, log.safeErrorCategory]), [["voice_transcription_failed", "unsupported_audio"], ["voice_transcription_failed", "invalid_transcript"]]); assert.equal(logs.every(log => !JSON.stringify(log).includes("cnv_1") && !JSON.stringify(log).includes("msg_1")), true);
});

function wav(): Uint8Array { const bytes = new Uint8Array(44 + 16_000), view = new DataView(bytes.buffer); bytes.set(Buffer.from("RIFF")); view.setUint32(4, 16_036, true); bytes.set(Buffer.from("WAVEfmt "), 8); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8_000, true); view.setUint32(28, 16_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); bytes.set(Buffer.from("data"), 36); view.setUint32(40, 16_000, true); return bytes; }
