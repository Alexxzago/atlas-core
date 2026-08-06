import assert from "node:assert/strict";
import test from "node:test";
import { emailDeliveryMode } from "../providers/emailDeliveryMode.js";
import { GoogleAppsScriptEmailDelivery, googleAppsScriptConfiguration } from "../providers/googleAppsScriptEmailDelivery.js";

const configuration = { endpoint: "https://script.example.com/exec", token: "secret-token", timeoutMs: 4_000 };
const reset = { recipient: "person@example.com" as never, locale: "en" as const, resetUrl: "https://atlas.test/reset-password?proof=proof-value", expiresAt: "2026-07-30T12:00:00.000Z", workflowId: "evf_1" };
const verification = { recipient: "person@example.com" as never, locale: "es" as const, verificationUrl: "https://atlas.test/identity/verify-email?proof=proof-value", expiresAt: "2026-07-30T12:00:00.000Z", workflowId: "evf_1" };

function delivery(fetcher: typeof fetch, entries: unknown[] = [], timeoutMs = 4_000): GoogleAppsScriptEmailDelivery {
  return new GoogleAppsScriptEmailDelivery({ endpoint: configuration.endpoint, token: configuration.token, timeoutMs }, fetcher, (entry) => entries.push(entry));
}

test("Google Apps Script sends the shared content to the configured endpoint and includes the auth header", async () => {
  let request: RequestInit | undefined;
  const result = await delivery(async (_url, init) => { request = init; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }).deliver(reset);
  assert.equal(result, "accepted");
  const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
  assert.equal(body.to, reset.recipient);
  assert.equal(body.subject, "Reset your Atlas password");
  assert.equal(String(body.text).includes(reset.resetUrl), true);
  assert.equal(String(body.html).includes(reset.resetUrl), true);
  assert.equal((request?.headers as Record<string, string>).authorization, `Bearer ${configuration.token}`);
});

test("Google Apps Script omits the auth header when no token is configured", async () => {
  let request: RequestInit | undefined;
  const result = await new GoogleAppsScriptEmailDelivery({ endpoint: configuration.endpoint, token: null, timeoutMs: 4_000 }, async (_url, init) => { request = init; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }).deliver(verification);
  assert.equal(result, "accepted");
  assert.equal((request?.headers as Record<string, string>).authorization, undefined);
});

test("Google Apps Script classifies HTTP failures and logs sanitized diagnostics", async () => {
  const entries: unknown[] = [];
  const outcome = await delivery(async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401, headers: { "content-type": "application/json" } }), entries).deliver(reset);
  assert.equal(outcome, "permanent_failure");
  assert.equal((entries[0] as { provider: string }).provider, "google_apps_script");
  assert.partialDeepStrictEqual(entries[0], { event: "email_delivery_failed", provider: "google_apps_script", purpose: "password_reset", outcome: "permanent_failure", httpStatus: 401, providerCode: null });
});

test("Google Apps Script treats network failures and timeouts as transient and hides secret values", async () => {
  const entries: unknown[] = [];
  const secret = "secret-token";
  const outcome = await delivery(async () => { throw Object.assign(new Error(`recipient ${reset.recipient} ${reset.resetUrl} ${secret}`), { cause: { code: "ETIMEDOUT" }, stack: "raw-stack" }); }, entries).deliver(reset);
  assert.equal(outcome, "temporary_failure");
  const rendered = JSON.stringify(entries);
  for (const sensitive of [reset.recipient, "proof-value", secret, "raw-stack", "recipient "]) assert.equal(rendered.includes(sensitive), false);
  assert.partialDeepStrictEqual(entries[0], { event: "email_delivery_failed", provider: "google_apps_script", purpose: "password_reset", outcome: "temporary_failure", httpStatus: null, providerCode: "ETIMEDOUT" });
});

test("Google Apps Script retries only transient errors", async () => {
  let attempts = 0;
  const entries: unknown[] = [];
  const outcome = await delivery(async () => { attempts += 1; if (attempts === 1) { throw Object.assign(new Error("temporary"), { cause: { code: "ECONNRESET" } }); } return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }, entries).deliver(reset);
  assert.equal(outcome, "accepted");
  assert.equal(attempts, 2);
  const permanent = await delivery(async () => new Response(JSON.stringify({ ok: false }), { status: 400, headers: { "content-type": "application/json" } }), []).deliver(verification);
  assert.equal(permanent, "permanent_failure");
});

test("Google Apps Script configuration validates the provider-specific environment variables", () => {
  assert.deepEqual(googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_URL: "https://script.example.com/exec", GOOGLE_APPS_SCRIPT_TOKEN: "token", EMAIL_TIMEOUT: "4000" }), { endpoint: "https://script.example.com/exec", token: "token", timeoutMs: 4000 });
  assert.throws(() => googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_TOKEN: "token" }));
  assert.throws(() => googleAppsScriptConfiguration({ EMAIL_TIMEOUT: "0" }));
  assert.throws(() => googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_URL: "http://script.example.com/exec", EMAIL_TIMEOUT: "4000" }));
});

test("Google Apps Script accepts 2xx responses with empty or non-JSON bodies", async () => {
  assert.equal(await delivery(async () => new Response("", { status: 200 } )).deliver(reset), "accepted");
  assert.equal(await delivery(async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })).deliver(verification), "accepted");
});

test("Google Apps Script is selected through the shared delivery mode selector", () => {
  assert.equal(emailDeliveryMode("google_apps_script", true), "google_apps_script");
  assert.equal(emailDeliveryMode("resend", true), "resend");
  assert.equal(emailDeliveryMode("smtp", true), "smtp");
  assert.equal(emailDeliveryMode(undefined, true), "smtp");
  assert.equal(emailDeliveryMode(undefined, false), "development");
});
