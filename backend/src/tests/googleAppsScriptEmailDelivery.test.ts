import assert from "node:assert/strict";
import test from "node:test";
import { emailDeliveryMode } from "../providers/emailDeliveryMode.js";
import { GoogleAppsScriptEmailDelivery, googleAppsScriptConfiguration } from "../providers/googleAppsScriptEmailDelivery.js";

const configuration = { endpoint: "https://script.example.com/exec", token: "secret-token", timeoutMs: 4_000 };
const reset = { recipient: "person@example.com" as never, locale: "en" as const, resetUrl: "https://atlas.test/reset-password?proof=proof-value", expiresAt: "2026-07-30T12:00:00.000Z", workflowId: "evf_1" };
const verification = { recipient: "person@example.com" as never, locale: "es" as const, verificationUrl: "https://atlas.test/verify-email?proof=proof-value", expiresAt: "2026-07-30T12:00:00.000Z", workflowId: "evf_1" };

function delivery(fetcher: typeof fetch, entries: unknown[] = []): GoogleAppsScriptEmailDelivery {
  return new GoogleAppsScriptEmailDelivery({ endpoint: configuration.endpoint, token: configuration.token, timeoutMs: configuration.timeoutMs }, fetcher, (entry) => entries.push(entry));
}

test("Google Apps Script sends the web-app contract payload and omits Authorization", async () => {
  let request: RequestInit | undefined;
  const result = await delivery(async (_url, init) => { request = init; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }).deliver(reset);
  assert.equal(result, "accepted");
  const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    authToken: configuration.token,
    to: reset.recipient,
    subject: "Reset your Atlas password",
    html: String(body.html),
    text: String(body.text),
  });
  assert.equal(body.to, reset.recipient);
  assert.equal(String(body.text).includes(reset.resetUrl), true);
  assert.equal(String(body.html).includes(reset.resetUrl), true);
  assert.equal((request?.headers as Record<string, string>).authorization, undefined);
});

test("Google Apps Script requires a token for configuration", () => {
  assert.deepEqual(googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_URL: "https://script.example.com/exec", GOOGLE_APPS_SCRIPT_TOKEN: "token", EMAIL_TIMEOUT: "4000" }), { endpoint: "https://script.example.com/exec", token: "token", timeoutMs: 4000 });
  assert.throws(() => googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_URL: "https://script.example.com/exec", EMAIL_TIMEOUT: "4000" }));
  assert.throws(() => googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_URL: "https://script.example.com/exec", GOOGLE_APPS_SCRIPT_TOKEN: "   ", EMAIL_TIMEOUT: "4000" }));
  assert.throws(() => googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_TOKEN: "token" }));
  assert.throws(() => googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_URL: "http://script.example.com/exec", GOOGLE_APPS_SCRIPT_TOKEN: "token", EMAIL_TIMEOUT: "4000" }));
  assert.throws(() => googleAppsScriptConfiguration({ GOOGLE_APPS_SCRIPT_URL: "https://script.example.com/exec", GOOGLE_APPS_SCRIPT_TOKEN: "token", EMAIL_TIMEOUT: "0" }));
});

test("Google Apps Script accepts 2xx responses with ok true", async () => {
  assert.equal(await delivery(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })).deliver(reset), "accepted");
});

test("Google Apps Script treats non-retryable contract failures as permanent", async () => {
  const entries: unknown[] = [];
  const outcome = await delivery(async () => new Response(JSON.stringify({ ok: false, code: "unauthorized", retryable: false }), { status: 200, headers: { "content-type": "application/json" } }), entries).deliver(reset);
  assert.equal(outcome, "permanent_failure");
  assert.equal((entries[0] as { provider: string }).provider, "google_apps_script");
});

test("Google Apps Script retries retryable contract failures once", async () => {
  let attempts = 0;
  const entries: unknown[] = [];
  const outcome = await delivery(async () => { attempts += 1; if (attempts === 1) { return new Response(JSON.stringify({ ok: false, code: "send_failed", retryable: true }), { status: 200, headers: { "content-type": "application/json" } }); } return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }, entries).deliver(reset);
  assert.equal(outcome, "accepted");
  assert.equal(attempts, 2);
});

test("Google Apps Script rejects empty, non-JSON, and malformed JSON bodies", async () => {
  assert.equal(await delivery(async () => new Response("", { status: 200, headers: { "content-type": "application/json" } })).deliver(reset), "permanent_failure");
  assert.equal(await delivery(async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })).deliver(verification), "permanent_failure");
  assert.equal(await delivery(async () => new Response(JSON.stringify({ code: "send_failed" }), { status: 200, headers: { "content-type": "application/json" } })).deliver(verification), "permanent_failure");
});

test("Google Apps Script keeps the token out of logs and handles timeouts and network errors", async () => {
  const entries: unknown[] = [];
  const secret = "secret-token";
  const outcome = await delivery(async () => { throw Object.assign(new Error(`recipient ${reset.recipient} ${reset.resetUrl} ${secret}`), { cause: { code: "ETIMEDOUT" }, stack: "raw-stack" }); }, entries).deliver(reset);
  assert.equal(outcome, "temporary_failure");
  const rendered = JSON.stringify(entries);
  for (const sensitive of [configuration.token, reset.recipient, "proof-value", secret, "raw-stack", "recipient "]) assert.equal(rendered.includes(sensitive), false);
});

test("Google Apps Script remains compatible with the shared delivery-mode selector for SMTP and Resend", () => {
  assert.equal(emailDeliveryMode("google_apps_script", true), "google_apps_script");
  assert.equal(emailDeliveryMode("resend", true), "resend");
  assert.equal(emailDeliveryMode("smtp", true), "smtp");
  assert.equal(emailDeliveryMode(undefined, true), "smtp");
  assert.equal(emailDeliveryMode(undefined, false), "development");
});
