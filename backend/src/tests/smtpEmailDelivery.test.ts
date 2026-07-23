import assert from "node:assert/strict";
import test from "node:test";
import { SmtpEmailDelivery, smtpConfiguration } from "../providers/smtpEmailDelivery.js";

class Transport {
  public messages: Array<{ from: string; to: string; replyTo: string; subject: string; text: string; html: string }> = [];
  public result: { accepted: string[]; rejected: string[] } = { accepted: ["recipient@example.com"], rejected: [] };
  public failure: unknown = null;
  public async sendMail(message: { from: string; to: string; replyTo: string; subject: string; text: string; html: string }): Promise<{ accepted: string[]; rejected: string[] }> {
    this.messages.push(message);
    if (this.failure) throw this.failure;
    return this.result;
  }
}

const configuration = { host: "smtp.example.com", port: 587, secure: false, user: "atlas", password: "password", from: "Atlas <no-reply@example.com>", replyTo: "support@example.com" };

test("SMTP delivery renders responsive HTML and text for verification, enrollment, and invitations", async () => {
  const transport = new Transport();
  const delivery = new SmtpEmailDelivery(configuration, transport);
  const expiresAt = "2026-07-30T12:00:00.000Z";
  assert.equal(await delivery.deliver({ recipient: "person@example.com" as never, locale: "es", verificationUrl: "https://atlas.test/identity/verify-email?proof=proof", expiresAt, workflowId: "evf_1" }), "accepted");
  assert.equal(await delivery.deliver({ recipient: "person@example.com" as never, locale: "en", enrollmentUrl: "https://atlas.test/enroll-credential?proof=proof", expiresAt, workflowId: "cen_1" }), "accepted");
  assert.equal(await delivery.deliver({ recipient: "person@example.com", workspaceName: "Example Workspace", role: "viewer", acceptanceUrl: "https://atlas.test/accept-invitation?proof=proof", expiresAt, invitationId: "inv_1" }), "accepted");
  assert.equal(transport.messages.length, 3);
  for (const message of transport.messages) { assert.ok(message.html.includes("viewport")); assert.ok(message.html.includes("<a href=")); assert.ok(message.text.includes("https://atlas.test/")); assert.equal(message.replyTo, "support@example.com"); }
});

test("SMTP delivery classifies rejection and transport failures without throwing to services", async () => {
  const transport = new Transport();
  const delivery = new SmtpEmailDelivery(configuration, transport);
  const request = { recipient: "person@example.com" as never, locale: "en" as const, verificationUrl: "https://atlas.test/identity/verify-email?proof=proof", expiresAt: "2026-07-30T12:00:00.000Z", workflowId: "evf_1" };
  transport.result = { accepted: [], rejected: ["person@example.com"] };
  assert.equal(await delivery.deliver(request), "permanent_failure");
  transport.failure = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  assert.equal(await delivery.deliver(request), "temporary_failure");
  transport.failure = Object.assign(new Error("auth"), { code: "EAUTH" });
  assert.equal(await delivery.deliver(request), "permanent_failure");
});

test("SMTP configuration validates all required deployment variables", () => {
  assert.deepEqual(smtpConfiguration({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USER: "atlas", SMTP_PASSWORD: "password", SMTP_FROM: "no-reply@example.com", SMTP_REPLY_TO: "support@example.com" }), { ...configuration, port: 465, secure: true, from: "no-reply@example.com" });
  assert.throws(() => smtpConfiguration({ SMTP_HOST: "smtp.example.com" }));
});
