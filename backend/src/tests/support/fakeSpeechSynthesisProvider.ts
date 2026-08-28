import type { SpeechSynthesisPort, SpeechSynthesisResult } from "../../whatsapp/application/speechSynthesisPort.js";

export class FakeSpeechSynthesisProvider implements SpeechSynthesisPort {
  public constructor(private readonly result:SpeechSynthesisResult) {}
  public async synthesize(input:Parameters<SpeechSynthesisPort["synthesize"]>[0]):Promise<SpeechSynthesisResult>{return input.signal.aborted?{kind:"retryable",safeFailureCategory:"timeout"}:this.result;}
}
