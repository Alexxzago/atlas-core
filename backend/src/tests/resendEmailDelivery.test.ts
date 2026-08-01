import assert from "node:assert/strict";
import test from "node:test";
import { emailDeliveryMode } from "../providers/emailDeliveryMode.js";
import { ResendEmailDelivery, resendConfiguration } from "../providers/resendEmailDelivery.js";

const configuration = { apiKey: "resend-secret-key", from: "Atlas <no-reply@example.com>", replyTo: "support@example.com" };
const reset = { recipient: "person@example.com" as never, locale: "en" as const, resetUrl: "https://atlas.test/reset-password?proof=proof-value", expiresAt: "2026-07-30T12:00:00.000Z", workflowId: "evf_1" };
const verification = { recipient: "person@example.com" as never, locale: "es" as const, verificationUrl: "https://atlas.test/identity/verify-email?proof=proof-value", expiresAt: "2026-07-30T12:00:00.000Z", workflowId: "evf_1" };

function delivery(fetcher: typeof fetch, entries: unknown[] = []): ResendEmailDelivery { return new ResendEmailDelivery(configuration, fetcher, (entry) => entries.push(entry)); }

test("Resend sends the shared password-reset content through HTTPS", async () => {
  let request: RequestInit | undefined;
  const result = await delivery(async (_url, init) => { request = init; return new Response(JSON.stringify({ id: "email-id" }), { status: 200, headers: { "content-type": "application/json" } }); }).deliver(reset);
  assert.equal(result, "accepted");
  const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
  assert.equal(body.from, configuration.from); assert.equal(body.to, reset.recipient); assert.equal(body.reply_to, configuration.replyTo); assert.equal(String(body.text).includes(reset.resetUrl), true); assert.equal(String(body.html).includes(reset.resetUrl), true);
  assert.equal((request?.headers as Record<string, string>).authorization, `Bearer ${configuration.apiKey}`);
});

test("Resend preserves email-verification delivery and classifies HTTP failures", async () => {
  const entries: unknown[] = [];
  assert.equal(await delivery(async () => new Response(JSON.stringify({ id: "email-id" }), { status: 201, headers: { "content-type": "application/json" } }), entries).deliver(verification), "accepted");
  assert.deepEqual(entries, []);
  assert.equal(await delivery(async () => new Response(JSON.stringify({ name: "rate_limit" }), { status: 429, headers: { "content-type": "application/json" } }), entries).deliver(reset), "temporary_failure");
  assert.equal(await delivery(async () => new Response(JSON.stringify({ name: "server_error" }), { status: 503, headers: { "content-type": "application/json" } }), entries).deliver(reset), "temporary_failure");
  assert.equal(await delivery(async () => new Response(JSON.stringify({ name: "invalid_api_key" }), { status: 401, headers: { "content-type": "application/json" } }), entries).deliver(reset), "permanent_failure");
  assert.equal(await delivery(async () => new Response(JSON.stringify({ name: "invalid_from" }), { status: 422, headers: { "content-type": "application/json" } }), entries).deliver(reset), "permanent_failure");
  assert.ok(entries[0]);
  assert.equal((entries[0] as unknown as { provider: string }).provider, "resend");
  assert.partialDeepStrictEqual(entries[0], { event: "email_delivery_failed", provider: "resend", purpose: "password_reset", outcome: "temporary_failure", httpStatus: 429, providerCode: "rate_limit" });
});

test("Resend classifies network timeouts and logs no sensitive delivery data", async () => {
  const entries: unknown[] = [], secret = "resend-secret-key";
  const outcome = await delivery(async () => { throw Object.assign(new Error(`recipient ${reset.recipient} ${reset.resetUrl} ${secret}`), { cause: { code: "ETIMEDOUT" }, stack: "raw-stack" }); }, entries).deliver(reset);
  assert.equal(outcome, "temporary_failure");
  const rendered = JSON.stringify(entries);
  for (const sensitive of [reset.recipient, "proof-value", secret, "raw-stack", "recipient "]) assert.equal(rendered.includes(sensitive), false);
  assert.partialDeepStrictEqual(entries[0], { provider: "resend", purpose: "password_reset", outcome: "temporary_failure", httpStatus: null, providerCode: "ETIMEDOUT" });
});

test("Resend configuration and delivery-mode selection fail closed", () => {
  assert.deepEqual(resendConfiguration({ RESEND_API_KEY: "key", RESEND_FROM: "no-reply@example.com" }), { apiKey: "key", from: "no-reply@example.com", replyTo: null });
  assert.throws(() => resendConfiguration({ RESEND_FROM: "no-reply@example.com" }));
  assert.equal(emailDeliveryMode(undefined, false), "development"); assert.equal(emailDeliveryMode(undefined, true), "smtp"); assert.equal(emailDeliveryMode("resend", true), "resend"); assert.equal(emailDeliveryMode("smtp", true), "smtp"); assert.throws(() => emailDeliveryMode("unsupported", true));
});
