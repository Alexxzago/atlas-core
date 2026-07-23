import nodemailer, { type Transporter } from "nodemailer";
import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest, EmailVerificationDeliveryPort, EmailVerificationDeliveryRequest, VerificationDeliveryOutcome } from "../identity/application/ports.js";
import type { InvitationDeliveryPort, InvitationDeliveryRequest } from "../workspace/application/ports.js";

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

interface EmailContent { readonly subject: string; readonly text: string; readonly html: string; }

function actionEmail(locale: "en" | "es", title: string, message: string, action: string, url: string, expiresAt: string): EmailContent {
  const expiry = new Date(expiresAt).toLocaleString(locale === "es" ? "es-ES" : "en-US", { timeZone: "UTC", timeZoneName: "short" });
  const text = `${title}\n\n${message}\n\n${action}: ${url}\n\n${locale === "es" ? "Este enlace vence" : "This link expires"}: ${expiry}`;
  const html = `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17212b"><main style="max-width:560px;margin:24px auto;padding:32px;background:#ffffff;border-radius:12px"><h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(title)}</h1><p style="line-height:1.5">${escapeHtml(message)}</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#155eef;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(action)}</a></p><p style="font-size:13px;line-height:1.5;color:#52606d">${locale === "es" ? "Este enlace vence" : "This link expires"}: ${escapeHtml(expiry)}</p></main></body></html>`;
  return { subject: title, text, html };
}

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character); }

function classify(error: unknown): VerificationDeliveryOutcome {
  if (!(error instanceof Error)) return "uncertain";
  const details = error as Error & { code?: string; responseCode?: number };
  if (details.responseCode !== undefined) return details.responseCode >= 500 ? "permanent_failure" : "temporary_failure";
  if (["EAUTH", "EENVELOPE"].includes(details.code ?? "")) return "permanent_failure";
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ESOCKET"].includes(details.code ?? "")) return "temporary_failure";
  return "uncertain";
}

export class SmtpEmailDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort, InvitationDeliveryPort {
  private readonly transport: SmtpTransport;

  public constructor(private readonly configuration: SmtpConfiguration, transport?: SmtpTransport) {
    this.transport = transport ?? nodemailer.createTransport({
      host: configuration.host, port: configuration.port, secure: configuration.secure,
      auth: { user: configuration.user, pass: configuration.password }, connectionTimeout: 10_000, socketTimeout: 20_000,
    }) as Transporter as unknown as SmtpTransport;
  }

  public async deliver(request: EmailVerificationDeliveryRequest | CredentialEnrollmentDeliveryRequest | InvitationDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    const content = this.content(request);
    try {
      const result = await this.transport.sendMail({ from: this.configuration.from, to: request.recipient, replyTo: this.configuration.replyTo, ...content });
      return result.accepted.length > 0 ? "accepted" : result.rejected.length > 0 ? "permanent_failure" : "uncertain";
    } catch (error: unknown) {
      return classify(error);
    }
  }

  private content(request: EmailVerificationDeliveryRequest | CredentialEnrollmentDeliveryRequest | InvitationDeliveryRequest): EmailContent {
    if ("verificationUrl" in request) {
      const es = request.locale === "es";
      return actionEmail(request.locale, es ? "Verifica tu correo de Atlas" : "Verify your Atlas email", es ? "Confirma que controlas esta direccion de correo para activar tu cuenta." : "Confirm that you control this email address to activate your account.", es ? "Verificar correo" : "Verify email", request.verificationUrl, request.expiresAt);
    }
    if ("enrollmentUrl" in request) {
      const es = request.locale === "es";
      return actionEmail(request.locale, es ? "Crea tu contrasena de Atlas" : "Create your Atlas password", es ? "Usa este enlace para crear tu contrasena." : "Use this link to create your password.", es ? "Crear contrasena" : "Create password", request.enrollmentUrl, request.expiresAt);
    }
    return actionEmail("en", "You are invited to Atlas", `You were invited to join ${request.workspaceName} as ${request.role}.`, "Accept invitation", request.acceptanceUrl, request.expiresAt);
  }
}
