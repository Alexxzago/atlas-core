import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";
import { BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { createBillingWebhookRouter } from "../routes/billingWebhook.js";

function signed(secret: string, raw: Buffer, timestamp: number): string { return createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex"); }
function listen(app: ReturnType<typeof createApp>): Promise<{ readonly server: ReturnType<ReturnType<typeof createApp>["listen"]>; readonly origin: string }> { const server = app.listen(0, "127.0.0.1"); return new Promise((resolve) => server.once("listening", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))); }
function close(server: ReturnType<ReturnType<typeof createApp>["listen"]>): Promise<void> { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

test("EPIC047 PASS4 applies explicit ordinary JSON bounds, safe headers, and preserves raw webhook bytes", async () => {
  const ordinary = Router(), webhook = createBillingWebhookRouter({ stripe: (request, response) => response.status(Buffer.isBuffer(request.body) ? 204 : 400).end(), mercadoPago: (_request, response) => response.status(204).end() });
  ordinary.post("/echo", (request, response) => response.json({ size: JSON.stringify(request.body).length }));
  const app = createApp({ authorizedCompaniesRouter: Router(), billingWebhookRouter: webhook, chatRouter: Router(), companiesRouter: Router(), identityRouter: Router(), knowledgeRouter: Router(), publicWebChatRouter: Router(), scrapeRouter: ordinary, workspacesRouter: Router() });
  const { server, origin } = await listen(app);
  try {
    const health = await fetch(`${origin}/health`); assert.equal(health.status, 200); assert.equal(health.headers.get("x-powered-by"), null); assert.equal(health.headers.get("x-content-type-options"), "nosniff"); assert.equal(health.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await fetch(`${origin}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(99 * 1024) }) })).status, 200);
    const oversized = await fetch(`${origin}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hostile: "secret-body-marker", value: "x".repeat(101 * 1024) }) }); assert.equal(oversized.status, 413); assert.ok(!(await oversized.text()).includes("secret-body-marker"));
    assert.equal((await fetch(`${origin}/webhooks/billing/stripe?raw=1`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not-json" })).status, 204);
  } finally { await close(server); }
});

test("EPIC047 PASS4 Stripe verifies exact fresh raw bytes, accepts any valid v1, and rejects stale or malformed material", () => {
  const secret = "stripe-pass4-secret", raw = Buffer.from(JSON.stringify({ id: "evt_pass4", type: "customer.subscription.updated", data: { object: { id: "sub_pass4" } } })), timestamp = 1_725_000_000, service = new BillingWebhookService({ stripe: secret, mercadopago: "mp-secret" }, { accept: () => "accepted" } as never, () => new Date(timestamp * 1_000).toISOString()), signature = signed(secret, raw, timestamp);
  assert.equal(service.receive("stripe", raw, { "stripe-signature": `t=${timestamp},v1=${signature}` }), "accepted");
  assert.equal(service.receive("stripe", raw, { "stripe-signature": `t=${timestamp},v1=${"00".repeat(32)},v1=${signature}` }), "accepted");
  assert.equal(service.receive("stripe", raw, { "stripe-signature": `t=${timestamp - 301},v1=${signature}` }), "invalid");
  assert.equal(service.receive("stripe", raw, { "stripe-signature": `t=${timestamp + 301},v1=${signature}` }), "invalid");
  assert.equal(service.receive("stripe", raw, { "stripe-signature": `t=bad,v1=${signature}` }), "invalid");
  assert.equal(service.receive("stripe", raw, { "stripe-signature": `t=${timestamp}` }), "invalid");
  assert.equal(service.receive("stripe", Buffer.from(`${raw}x`), { "stripe-signature": `t=${timestamp},v1=${signature}` }), "invalid");
  assert.doesNotThrow(() => service.receive("stripe", raw, { "stripe-signature": `t=${timestamp},v1=00` }));
});
