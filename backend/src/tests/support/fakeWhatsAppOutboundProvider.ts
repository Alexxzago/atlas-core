import type { WhatsAppCloudApiPort } from "../../whatsapp/providers/WhatsAppCloudApiProvider.js";

export class FakeWhatsAppOutboundProvider implements WhatsAppCloudApiPort {
  public readonly calls: Array<{ readonly kind: "text" | "audio"; readonly providerMediaId: string | null }> = [];
  public onCall: (() => void) | undefined;
  private readonly outcomes: Array<Promise<string>> = [];

  public enqueueAccepted(externalMessageId: string): void { this.outcomes.push(Promise.resolve(externalMessageId)); }
  public enqueueFailed(error: Error): void { this.outcomes.push(Promise.reject(error)); }
  public enqueueDelayed(): { readonly resolve: (externalMessageId: string) => void } {
    let resolve!: (externalMessageId: string) => void;
    this.outcomes.push(new Promise<string>((done) => { resolve = done; }));
    return { resolve };
  }
  public async sendText(_phoneNumberId: string, _recipientWaId: string, _text: string): Promise<string> { this.onCall?.(); this.calls.push({ kind: "text", providerMediaId: null }); return this.next(); }
  public async sendAudio(_phoneNumberId: string, _recipientWaId: string, providerMediaId: string): Promise<string> { this.onCall?.(); this.calls.push({ kind: "audio", providerMediaId }); return this.next(); }
  private async next(): Promise<string> { const outcome = this.outcomes.shift(); if (!outcome) throw new Error("Fake outbound outcome is missing."); return outcome; }
}
