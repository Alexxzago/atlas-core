import type { WhatsAppConnectionProviderValidationPort, WhatsAppConnectionProviderValidationResult } from "../application/ports.js";

export interface WhatsAppCloudApiPort { sendText(phoneNumberId: string, recipientWaId: string, text: string): Promise<string>; }
export class WhatsAppCloudApiError extends Error {
  public constructor(readonly status: number | null, readonly retryAfterMilliseconds: number | null) { super("WhatsApp delivery failed."); }
}
export class WhatsAppCloudApiProvider implements WhatsAppCloudApiPort, WhatsAppConnectionProviderValidationPort {
  public constructor(private readonly accessToken: string, private readonly graphVersion: string, private readonly fetcher: typeof fetch = fetch) {}
  public async sendText(phoneNumberId: string, recipientWaId: string, text: string): Promise<string> { try { const response=await this.fetcher(`https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,{method:"POST",headers:{authorization:`Bearer ${this.accessToken}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:recipientWaId,type:"text",text:{body:text}})}); if(!response.ok)throw new WhatsAppCloudApiError(response.status,retryAfterMilliseconds(response.headers.get("retry-after"))); const body=await response.json() as {messages?:Array<{id?:unknown}>}; const id=body.messages?.[0]?.id; if(typeof id!=="string"||!id)throw new WhatsAppCloudApiError(null,null); return id; } catch(error:unknown) { if(error instanceof WhatsAppCloudApiError)throw error; throw new WhatsAppCloudApiError(null,null); } }
  public async validateConnection(input: { accessToken: string; phoneNumberId: string; whatsappBusinessAccountId: string }): Promise<WhatsAppConnectionProviderValidationResult> {
    try {
      const response = await this.fetcher(`https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(input.phoneNumberId)}?fields=id,whatsapp_business_account`, { headers: { authorization: `Bearer ${input.accessToken}` } });
      if (response.status === 401 || response.status === 403) return { status: "invalid", failureCode: "credentials_invalid" };
      if (!response.ok) return { status: "invalid", failureCode: "provider_unavailable" };
      const body = await response.json() as { id?: unknown; whatsapp_business_account?: { id?: unknown } };
      return body.id === input.phoneNumberId && body.whatsapp_business_account?.id === input.whatsappBusinessAccountId ? { status: "valid" } : { status: "invalid", failureCode: "provider_identity_mismatch" };
    } catch { return { status: "invalid", failureCode: "provider_unavailable" }; }
  }
}

function retryAfterMilliseconds(value: string | null): number | null { if (!value) return null; const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000); const at = Date.parse(value); return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null; }
