import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

function raw(value: unknown): Buffer { return Buffer.from(JSON.stringify(value)); }
const payload = (messages: unknown[] = [], statuses: unknown[] = []) => raw({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages, statuses } }] }] });

test("EPIC-020 verifies subscription and exact raw HMAC bytes", () => {
  const service = new WhatsAppWebhookService({ appSecret: "secret", verifyToken: "verify" });
  const first = Buffer.from('{"a":1}'), equivalent = Buffer.from('{ "a": 1 }');
  const signature = `sha256=${createHmac("sha256", "secret").update(first).digest("hex")}`;
  assert.equal(service.verify("subscribe", "verify", "challenge"), "challenge"); assert.equal(service.verify("subscribe", "bad", "challenge"), null); assert.equal(service.verify("bad", "verify", "challenge"), null); assert.equal(service.verify("subscribe", "verify", null), null);
  assert.equal(service.signatureValid(first, signature), true); assert.equal(service.signatureValid(equivalent, signature), false); assert.equal(service.signatureValid(first, undefined), false); assert.equal(service.signatureValid(first, "invalid"), false);
});

test("EPIC-020 normalizes ordered inbound text and safe message status events only", () => {
  const service = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" });
  const events = service.parseEvents(payload([{ type: "text", from: "wa", id: "in-1", text: { body: " Hello " } }, { type: "video", from: "wa", id: "ignored" }], [{ id: "out-1", status: "sent", timestamp: "1722168000" }, { id: "out-2", status: "delivered" }, { id: "out-3", status: "read" }, { id: "out-4", status: "failed", errors: [{ title: "secret" }] }, { id: "ignored", status: "unknown" }]));
   assert.deepEqual(events.map((event) => event.kind), ["inbound_text", "inbound_unsupported", "message_status", "message_status", "message_status", "message_status"]);
  assert.deepEqual(service.parse(payload([{ type: "text", from: "wa", id: "in-1", text: { body: " Hello " } }])).map((event) => event.text), ["Hello"]);
  assert.equal(JSON.stringify(events).includes("secret"), false);
   assert.equal((events[5] as { safeFailureCategory: string }).safeFailureCategory, "provider_unavailable");
});

test("EPIC-020 excludes malformed and unsupported structures without side effects", async () => {
  let processed = 0;
  const service = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, { resolveActiveByPhoneNumberId: () => { processed += 1; return null; } } as never, {} as never, {} as never, {} as never, {} as never);
  assert.deepEqual(service.parseEvents(raw({ entry: [{ changes: [{ field: "other", value: {} }] }] })), []);
  assert.deepEqual(service.parseEvents(payload([{ type: "text", from: "wa", id: "in", text: { body: "" } }], [{ status: "read" }])), []);
  await service.receive(payload([], [{ id: "out", status: "read" }]));
  assert.equal(processed, 0);
});
