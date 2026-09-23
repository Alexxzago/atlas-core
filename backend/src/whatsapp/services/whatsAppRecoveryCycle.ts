import type { WhatsAppRecoveryStage, WhatsAppResumeSubstage } from "../../config/runtimeReadiness.js";

export interface WhatsAppRecoveryCycleDependencies {
  executeProactive(): Promise<void>;
  recoverInboundMedia(onStage?: (stage: WhatsAppRecoveryStage | null) => void): Promise<unknown>;
  recoverAtlasMedia(): Promise<unknown>;
  transcribeVoice?(): Promise<unknown>;
  resumeIncomplete(onSubstage?: (substage: WhatsAppResumeSubstage) => void): Promise<unknown>;
  synthesizeVoice?(): Promise<unknown>;
  uploadVoice?(): Promise<unknown>;
  dispatchOutbound(): Promise<void>;
  recoverVoiceSemantics(): Promise<unknown>;
  recoverProactiveSemantics(): Promise<unknown>;
}

/** Keeps non-media recovery active when production intentionally has no media capability. */
export async function runWhatsAppRecoveryCycle(mediaAvailable: boolean, dependencies: WhatsAppRecoveryCycleDependencies, onStage: (stage: WhatsAppRecoveryStage | null) => void = () => undefined, onSubstage: (substage: WhatsAppResumeSubstage) => void = () => undefined): Promise<void> {
  await stage("proactive_execution", dependencies.executeProactive, onStage);
  if (mediaAvailable) await stage("recover_inbound_media", () => dependencies.recoverInboundMedia(onStage), onStage);
  if (mediaAvailable) await stage("recover_durable_media", () => dependencies.recoverAtlasMedia(), onStage);
  if (mediaAvailable && dependencies.transcribeVoice) await stage("voice_transcription", dependencies.transcribeVoice, onStage);
  await stage("resume_incomplete_executions", () => dependencies.resumeIncomplete(onSubstage), onStage);
  if (mediaAvailable && dependencies.synthesizeVoice) await stage("voice_synthesis", dependencies.synthesizeVoice, onStage);
  if (mediaAvailable && dependencies.uploadVoice) await stage("voice_upload", dependencies.uploadVoice, onStage);
  await stage("dispatch_ready_outbound", dependencies.dispatchOutbound, onStage);
  await stage("voice_semantics", dependencies.recoverVoiceSemantics, onStage);
  await stage("proactive_semantics", dependencies.recoverProactiveSemantics, onStage);
}

async function stage(name: WhatsAppRecoveryStage, operation: () => Promise<unknown>, onStage: (stage: WhatsAppRecoveryStage | null) => void): Promise<void> { onStage(name); try { await operation(); onStage(null); } catch (error: unknown) { throw error; } }
