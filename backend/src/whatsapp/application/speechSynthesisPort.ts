export interface SpeechSynthesisInput { readonly text:string; readonly signal:AbortSignal; }
export type SpeechSynthesisResult =
  | { readonly kind:"completed"; readonly audio:Uint8Array; readonly mimeType:"audio/ogg" }
  | { readonly kind:"retryable"|"failed"; readonly safeFailureCategory:string };
export interface SpeechSynthesisPort { synthesize(input:SpeechSynthesisInput):Promise<SpeechSynthesisResult>; }
