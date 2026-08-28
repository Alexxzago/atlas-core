export interface SpeechTranscriptionInput {
  readonly audio: Uint8Array;
  readonly mimeType: "audio/ogg" | "audio/wav";
  readonly durationMilliseconds: number;
  readonly signal: AbortSignal;
}

export type SpeechTranscriptionResult =
  | { readonly kind: "completed"; readonly transcript: string; readonly languageTag: string | null }
  | { readonly kind: "retryable" | "failed"; readonly safeFailureCategory: string };

export interface SpeechTranscriptionPort {
  transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult>;
}
