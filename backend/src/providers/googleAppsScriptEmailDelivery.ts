import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest, EmailVerificationDeliveryPort, EmailVerificationDeliveryRequest, PasswordResetDeliveryPort, PasswordResetDeliveryRequest, VerificationDeliveryOutcome } from "../identity/application/ports.js";
import type { InvitationDeliveryPort, InvitationDeliveryRequest } from "../workspace/application/ports.js";
import { emailContent, emailDeliveryPurpose, type EmailDeliveryPurpose, type EmailDeliveryRequest } from "./emailDeliveryContent.js";

export interface GoogleAppsScriptConfiguration {
  readonly endpoint: string;
  readonly token: string | null;
  readonly timeoutMs: number;
}

interface GoogleAppsScriptFailureLogEntry {
  readonly event: "email_delivery_failed";
  readonly provider: "google_apps_script";
  readonly purpose: EmailDeliveryPurpose;
  readonly outcome: Exclude<VerificationDeliveryOutcome, "accepted">;
  readonly httpStatus: number | null;
  readonly providerCode: string | null;
  readonly timestamp: string;
}

type GoogleAppsScriptFailureLogger = (entry: GoogleAppsScriptFailureLogEntry) => void;

export function googleAppsScriptConfiguration(environment: NodeJS.ProcessEnv = process.env): GoogleAppsScriptConfiguration {
  const endpointValue = environment.GOOGLE_APPS_SCRIPT_URL?.trim();
  const timeoutValue = Number(environment.EMAIL_TIMEOUT ?? 10_000);
  const token = environment.GOOGLE_APPS_SCRIPT_TOKEN?.trim() || null;
  if (!endpointValue) throw new Error("GOOGLE_APPS_SCRIPT_URL is required when EMAIL_PROVIDER is google_apps_script.");
  let endpoint: string;
  try {
    const parsed = new URL(endpointValue);
    if (parsed.protocol !== "https:") throw new Error("GOOGLE_APPS_SCRIPT_URL must use https.");
    endpoint = parsed.toString();
  } catch {
    throw new Error("GOOGLE_APPS_SCRIPT_URL must be a valid absolute HTTPS URL.");
  }
  if (!Number.isSafeInteger(timeoutValue) || timeoutValue < 1 || timeoutValue > 60_000) throw new Error("EMAIL_TIMEOUT must be a positive integer between 1 and 60000.");
  return { endpoint, token, timeoutMs: timeoutValue };
}

function safeCode(value: unknown): string | null { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null; }
function status(value: number): number | null { return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null; }
function classifyHttp(value: number): Exclude<VerificationDeliveryOutcome, "accepted"> { if (value === 408 || value === 429 || value >= 500) return "temporary_failure"; if (value === 401 || value === 403 || value >= 400) return "permanent_failure"; return "uncertain"; }
function classifyNetwork(error: unknown): Exclude<VerificationDeliveryOutcome, "accepted"> { const code = error instanceof Error ? safeCode((error as Error & { cause?: { code?: unknown }; code?: unknown }).cause?.code ?? (error as Error & { code?: unknown }).code) : null; return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ESOCKET" || (error instanceof DOMException && error.name === "AbortError") ? "temporary_failure" : "uncertain"; }

export class GoogleAppsScriptEmailDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort, PasswordResetDeliveryPort, InvitationDeliveryPort {
  public constructor(private readonly configuration: GoogleAppsScriptConfiguration, private readonly fetcher: typeof fetch = fetch, private readonly logFailure: GoogleAppsScriptFailureLogger = (entry) => console.error(JSON.stringify(entry))) {}

  public async deliver(request: EmailDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    const content = emailContent(request);
    const payload = { to: request.recipient, subject: content.subject, html: content.html, text: content.text };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.configuration.token) headers.authorization = `Bearer ${this.configuration.token}`;
    const init: RequestInit = { method: "POST", headers, body: JSON.stringify(payload) };
    let lastOutcome: Exclude<VerificationDeliveryOutcome, "accepted"> | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.configuration.timeoutMs);
      try {
        const response = await this.fetcher(this.configuration.endpoint, { ...init, signal: controller.signal });
        if (response.ok) return "accepted";
        const outcome = classifyHttp(response.status);
        if (attempt === 1 && (outcome === "temporary_failure")) {
          lastOutcome = outcome;
          continue;
        }
        lastOutcome = outcome;
        this.logFailure({ event: "email_delivery_failed", provider: "google_apps_script", purpose: emailDeliveryPurpose(request), outcome, httpStatus: status(response.status), providerCode: null, timestamp: new Date().toISOString() });
        return outcome;
      } catch (error: unknown) {
        const outcome = classifyNetwork(error);
        const code = error instanceof Error ? safeCode((error as Error & { cause?: { code?: unknown }; code?: unknown }).cause?.code ?? (error as Error & { code?: unknown }).code) : null;
        if (attempt === 1 && outcome === "temporary_failure") {
          lastOutcome = outcome;
          continue;
        }
        lastOutcome = outcome;
        this.logFailure({ event: "email_delivery_failed", provider: "google_apps_script", purpose: emailDeliveryPurpose(request), outcome, httpStatus: null, providerCode: code, timestamp: new Date().toISOString() });
        return outcome;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastOutcome) {
      return lastOutcome;
    }
    return "uncertain";
  }
}
