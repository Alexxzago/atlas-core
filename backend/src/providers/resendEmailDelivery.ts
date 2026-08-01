import type { CredentialEnrollmentDeliveryPort, EmailVerificationDeliveryPort, PasswordResetDeliveryPort, VerificationDeliveryOutcome } from "../identity/application/ports.js";
import type { InvitationDeliveryPort } from "../workspace/application/ports.js";
import { emailContent, emailDeliveryPurpose, type EmailDeliveryPurpose, type EmailDeliveryRequest } from "./emailDeliveryContent.js";

export interface ResendConfiguration { readonly apiKey: string; readonly from: string; readonly replyTo: string | null; }
interface ResendFailureLogEntry { readonly event: "email_delivery_failed"; readonly provider: "resend"; readonly purpose: EmailDeliveryPurpose; readonly outcome: Exclude<VerificationDeliveryOutcome, "accepted">; readonly httpStatus: number | null; readonly providerCode: string | null; readonly timestamp: string; }
type ResendFailureLogger = (entry: ResendFailureLogEntry) => void;

export function resendConfiguration(environment: NodeJS.ProcessEnv = process.env): ResendConfiguration {
  const apiKey = environment.RESEND_API_KEY?.trim(), from = environment.RESEND_FROM?.trim(), replyTo = environment.RESEND_REPLY_TO?.trim() || null;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and RESEND_FROM are required.");
  return { apiKey, from, replyTo };
}

function safeCode(value: unknown): string | null { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null; }
function status(value: number): number | null { return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null; }
function classifyHttp(value: number): Exclude<VerificationDeliveryOutcome, "accepted"> { if (value === 408 || value === 429 || value >= 500) return "temporary_failure"; if (value === 401 || value === 403 || value >= 400) return "permanent_failure"; return "uncertain"; }
function classifyNetwork(error: unknown): Exclude<VerificationDeliveryOutcome, "accepted"> { const code = error instanceof Error ? safeCode((error as Error & { cause?: { code?: unknown }; code?: unknown }).cause?.code ?? (error as Error & { code?: unknown }).code) : null; return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ESOCKET" || (error instanceof DOMException && error.name === "AbortError") ? "temporary_failure" : "uncertain"; }
async function providerCode(response: Response): Promise<string | null> { try { const body = await response.json() as { name?: unknown }; return safeCode(body.name); } catch { return null; } }

export class ResendEmailDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort, PasswordResetDeliveryPort, InvitationDeliveryPort {
  public constructor(private readonly configuration: ResendConfiguration, private readonly fetcher: typeof fetch = fetch, private readonly logFailure: ResendFailureLogger = (entry) => console.error(JSON.stringify(entry))) {}
  public async deliver(request: EmailDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    const content = emailContent(request);
    try {
      const response = await this.fetcher("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${this.configuration.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ from: this.configuration.from, to: request.recipient, ...(this.configuration.replyTo ? { reply_to: this.configuration.replyTo } : {}), ...content }) });
      if (response.ok) return "accepted";
      const outcome = classifyHttp(response.status), code = await providerCode(response); this.logFailure({ event: "email_delivery_failed", provider: "resend", purpose: emailDeliveryPurpose(request), outcome, httpStatus: status(response.status), providerCode: code, timestamp: new Date().toISOString() }); return outcome;
    } catch (error: unknown) {
      const outcome = classifyNetwork(error), code = error instanceof Error ? safeCode((error as Error & { cause?: { code?: unknown }; code?: unknown }).cause?.code ?? (error as Error & { code?: unknown }).code) : null;
      this.logFailure({ event: "email_delivery_failed", provider: "resend", purpose: emailDeliveryPurpose(request), outcome, httpStatus: null, providerCode: code, timestamp: new Date().toISOString() }); return outcome;
    }
  }
}
