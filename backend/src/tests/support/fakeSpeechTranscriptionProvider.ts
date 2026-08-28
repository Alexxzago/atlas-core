import type { SpeechTranscriptionPort, SpeechTranscriptionResult } from "../../whatsapp/application/speechTranscriptionPort.js";

export class FakeSpeechTranscriptionProvider implements SpeechTranscriptionPort {
  public constructor(private readonly result: SpeechTranscriptionResult) {}

  public async transcribe(input: Parameters<SpeechTranscriptionPort["transcribe"]>[0]): Promise<SpeechTranscriptionResult> {
    return input.signal.aborted ? { kind: "retryable", safeFailureCategory: "timeout" } : this.result;
  }
}
