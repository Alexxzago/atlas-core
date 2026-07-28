import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";
import { WhatsAppCloudApiProvider } from "../whatsapp/providers/WhatsAppCloudApiProvider.js";

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
});
