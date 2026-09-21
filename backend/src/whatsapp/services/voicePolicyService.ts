import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AsyncVoiceRepositoryPort, VoiceRepositoryPort } from "../application/voicePorts.js";
import { voiceBounded, voiceMode, voicePositive, type VoiceAudioResponseMode, type WhatsAppVoicePolicy } from "../domain/voice.js";

export class VoicePolicyValidationError extends Error {}
export class VoicePolicyNotFoundError extends Error {}
export class VoicePolicyConflictError extends Error {}

export interface VoicePolicyResponse {
  readonly voiceAiEnabled: boolean;
  readonly audioResponseMode: VoiceAudioResponseMode;
  readonly version: number;
}

export class VoicePolicyService {
  public constructor(private readonly policies: Pick<AsyncVoiceRepositoryPort, "findPolicy" | "applyPolicy"> | Pick<VoiceRepositoryPort, "findPolicy" | "applyPolicy">, private readonly clock: { now(): string }) {}

  public async get(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): Promise<VoicePolicyResponse> {
    const { companyId, connectionId } = this.scope(companyIdValue, connectionIdValue);
    const value = await this.policies.findPolicy(context, companyId, connectionId);
    if (!value) throw new VoicePolicyNotFoundError();
    return response(value);
  }

  public async update(context: WorkspaceContext, actorId: string, companyIdValue: unknown, connectionIdValue: unknown, input: unknown): Promise<VoicePolicyResponse> {
    const { companyId, connectionId } = this.scope(companyIdValue, connectionIdValue);
    const command = this.command(input);
    const result = await this.policies.applyPolicy(context, companyId, connectionId, { actorId, ...command, occurredAt: this.clock.now() });
    if (result.kind === "applied" || result.kind === "replayed_applied") return response(result.policy);
    if (result.kind === "not_found") throw new VoicePolicyNotFoundError();
    throw new VoicePolicyConflictError();
  }

  private scope(companyIdValue: unknown, connectionIdValue: unknown): { companyId: number; connectionId: string } {
    const companyId = typeof companyIdValue === "number" ? companyIdValue : typeof companyIdValue === "string" && /^\d+$/.test(companyIdValue) ? Number(companyIdValue) : NaN;
    try {
      if (!Number.isSafeInteger(companyId) || companyId < 1 || typeof connectionIdValue !== "string") throw new Error();
      return { companyId, connectionId: voiceBounded(connectionIdValue, "Voice connection ID", 200) };
    } catch { throw new VoicePolicyNotFoundError(); }
  }

  private command(input: unknown): { operationId: string; expectedVersion: number; voiceAiEnabled: boolean; audioResponseMode: VoiceAudioResponseMode } {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new VoicePolicyValidationError("Voice policy is invalid.");
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 4 || !("operationId" in value) || !("expectedVersion" in value) || !("voiceAiEnabled" in value) || !("audioResponseMode" in value) || typeof value.operationId !== "string" || typeof value.voiceAiEnabled !== "boolean" || typeof value.audioResponseMode !== "string" || typeof value.expectedVersion !== "number" || !Number.isSafeInteger(value.expectedVersion)) throw new VoicePolicyValidationError("Voice policy is invalid.");
    try {
      return { operationId: voiceBounded(value.operationId, "Voice operation ID", 200), expectedVersion: voicePositive(value.expectedVersion, "Voice expected version"), voiceAiEnabled: value.voiceAiEnabled, audioResponseMode: voiceMode(value.audioResponseMode) };
    } catch { throw new VoicePolicyValidationError("Voice policy is invalid."); }
  }
}

function response(value: WhatsAppVoicePolicy): VoicePolicyResponse {
  return { voiceAiEnabled: value.voiceAiEnabled, audioResponseMode: value.audioResponseMode, version: value.version };
}
