import { createHash } from "node:crypto";
import type { MediaService } from "../../media/services/mediaService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { SpeechTranscriptionPort } from "../application/speechTranscriptionPort.js";
import type { AsyncVoiceRepositoryPort, VoiceRepositoryPort, VoiceWorkSettlement } from "../application/voicePorts.js";
import type { AudioTranscriptionRequest } from "../domain/voice.js";
import { inspectVoiceAudio } from "../domain/audioInspection.js";

export type VoiceTranscriptionWorkerOutcome = { readonly kind: "completed" | "retryable" | "failed" | "lease_lost" | "conflict"; readonly requestId: string; };

export interface VoiceTranscriptionWorkerOptions {
  readonly owner: string;
  readonly batchSize: number;
  readonly leaseMilliseconds: number;
  readonly transcriptionTimeoutMilliseconds: number;
  readonly maximumDurationMilliseconds: number;
  createTranscriptId(): string;
}

export class VoiceTranscriptionWorkerService {
  public constructor(private readonly voices: VoiceRepositoryPort | AsyncVoiceRepositoryPort, private readonly media: Pick<MediaService, "open">, private readonly speech: SpeechTranscriptionPort, private readonly clock: { now(): string }, private readonly options: VoiceTranscriptionWorkerOptions) {}

  public async runOnce(context: WorkspaceContext, companyId: number): Promise<readonly VoiceTranscriptionWorkerOutcome[]> {
    const now = this.clock.now(), requests = await this.voices.leaseTranscriptions(context, companyId, { owner: this.options.owner, now, expiresAt: new Date(Date.parse(now) + this.options.leaseMilliseconds).toISOString(), limit: this.options.batchSize });
    return Promise.all(requests.map(request => this.transcribe(context, companyId, request)));
  }

  private async transcribe(context: WorkspaceContext, companyId: number, request: AudioTranscriptionRequest): Promise<VoiceTranscriptionWorkerOutcome> {
    let audio: Uint8Array;
    try { audio = await this.media.open(context, companyId, request.mediaAssetId); } catch { return this.settle(context, companyId, request, "retryable", "media_unavailable"); }
    const inspection = inspect(audio, this.options.maximumDurationMilliseconds);
    if (inspection === null) return this.settle(context, companyId, request, "failed", "unsupported_audio");
    const result = await this.callProvider(audio, inspection.mimeType, inspection.durationMilliseconds);
    if (result.kind !== "completed") return this.settle(context, companyId, request, result.kind === "retryable" ? "retryable" : "failed", result.safeFailureCategory);
    const normalizedTranscript = normalize(result.transcript);
    if (normalizedTranscript === null) return this.settle(context, companyId, request, "failed", "invalid_transcript");
    const at = this.clock.now(), finalized = await this.voices.finalizeTranscription(context, companyId, request.id, this.options.owner, { transcript: { id: this.options.createTranscriptId(), conversationId: request.conversationId, messageId: request.messageId, mediaAssetId: request.mediaAssetId, normalizedTranscript, languageTag: result.languageTag, inputDigest: createHash("sha256").update(audio).digest("hex"), outcome: "completed", safeFailureCategory: null, createdAt: at }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: at, updatedAt: at } });
    return { kind: finalized.kind === "opened" || finalized.kind === "suppressed" ? "completed" : finalized.kind, requestId: request.id };
  }

  private async callProvider(audio: Uint8Array, mimeType: "audio/ogg" | "audio/wav", durationMilliseconds: number): Promise<Awaited<ReturnType<SpeechTranscriptionPort["transcribe"]>>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("transcription_timeout")); }, this.options.transcriptionTimeoutMilliseconds); });
      return await Promise.race([this.speech.transcribe({ audio, mimeType, durationMilliseconds, signal: controller.signal }), timeout]);
    } catch { return { kind: "retryable", safeFailureCategory: controller.signal.aborted ? "timeout" : "provider_unavailable" }; } finally { if (timer) clearTimeout(timer); }
  }

  private async settle(context: WorkspaceContext, companyId: number, request: AudioTranscriptionRequest, state: "retryable" | "failed", category: string): Promise<VoiceTranscriptionWorkerOutcome> {
    const at = this.clock.now(), settlement: VoiceWorkSettlement = { state, safeOutcome: state, safeFailureCategory: category, completedAt: state === "failed" ? at : null, updatedAt: at };
    return { kind: await this.voices.settleTranscription(context, companyId, request.id, this.options.owner, settlement) === null ? "lease_lost" : state, requestId: request.id };
  }
}

function inspect(audio: Uint8Array, maximumDurationMilliseconds: number): Extract<ReturnType<typeof inspectVoiceAudio>, { readonly kind: "processable" }> | null {
  const wav = inspectVoiceAudio(audio, "audio/wav", maximumDurationMilliseconds);
  return wav.kind === "processable" ? wav : (() => { const ogg = inspectVoiceAudio(audio, "audio/ogg", maximumDurationMilliseconds); return ogg.kind === "processable" ? ogg : null; })();
}

function normalize(value: string): string | null { const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim(); return normalized && Array.from(normalized).length <= 16_000 ? normalized : null; }
