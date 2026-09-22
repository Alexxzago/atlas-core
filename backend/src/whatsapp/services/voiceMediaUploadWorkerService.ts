import type { MediaService } from "../../media/services/mediaService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppOutboundMediaUploadPort } from "../application/outboundMediaUploadPort.js";
import type { AsyncVoiceRepositoryPort, VoiceRepositoryPort } from "../application/voicePorts.js";
import type { WhatsAppOutboundMediaUpload } from "../domain/voice.js";

export type VoiceMediaUploadWorkerOutcome = { readonly kind: "uploaded" | "retryable" | "failed" | "suppressed" | "lease_lost"; readonly uploadId: string; };
export interface VoiceMediaUploadWorkerOptions { readonly owner: string; readonly batchSize: number; readonly leaseMilliseconds: number; readonly uploadTimeoutMilliseconds: number; }

export class VoiceMediaUploadWorkerService {
  public constructor(private readonly voices: VoiceRepositoryPort | AsyncVoiceRepositoryPort, private readonly media: Pick<MediaService, "open">, private readonly provider: WhatsAppOutboundMediaUploadPort, private readonly clock: { now(): string }, private readonly options: VoiceMediaUploadWorkerOptions) {}
  public async runOnce(context: WorkspaceContext, companyId: number): Promise<readonly VoiceMediaUploadWorkerOutcome[]> { const now = this.clock.now(), uploads = await this.voices.leaseUploads(context, companyId, { owner: this.options.owner, now, expiresAt: new Date(Date.parse(now) + this.options.leaseMilliseconds).toISOString(), limit: this.options.batchSize }); return Promise.all(uploads.map(upload => this.process(context, companyId, upload))); }
  private async process(context: WorkspaceContext, companyId: number, upload: WhatsAppOutboundMediaUpload): Promise<VoiceMediaUploadWorkerOutcome> {
    const authorization = await this.voices.authorizeUpload(context, companyId, upload.id, this.options.owner, this.clock.now());
    if (authorization.kind !== "authorized") return { kind: authorization.kind, uploadId: upload.id };
    let content: Uint8Array;
    try { content = await this.media.open(context, companyId, upload.mediaAssetId); } catch { return this.settle(context, companyId, upload, { kind: "retryable", safeFailureCategory: "media_unavailable" }); }
    const result = await this.callProvider(context, companyId, authorization.connectionId, { mediaType: authorization.mediaType, filename: authorization.filename, content });
    return this.settle(context, companyId, upload, result);
  }
  private async callProvider(context: WorkspaceContext, companyId: number, connectionId: string, input: { readonly mediaType: string; readonly filename: string | null; readonly content: Uint8Array }): Promise<Awaited<ReturnType<WhatsAppOutboundMediaUploadPort["upload"]>>> { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; try { const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("upload_timeout")); }, this.options.uploadTimeoutMilliseconds); }); return await Promise.race([this.provider.upload(context, companyId, connectionId, { ...input, signal: controller.signal }), timeout]); } catch { return { kind: "retryable", safeFailureCategory: controller.signal.aborted ? "timeout" : "provider_unavailable" }; } finally { if (timer) clearTimeout(timer); } }
  private async settle(context: WorkspaceContext, companyId: number, upload: WhatsAppOutboundMediaUpload, result: Awaited<ReturnType<WhatsAppOutboundMediaUploadPort["upload"]>>): Promise<VoiceMediaUploadWorkerOutcome> { const saved = await this.voices.finalizeUpload(context, companyId, upload.id, this.options.owner, result, this.clock.now()); return { kind: saved?.state === "uploaded" ? "uploaded" : saved?.state === "expired" ? "retryable" : saved?.safeErrorCategory === "suppressed" ? "suppressed" : saved?.state === "failed" ? "failed" : "lease_lost", uploadId: upload.id }; }
}
