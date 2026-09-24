import { randomUUID } from "node:crypto";
import type { AsyncVoiceRepositoryPort } from "../application/voicePorts.js";
import { VoiceMediaUploadWorkerService } from "./voiceMediaUploadWorkerService.js";
import { VoiceSynthesisWorkerService } from "./voiceSynthesisWorkerService.js";
import { VoiceTranscriptionWorkerService } from "./voiceTranscriptionWorkerService.js";

/** Runs queued voice stages serially so durable prerequisites settle before outbound dispatch. */
export class VoiceWorkerRecoveryService {
  public constructor(private readonly voices: AsyncVoiceRepositoryPort, private readonly transcription: VoiceTranscriptionWorkerService, private readonly synthesis: VoiceSynthesisWorkerService, private readonly upload: VoiceMediaUploadWorkerService) {}

  public async transcribeAvailable(): Promise<number> { return this.each(worker => this.transcription.runOnce(worker.context, worker.companyId)); }
  public async synthesizeAvailable(): Promise<number> { return this.each(worker => this.synthesis.runOnce(worker.context, worker.companyId)); }
  public async uploadAvailable(): Promise<number> { return this.each(worker => this.upload.runOnce(worker.context, worker.companyId)); }

  private async each(run: (scope: { readonly context: { readonly workspaceId: number; readonly workspaceKey: string }; readonly companyId: number }) => Promise<readonly unknown[]>): Promise<number> {
    let count=0; for (const scope of await this.voices.recoverableVoiceWorkScopes(100)) count+=(await run({ context: { workspaceId: scope.workspaceId, workspaceKey: "whatsapp" }, companyId: scope.companyId })).length; return count;
  }
}

export function voiceWorkerOptions(prefix: string): { readonly owner: string; readonly batchSize: number; readonly leaseMilliseconds: number; readonly timeoutMilliseconds: number } { return { owner: `${prefix}-${randomUUID()}`, batchSize: 25, leaseMilliseconds: 60_000, timeoutMilliseconds: 15_000 }; }
