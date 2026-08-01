import type { CredentialEnrollmentDeliveryRequest, EmailVerificationDeliveryRequest, PasswordResetDeliveryRequest } from "../identity/application/ports.js";
import type { InvitationDeliveryRequest } from "../workspace/application/ports.js";

export type EmailDeliveryRequest = EmailVerificationDeliveryRequest | CredentialEnrollmentDeliveryRequest | PasswordResetDeliveryRequest | InvitationDeliveryRequest;
export type EmailDeliveryPurpose = "email_verification" | "password_reset" | "credential_enrollment" | "invitation";
export interface EmailContent { readonly subject: string; readonly text: string; readonly html: string; }

function actionEmail(locale: "en" | "es", title: string, message: string, action: string, url: string, expiresAt: string): EmailContent {
  const expiry = new Date(expiresAt).toLocaleString(locale === "es" ? "es-ES" : "en-US", { timeZone: "UTC", timeZoneName: "short" });
  const text = `${title}\n\n${message}\n\n${action}: ${url}\n\n${locale === "es" ? "Este enlace vence" : "This link expires"}: ${expiry}`;
  const html = `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17212b"><main style="max-width:560px;margin:24px auto;padding:32px;background:#ffffff;border-radius:12px"><h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(title)}</h1><p style="line-height:1.5">${escapeHtml(message)}</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#155eef;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(action)}</a></p><p style="font-size:13px;line-height:1.5;color:#52606d">${locale === "es" ? "Este enlace vence" : "This link expires"}: ${escapeHtml(expiry)}</p></main></body></html>`;
  return { subject: title, text, html };
}

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character); }

export function emailDeliveryPurpose(request: EmailDeliveryRequest): EmailDeliveryPurpose { return "verificationUrl" in request ? "email_verification" : "enrollmentUrl" in request ? "credential_enrollment" : "resetUrl" in request ? "password_reset" : "invitation"; }
export function emailContent(request: EmailDeliveryRequest): EmailContent {
  if ("verificationUrl" in request) { const es = request.locale === "es"; return actionEmail(request.locale, es ? "Verifica tu correo de Atlas" : "Verify your Atlas email", es ? "Confirma que controlas esta direccion de correo para activar tu cuenta." : "Confirm that you control this email address to activate your account.", es ? "Verificar correo" : "Verify email", request.verificationUrl, request.expiresAt); }
  if ("enrollmentUrl" in request) { const es = request.locale === "es"; return actionEmail(request.locale, es ? "Crea tu contrasena de Atlas" : "Create your Atlas password", es ? "Usa este enlace para crear tu contrasena." : "Use this link to create your password.", es ? "Crear contrasena" : "Create password", request.enrollmentUrl, request.expiresAt); }
  if ("resetUrl" in request) { const es = request.locale === "es"; return actionEmail(request.locale, es ? "Restablece tu contrasena de Atlas" : "Reset your Atlas password", es ? "Usa este enlace una sola vez para restablecer tu contrasena." : "Use this one-time link to reset your password.", es ? "Restablecer contrasena" : "Reset password", request.resetUrl, request.expiresAt); }
  return actionEmail("en", "You are invited to Atlas", `You were invited to join ${request.workspaceName} as ${request.role}.`, "Accept invitation", request.acceptanceUrl, request.expiresAt);
}
