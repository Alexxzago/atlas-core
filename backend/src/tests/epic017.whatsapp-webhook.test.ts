import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";
import { WhatsAppCloudApiError, WhatsAppCloudApiProvider } from "../whatsapp/providers/WhatsAppCloudApiProvider.js";

test("EPIC-017 webhook verifies signatures and parses only inbound text", () => {
  const service = new WhatsAppWebhookService({ appSecret: "secret", verifyToken: "verify" }), raw = Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages: [{ type: "text", from: "wa", id: "wamid", text: { body: "Hello" } }, { type: "image", from: "wa", id: "ignored" }] } }] }] }));
  const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
  assert.equal(service.verify("subscribe", "verify", "challenge"), "challenge"); assert.equal(service.verify("subscribe", "wrong", "challenge"), null);
  assert.equal(service.signatureValid(raw, signature), true); assert.equal(service.signatureValid(raw, "sha256=00"), false);
  assert.deepEqual(service.parse(raw), [{ phoneNumberId: "phone", waId: "wa", wamid: "wamid", text: "Hello" }]);
});

test("EPIC-017 WhatsApp Cloud API provider returns Meta IDs and rejects failed delivery", async () => {
  const accepted = new WhatsAppCloudApiProvider("token", "v22.0", async () => new Response(JSON.stringify({ messages: [{ id: "wamid-out" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(await accepted.sendText("phone", "wa", "Answer"), "wamid-out");
  const rejected = new WhatsAppCloudApiProvider("token", "v22.0", async () => new Response("", { status: 500 }));
  await assert.rejects(() => rejected.sendText("phone", "wa", "Answer"));
  const requests: Array<{ url: string; method: string | undefined; authorization: string | null; contentType: string | null; body: string | null }> = [];
  const contract = new WhatsAppCloudApiProvider("secret-token", "v26.0", async (url, init) => { requests.push({ url: String(url), method: init?.method, authorization: new Headers(init?.headers).get("authorization"), contentType: new Headers(init?.headers).get("content-type"), body: typeof init?.body === "string" ? init.body : null }); return new Response(JSON.stringify({ messages: [{ id: "wamid-contract" }] }), { status: 200 }); });
  assert.equal(await contract.sendText("phone-id", "recipient-wa-id", "private reply"), "wamid-contract");
  assert.deepEqual(requests, [{ url: "https://graph.facebook.com/v26.0/phone-id/messages", method: "POST", authorization: "Bearer secret-token", contentType: "application/json", body: JSON.stringify({ messaging_product: "whatsapp", to: "recipient-wa-id", type: "text", text: { body: "private reply" } }) }]);
  const metaRejected = new WhatsAppCloudApiProvider("secret-token", "v26.0", async () => new Response(JSON.stringify({ error: { message: "Recipient recipient-wa-id is not in the test list", type: "OAuthException", code: 131030, error_subcode: 123, is_transient: false, error_data: { details: "Recipient recipient-wa-id is outside the test recipient set" }, fbtrace_id: "trace-id" } }), { status: 400 }));
  await assert.rejects(() => metaRejected.sendText("phone-id", "recipient-wa-id", "private reply"), (error: unknown) => { assert.ok(error instanceof WhatsAppCloudApiError); assert.deepEqual(error.diagnostic, { graphApiVersion: "v26.0", httpStatus: 400, providerCode: 131030, providerSubcode: 123, errorType: "OAuthException", transient: false, sanitizedDetailsCategory: "outside_test_recipient_set" }); return true; });
});

test("WhatsApp validation classifies Graph outcomes and logs only sanitized diagnostics", async () => {
  const diagnostics: unknown[] = [], requested: Array<{ url: string; authorization: string | null }> = [];
  const valid = new WhatsAppCloudApiProvider("secret-token", "v26.0", async (url, init) => { requested.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") }); return new Response(JSON.stringify({ data: [{ id: "phone-id" }] }), { status: 200 }); }, value => diagnostics.push(value));
  assert.deepEqual(await valid.validateConnection({ accessToken: "secret-token", phoneNumberId: "phone-id", whatsappBusinessAccountId: "waba-id" }), { status: "valid" }); assert.equal(requested[0]?.url, "https://graph.facebook.com/v26.0/waba-id/phone_numbers?fields=id"); assert.equal(requested[0]?.authorization, "Bearer secret-token");
  for (const [httpStatus, failureCode] of [[401, "invalid_credentials"], [403, "insufficient_permissions"], [404, "phone_number_not_found"], [429, "rate_limited"], [500, "provider_unavailable"], [504, "provider_timeout"], [400, "provider_rejected"]] as const) { const provider = new WhatsAppCloudApiProvider("secret-token", "v26.0", async () => new Response(JSON.stringify({ error: { code: 123, error_subcode: 456, type: "OAuthException", is_transient: false, message: "Invalid field", fbtrace_id: "trace-id" } }), { status: httpStatus }), value => diagnostics.push(value)); assert.deepEqual(await provider.validateConnection({ accessToken: "secret-token", phoneNumberId: "phone-id", whatsappBusinessAccountId: "waba-id" }), { status: "invalid", failureCode }); }
  const mismatch = new WhatsAppCloudApiProvider("secret-token", "v26.0", async () => new Response(JSON.stringify({ data: [{ id: "other" }] }), { status: 200 })); assert.deepEqual(await mismatch.validateConnection({ accessToken: "secret-token", phoneNumberId: "phone-id", whatsappBusinessAccountId: "waba-id" }), { status: "invalid", failureCode: "business_account_mismatch" });
  const timeout = new WhatsAppCloudApiProvider("secret-token", "v26.0", async () => { throw new DOMException("aborted", "AbortError"); }, value => diagnostics.push(value)); assert.deepEqual(await timeout.validateConnection({ accessToken: "secret-token", phoneNumberId: "phone-id", whatsappBusinessAccountId: "waba-id" }), { status: "invalid", failureCode: "provider_timeout" });
  for (const entry of diagnostics) { const json = JSON.stringify(entry); assert.deepEqual(Object.keys(entry as object).sort(), ["error", "errorType", "event", "graphApiVersion", "httpStatus", "operation", "providerCode", "providerSubcode", "timestamp", "transient"]); assert.equal(json.includes("secret-token") || json.includes("phone-id") || json.includes("waba-id"), false); }
  assert.deepEqual((diagnostics[0] as { error: unknown }).error, { message: "Invalid field", type: "OAuthException", code: 123, error_subcode: 456, fbtrace_id: "trace-id" });
});
