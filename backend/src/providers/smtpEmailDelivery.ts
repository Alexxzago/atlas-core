import nodemailer, { type Transporter } from "nodemailer";
import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest, EmailVerificationDeliveryPort, EmailVerificationDeliveryRequest, PasswordResetDeliveryPort, PasswordResetDeliveryRequest, VerificationDeliveryOutcome } from "../identity/application/ports.js";
import type { InvitationDeliveryPort, InvitationDeliveryRequest } from "../workspace/application/ports.js";
import { emailContent, emailDeliveryPurpose, type EmailDeliveryPurpose, type EmailDeliveryRequest } from "./emailDeliveryContent.js";

export interface SmtpConfiguration {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly from: string;
  readonly replyTo: string;
}

interface SmtpTransport {
  sendMail(message: { from: string; to: string; replyTo: string; subject: string; text: string; html: string }): Promise<{ accepted: string[]; rejected: string[] }>;
}

interface SmtpFailureLogEntry { readonly event: "smtp_delivery_failed"; readonly purpose: EmailDeliveryPurpose; readonly outcome: Exclude<VerificationDeliveryOutcome, "accepted">; readonly errorCode: string | null; readonly responseCode: number | null; readonly command: string | null; readonly host: string; readonly port: number; readonly secure: boolean; readonly timestamp: string; }
type SmtpFailureLogger = (entry: SmtpFailureLogEntry) => void;

export function smtpConfiguration(environment: NodeJS.ProcessEnv = process.env): SmtpConfiguration {
  const host = environment.SMTP_HOST?.trim();
  const port = Number(environment.SMTP_PORT);
  const secureValue = environment.SMTP_SECURE?.trim().toLowerCase();
  const user = environment.SMTP_USER?.trim();
  const password = environment.SMTP_PASSWORD;
  const from = environment.SMTP_FROM?.trim();
  const replyTo = environment.SMTP_REPLY_TO?.trim();
  if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65_535 || (secureValue !== "true" && secureValue !== "false")
    || !user || !password || !from || !replyTo) {
    throw new Error("SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, and SMTP_REPLY_TO are required.");
  }
  return { host, port, secure: secureValue === "true", user, password, from, replyTo };
}

function classify(error: unknown): VerificationDeliveryOutcome {
  if (!(error instanceof Error)) return "uncertain";
  const details = error as Error & { code?: string; responseCode?: number };
  if (details.responseCode !== undefined) return details.responseCode >= 500 ? "permanent_failure" : "temporary_failure";
  if (["EAUTH", "EENVELOPE"].includes(details.code ?? "")) return "permanent_failure";
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ESOCKET"].includes(details.code ?? "")) return "temporary_failure";
  return "uncertain";
}

function safeCode(value: unknown): string | null { return typeof value === "string" && /^[A-Z_]{1,64}$/.test(value) ? value : null; }
function safeCommand(value: unknown): string | null { return typeof value === "string" && /^[A-Z]{1,16}$/.test(value) ? value : null; }
function safeResponseCode(value: unknown): number | null { return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 999 ? value : null; }

export class SmtpEmailDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort, PasswordResetDeliveryPort, InvitationDeliveryPort {
  private readonly transport: SmtpTransport;

  public constructor(private readonly configuration: SmtpConfiguration, transport?: SmtpTransport, private readonly logFailure: SmtpFailureLogger = (entry) => console.error(JSON.stringify(entry))) {
    this.transport = transport ?? nodemailer.createTransport({
      host: configuration.host, port: configuration.port, secure: configuration.secure,
      auth: { user: configuration.user, pass: configuration.password }, connectionTimeout: 10_000, socketTimeout: 20_000,
    }) as Transporter as unknown as SmtpTransport;
  }

  public async deliver(request: EmailDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    const content = emailContent(request);
    try {
      const result = await this.transport.sendMail({ from: this.configuration.from, to: request.recipient, replyTo: this.configuration.replyTo, ...content });
      return result.accepted.length > 0 ? "accepted" : result.rejected.length > 0 ? "permanent_failure" : "uncertain";
    } catch (error: unknown) {
      const outcome = classify(error) as Exclude<VerificationDeliveryOutcome, "accepted">, details: { code?: unknown; responseCode?: unknown; command?: unknown } = error instanceof Error ? error as Error & { code?: unknown; responseCode?: unknown; command?: unknown } : {};
      this.logFailure({ event: "smtp_delivery_failed", purpose: emailDeliveryPurpose(request), outcome, errorCode: safeCode(details.code), responseCode: safeResponseCode(details.responseCode), command: safeCommand(details.command), host: this.configuration.host, port: this.configuration.port, secure: this.configuration.secure, timestamp: new Date().toISOString() });
      return outcome;
    }
  }

}
