import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { googleCloudSpeechConfiguration, GoogleCloudSpeechConfigurationError } from "../config/googleCloudSpeechConfiguration.js";
import { VoiceMediaUploadWorkerService } from "../whatsapp/services/voiceMediaUploadWorkerService.js";
import { GoogleCloudSpeechProvider } from "../whatsapp/providers/GoogleCloudSpeechProvider.js";
import { runWhatsAppRecoveryCycle } from "../whatsapp/services/whatsAppRecoveryCycle.js";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const encoded = Buffer.from(JSON.stringify({ type: "service_account", project_id: "atlas-test", client_email: "speech@atlas-test.iam.gserviceaccount.com", private_key: key, token_uri: "https://oauth2.googleapis.com/token" }), "utf8").toString("base64");
const configuration = () => googleCloudSpeechConfiguration({ GOOGLE_CLOUD_SPEECH_SERVICE_ACCOUNT_JSON_B64: encoded } as NodeJS.ProcessEnv)!;
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const maximumResponseBytes = 16 * 1024 * 1024;
function streamedResponse(chunks: readonly Uint8Array[], contentLength: string | null = null, onCancel: (() => void) | undefined = undefined): Response { let index = 0; return new Response(new ReadableStream<Uint8Array>({ pull(controller) { if (index === chunks.length) controller.close(); else controller.enqueue(chunks[index++]!); }, cancel() { onCancel?.(); } }), { headers: { "content-type": "application/json", ...(contentLength === null ? {} : { "content-length": contentLength }) } }); }
function overflowingResponse(contentLength: string | null, onCancel: () => void): Response { return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(maximumResponseBytes + 1)); }, cancel() { onCancel(); } }), { headers: { "content-type": "application/json", ...(contentLength === null ? {} : { "content-length": contentLength }) } }); }
function speechFetcher(speech: Response): typeof fetch { let calls = 0; return async () => ++calls === 1 ? response({ access_token: "token", expires_in: 3600 }) : speech; }

test("EPIC056 PASS5 decodes only the approved service-account secret and fails closed", () => {
  assert.equal(googleCloudSpeechConfiguration({} as NodeJS.ProcessEnv), null);
  assert.equal(configuration().clientEmail, "speech@atlas-test.iam.gserviceaccount.com");
  assert.throws(() => googleCloudSpeechConfiguration({ GOOGLE_CLOUD_SPEECH_SERVICE_ACCOUNT_JSON_B64: "not-base64" } as NodeJS.ProcessEnv), GoogleCloudSpeechConfigurationError);
  const incomplete = Buffer.from(JSON.stringify({ type: "service_account", project_id: "p" })).toString("base64");
  assert.throws(() => googleCloudSpeechConfiguration({ GOOGLE_CLOUD_SPEECH_SERVICE_ACCOUNT_JSON_B64: incomplete } as NodeJS.ProcessEnv), GoogleCloudSpeechConfigurationError);
});

test("EPIC056 PASS5 exchanges and caches OAuth tokens without exposing credential material", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), body: String(init?.body ?? "") }); return response(calls.length === 1 ? { access_token: "token-one", expires_in: 3600 } : { audioContent: Buffer.from([79, 103, 103, 83, 0]).toString("base64") }); };
  const provider = new GoogleCloudSpeechProvider(configuration(), fetcher);
  await Promise.all([provider.synthesize({ text: "hola", signal: new AbortController().signal }), provider.synthesize({ text: "adios", signal: new AbortController().signal })]);
  assert.equal(calls.filter(call => call.url === "https://oauth2.googleapis.com/token").length, 1);
  assert.match(calls[0]!.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/u);
  assert.doesNotMatch(calls.map(call => `${call.url}\n${call.body}`).join("\n"), new RegExp(key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
});

test("EPIC056 PASS5 refreshes cached tokens before expiry and fails provider errors safely", async () => {
  let now = 0, tokenCalls = 0;
  const fetcher: typeof fetch = async (url) => {
    if (String(url).endsWith("/token")) return response({ access_token: `token-${++tokenCalls}`, expires_in: 3600 });
    return response({ error: { message: "sensitive provider response" } }, 503);
  };
  const provider = new GoogleCloudSpeechProvider(configuration(), fetcher, () => now), signal = new AbortController().signal;
  assert.deepEqual(await provider.synthesize({ text: "hola", signal }), { kind: "retryable", safeFailureCategory: "provider_unavailable" });
  now = 3_541_000;
  assert.deepEqual(await provider.synthesize({ text: "hola", signal }), { kind: "retryable", safeFailureCategory: "provider_unavailable" });
  assert.equal(tokenCalls, 2);
});

test("EPIC056 PASS5 sends OGG_OPUS TTS and supports Ogg Opus plus WAV STT", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (url, init) => { const value = String(url); if (value.endsWith("/token")) return response({ access_token: "token", expires_in: 3600 }); const body = JSON.parse(String(init?.body)) as Record<string, unknown>; requests.push({ url: value, body }); return value.includes("text:synthesize") ? response({ audioContent: Buffer.from([79, 103, 103, 83, 0]).toString("base64") }) : response({ results: [{ alternatives: [{ transcript: "hola" }] },], languageCode: "es" }); };
  const provider = new GoogleCloudSpeechProvider(configuration(), fetcher), signal = new AbortController().signal;
  assert.equal((await provider.synthesize({ text: "hola", signal })).kind, "completed");
  assert.equal((await provider.transcribe({ audio: Uint8Array.of(79, 103, 103, 83), mimeType: "audio/ogg", durationMilliseconds: 1, signal })).kind, "completed");
  assert.equal((await provider.transcribe({ audio: Uint8Array.of(82, 73, 70, 70), mimeType: "audio/wav", durationMilliseconds: 1, signal })).kind, "completed");
  assert.equal(((requests[0]!.body.audioConfig as Record<string, unknown>).audioEncoding), "OGG_OPUS");
  assert.deepEqual(requests.filter(request => request.url.includes("speech:recognize")).map(request => (request.body.config as Record<string, unknown>).encoding), ["OGG_OPUS", "LINEAR16"]);
});

test("EPIC056 PASS5 bounds valid Google JSON responses while streaming", async () => {
  const payload = Buffer.from(JSON.stringify({ audioContent: Buffer.from([79, 103, 103, 83, 0]).toString("base64") }));
  const provider = new GoogleCloudSpeechProvider(configuration(), speechFetcher(streamedResponse([payload.subarray(0, 9), payload.subarray(9)])), () => 0);
  assert.equal((await provider.synthesize({ text: "hola", signal: new AbortController().signal })).kind, "completed");
});

test("EPIC056 PASS5 rejects oversized Google Content-Length before body consumption", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const provider = new GoogleCloudSpeechProvider(configuration(), speechFetcher(new Response(body, { headers: { "content-length": String(maximumResponseBytes + 1) } })), () => 0);
  assert.deepEqual(await provider.synthesize({ text: "hola", signal: new AbortController().signal }), { kind: "retryable", safeFailureCategory: "provider_unavailable" });
  assert.equal(cancelled, true);
});

test("EPIC056 PASS5 rejects oversized chunked Google responses during streaming", async () => {
  let cancelled = false;
  const provider = new GoogleCloudSpeechProvider(configuration(), speechFetcher(overflowingResponse(null, () => { cancelled = true; })), () => 0);
  assert.deepEqual(await provider.synthesize({ text: "hola", signal: new AbortController().signal }), { kind: "retryable", safeFailureCategory: "provider_unavailable" });
  assert.equal(cancelled, true);
});

test("EPIC056 PASS5 rejects Google bodies exceeding a small declared Content-Length", async () => {
  let cancelled = false;
  const provider = new GoogleCloudSpeechProvider(configuration(), speechFetcher(overflowingResponse("1", () => { cancelled = true; })), () => 0);
  assert.deepEqual(await provider.synthesize({ text: "hola", signal: new AbortController().signal }), { kind: "retryable", safeFailureCategory: "provider_unavailable" });
  assert.equal(cancelled, true);
});

test("EPIC056 PASS5 maps aborted Google response reads to the existing safe timeout", async () => {
  const controller = new AbortController();
  const provider = new GoogleCloudSpeechProvider(configuration(), async (_url, init) => {
    if (String(_url).endsWith("/token")) return response({ access_token: "token", expires_in: 3600 });
    const signal = init?.signal as AbortSignal;
    return new Response(new ReadableStream<Uint8Array>({ pull() { controller.abort(); return Promise.reject(new DOMException("aborted", "AbortError")); } }), { headers: { "content-type": "application/json" } });
  }, () => 0);
  assert.deepEqual(await provider.synthesize({ text: "hola", signal: controller.signal }), { kind: "retryable", safeFailureCategory: "timeout" });
});

test("EPIC056 PASS5 durably records the Meta media ID before audio dispatch", async () => {
  const context = { workspaceId: 1, workspaceKey: "pass5" }, upload = { id: "wou_1", workspaceId: 1, companyId: 1, outboundDeliveryId: "odl_1", mediaAssetId: "mas_1", providerMediaId: null, state: "uploading", leaseOwner: "worker", leaseExpiresAt: "2026-09-22T00:01:00.000Z", attemptCount: 1, safeErrorCategory: null, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z" } as const;
  let providerMediaId: string | null = null, sent = 0;
  const worker = new VoiceMediaUploadWorkerService({ leaseUploads: () => [upload], authorizeUpload: () => ({ kind: "authorized", connectionId: "wac_1", mediaType: "audio/ogg", filename: "assistant.ogg" }), finalizeUpload: (_context, _company, _id, _owner, result) => { providerMediaId = result.kind === "uploaded" ? result.providerMediaId : null; return { ...upload, state: "uploaded", providerMediaId }; } } as never, { open: async () => Uint8Array.of(1) } as never, { upload: async () => ({ kind: "uploaded", providerMediaId: "meta-media-id" }) }, { now: () => "2026-09-22T00:00:00.000Z" }, { owner: "worker", batchSize: 1, leaseMilliseconds: 60_000, uploadTimeoutMilliseconds: 100 });
  await runWhatsAppRecoveryCycle(true, { executeProactive: async () => undefined, recoverInboundMedia: async () => undefined, recoverAtlasMedia: async () => undefined, transcribeVoice: async () => undefined, resumeIncomplete: async () => undefined, synthesizeVoice: async () => undefined, uploadVoice: async () => { await worker.runOnce(context, 1); }, dispatchOutbound: async () => { assert.equal(providerMediaId, "meta-media-id"); sent += 1; }, recoverVoiceSemantics: async () => undefined, recoverProactiveSemantics: async () => undefined });
  assert.equal(sent, 1);
});

test("EPIC056 PASS5 leaves ambiguous upload retries un-dispatched and does not duplicate the eventual send", async () => {
  const context = { workspaceId: 1, workspaceKey: "pass5" }, upload = { id: "wou_2", workspaceId: 1, companyId: 1, outboundDeliveryId: "odl_2", mediaAssetId: "mas_2", providerMediaId: null, state: "uploading", leaseOwner: "worker", leaseExpiresAt: "2026-09-22T00:01:00.000Z", attemptCount: 1, safeErrorCategory: null, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z" } as const;
  let attempts = 0, providerMediaId: string | null = null, dispatched = 0;
  const worker = new VoiceMediaUploadWorkerService({ leaseUploads: () => [upload], authorizeUpload: () => ({ kind: "authorized", connectionId: "wac_2", mediaType: "audio/ogg", filename: null }), finalizeUpload: (_context, _company, _id, _owner, result) => { providerMediaId = result.kind === "uploaded" ? result.providerMediaId : null; return { ...upload, state: result.kind === "uploaded" ? "uploaded" : "expired", providerMediaId }; } } as never, { open: async () => Uint8Array.of(1) } as never, { upload: async () => ++attempts === 1 ? { kind: "retryable", safeFailureCategory: "provider_unavailable" } : { kind: "uploaded", providerMediaId: "meta-after-retry" } }, { now: () => "2026-09-22T00:00:00.000Z" }, { owner: "worker", batchSize: 1, leaseMilliseconds: 60_000, uploadTimeoutMilliseconds: 100 });
  const cycle = () => runWhatsAppRecoveryCycle(true, { executeProactive: async () => undefined, recoverInboundMedia: async () => undefined, recoverAtlasMedia: async () => undefined, transcribeVoice: async () => undefined, resumeIncomplete: async () => undefined, synthesizeVoice: async () => undefined, uploadVoice: async () => { await worker.runOnce(context, 1); }, dispatchOutbound: async () => { if (providerMediaId) dispatched += 1; }, recoverVoiceSemantics: async () => undefined, recoverProactiveSemantics: async () => undefined });
  await cycle(); assert.equal(providerMediaId, null); assert.equal(dispatched, 0);
  await cycle(); assert.equal(providerMediaId, "meta-after-retry"); assert.equal(dispatched, 1); assert.equal(attempts, 2);
});

test("EPIC056 PASS5 preserves ambiguous sends, tenant scope, and channel-only media paths", () => {
  const outbound = readFileSync(new URL("../whatsapp/services/WhatsAppOutboundDeliveryService.ts", import.meta.url), "utf8"), inbound = readFileSync(new URL("../whatsapp/services/WhatsAppInboundMediaRecoveryService.ts", import.meta.url), "utf8"), upload = readFileSync(new URL("../whatsapp/services/voiceMediaUploadWorkerService.ts", import.meta.url), "utf8"), transcription = readFileSync(new URL("../whatsapp/services/voiceTranscriptionWorkerService.ts", import.meta.url), "utf8"), webChat = readFileSync(new URL("../webChat/services/publicWebChatSessionService.ts", import.meta.url), "utf8"), media = readFileSync(new URL("../media/services/mediaService.ts", import.meta.url), "utf8"), voice = readFileSync(new URL("../whatsapp/infrastructure/asyncWhatsAppVoicePersistence.ts", import.meta.url), "utf8");
  assert.match(outbound, /findUploadedProviderMediaId\(context, connection\.companyId, delivery\.id\)/u);
  assert.match(outbound, /settleUncertainSend\(delivery\.id, owner, "send_outcome_unknown"/u);
  assert.match(inbound, /operation: "ingest", idempotencyKey: `whatsapp-inbound:/u);
  assert.match(upload, /media\.open\(context, companyId, upload\.mediaAssetId\)/u);
  assert.match(transcription, /media\.open\(context, companyId, request\.mediaAssetId\)/u);
  assert.doesNotMatch(webChat, /attachment|media\.store|media\.attach|upload/iu);
  assert.match(media, /readonly operation: "ingest"/u);
  assert.match(voice, /workspace_id=\? AND company_id=\?/u);
  assert.match(voice, /findPlayback\(c:WorkspaceContext,companyId:number,conversationId:string,messageId:string\).*readRow\(c,companyId,conversationId,messageId\)/u);
  assert.doesNotMatch(readFileSync(new URL("../whatsapp/providers/GoogleCloudSpeechProvider.ts", import.meta.url), "utf8"), /application\/pdf|pdf/iu);
});

test("EPIC056 PASS5 keeps voice stages serially ordered before outbound dispatch", async () => {
  const calls: string[] = [];
  await runWhatsAppRecoveryCycle(true, { executeProactive: async () => { calls.push("proactive"); }, recoverInboundMedia: async () => { calls.push("inbound"); }, recoverAtlasMedia: async () => { calls.push("media"); }, transcribeVoice: async () => { calls.push("transcribe"); }, resumeIncomplete: async () => { calls.push("resume"); }, synthesizeVoice: async () => { calls.push("synthesize"); }, uploadVoice: async () => { calls.push("upload-meta-id"); }, dispatchOutbound: async () => { calls.push("send"); }, recoverVoiceSemantics: async () => { calls.push("voice-semantics"); }, recoverProactiveSemantics: async () => { calls.push("proactive-semantics"); } });
  assert.deepEqual(calls, ["proactive", "inbound", "media", "transcribe", "resume", "synthesize", "upload-meta-id", "send", "voice-semantics", "proactive-semantics"]);
});
