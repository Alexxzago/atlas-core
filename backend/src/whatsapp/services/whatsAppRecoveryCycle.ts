import type { WhatsAppRecoveryStage, WhatsAppResumeSubstage } from "../../config/runtimeReadiness.js";

export interface WhatsAppRecoveryCycleDependencies {
  executeProactive(): Promise<number|void>; recoverInboundMedia(onStage?: (stage: WhatsAppRecoveryStage | null) => void): Promise<number|void>; recoverAtlasMedia(): Promise<number|void>; transcribeVoice?(): Promise<number|void>; resumeIncomplete(onSubstage?: (substage: WhatsAppResumeSubstage) => void): Promise<number|void>; synthesizeVoice?(): Promise<number|void>; uploadVoice?(): Promise<number|void>; dispatchOutbound(): Promise<number|void>; recoverVoiceSemantics(): Promise<number|void>; recoverProactiveSemantics(): Promise<number|void>;
}

/** Keeps non-media recovery active when production intentionally has no media capability. */
export async function runWhatsAppRecoveryCycle(mediaAvailable: boolean, dependencies: WhatsAppRecoveryCycleDependencies, onStage: (stage: WhatsAppRecoveryStage | null) => void = () => undefined, onSubstage: (substage: WhatsAppResumeSubstage) => void = () => undefined): Promise<number> {
  let count=await stage("proactive_execution", dependencies.executeProactive, onStage);
  if (mediaAvailable) count+=await stage("recover_inbound_media", () => dependencies.recoverInboundMedia(onStage), onStage);
  if (mediaAvailable) count+=await stage("recover_durable_media", () => dependencies.recoverAtlasMedia(), onStage);
  if (mediaAvailable && dependencies.transcribeVoice) count+=await stage("voice_transcription", dependencies.transcribeVoice, onStage); count+=await stage("resume_incomplete_executions", () => dependencies.resumeIncomplete(onSubstage), onStage); if (mediaAvailable && dependencies.synthesizeVoice) count+=await stage("voice_synthesis", dependencies.synthesizeVoice, onStage); if (mediaAvailable && dependencies.uploadVoice) count+=await stage("voice_upload", dependencies.uploadVoice, onStage); count+=await stage("dispatch_ready_outbound", dependencies.dispatchOutbound, onStage); count+=await stage("voice_semantics", dependencies.recoverVoiceSemantics, onStage); count+=await stage("proactive_semantics", dependencies.recoverProactiveSemantics, onStage); return count;
}

async function stage(name: WhatsAppRecoveryStage, operation: () => Promise<number|void>, onStage: (stage: WhatsAppRecoveryStage | null) => void): Promise<number> { onStage(name); const result=await operation(); onStage(null); return result??0; }
