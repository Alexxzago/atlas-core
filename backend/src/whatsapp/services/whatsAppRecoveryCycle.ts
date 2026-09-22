export interface WhatsAppRecoveryCycleDependencies {
  executeProactive(): Promise<void>;
  recoverInboundMedia(): Promise<unknown>;
  recoverAtlasMedia(): Promise<unknown>;
  transcribeVoice?(): Promise<unknown>;
  resumeIncomplete(): Promise<unknown>;
  synthesizeVoice?(): Promise<unknown>;
  uploadVoice?(): Promise<unknown>;
  dispatchOutbound(): Promise<void>;
  recoverVoiceSemantics(): Promise<unknown>;
  recoverProactiveSemantics(): Promise<unknown>;
}

/** Keeps non-media recovery active when production intentionally has no media capability. */
export async function runWhatsAppRecoveryCycle(mediaAvailable: boolean, dependencies: WhatsAppRecoveryCycleDependencies): Promise<void> {
  await dependencies.executeProactive();
  if (mediaAvailable) await dependencies.recoverInboundMedia();
  if (mediaAvailable) await dependencies.recoverAtlasMedia();
  if (mediaAvailable) await dependencies.transcribeVoice?.();
  await dependencies.resumeIncomplete();
  if (mediaAvailable) await dependencies.synthesizeVoice?.();
  if (mediaAvailable) await dependencies.uploadVoice?.();
  await dependencies.dispatchOutbound();
  await dependencies.recoverVoiceSemantics();
  await dependencies.recoverProactiveSemantics();
}
