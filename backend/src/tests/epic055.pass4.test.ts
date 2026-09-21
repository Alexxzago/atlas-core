import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { MercadoPagoBillingProvider } from "../billing/providers/mercadoPagoBillingProvider.js";

const timestamp = 1_725_000_000, now = () => new Date(timestamp * 1_000).toISOString();
function stripe(secret: string, raw: Buffer, value = timestamp): string { return createHmac("sha256", secret).update(`${value}.`).update(raw).digest("hex"); }
function mercado(secret: string, raw: Buffer, requestId: string, value = timestamp): string { const id = (JSON.parse(raw.toString("utf8")) as { data: { id: string } }).data.id; return createHmac("sha256", secret).update(`id:${id};request-id:${requestId};ts:${value};`).digest("hex"); }

test("EPIC055 PASS4 freezes signed Stripe and Mercado Pago event contracts before persistence", () => {
  const accepted: string[] = [], repository = { accept: (event: { providerEventId: string }) => accepted.includes(event.providerEventId) ? "duplicate" : (accepted.push(event.providerEventId), "accepted") }, stripeSecret = "stripe-secret", mpSecret = "mp-secret", service = new BillingWebhookService({ stripe: stripeSecret, mercadopago: mpSecret }, repository as never, now);
  const checkout = Buffer.from(JSON.stringify({ id: "evt_checkout", type: "checkout.session.completed", data: { object: { id: "cs_fixture", subscription: "sub_fixture", customer: "cus_fixture", client_reference_id: "aco_fixture" } } }));
  assert.equal(service.receive("stripe", checkout, { "stripe-signature": `t=${timestamp},v1=${stripe(stripeSecret, checkout)}` }), "accepted");
  const unsupportedStripe = Buffer.from(JSON.stringify({ id: "evt_invoice", type: "invoice.paid", data: { object: { id: "in_fixture" } } }));
  assert.equal(service.receive("stripe", unsupportedStripe, { "stripe-signature": `t=${timestamp},v1=${stripe(stripeSecret, unsupportedStripe)}` }), "invalid");
  const preapproval = Buffer.from(JSON.stringify({ id: "evt_preapproval", action: "preapproval.updated", data: { id: "pre_fixture" } })), requestId = "request_fixture", header = `ts=${timestamp},v1=${mercado(mpSecret, preapproval, requestId)}`;
  assert.equal(service.receive("mercadopago", preapproval, { "x-signature": header, "x-request-id": requestId }), "accepted");
  assert.equal(service.receive("mercadopago", preapproval, { "x-signature": header, "x-request-id": requestId }), "duplicate");
  const unsupported = Buffer.from(JSON.stringify({ id: "evt_payment", action: "payment.created", data: { id: "payment_fixture" } }));
  assert.equal(service.receive("mercadopago", unsupported, { "x-signature": `ts=${timestamp},v1=${mercado(mpSecret, unsupported, requestId)}`, "x-request-id": requestId }), "invalid");
  assert.equal(service.receive("mercadopago", preapproval, { "x-signature": `ts=${timestamp - 301},v1=${mercado(mpSecret, preapproval, requestId, timestamp - 301)}`, "x-request-id": requestId }), "invalid");
  assert.equal(accepted.length, 2);
});

test("EPIC055 PASS4 validates Mercado Pago ARS decimals without floating-point conversion", async () => {
  const validate = async (amount: unknown, expected: "ready" | "invalid") => {
    const provider = new MercadoPagoBillingProvider({ accessToken: "token", apiBaseUrl: "https://api.mercadopago.test", timeoutMs: 100, allowedRedirectOrigins: ["https://atlas.test"] }, async () => new Response(JSON.stringify({ status: "active", currency_id: "ARS", auto_recurring: { transaction_amount: amount, frequency: 1, frequency_type: "months" } })));
    assert.deepEqual(await provider.validateCommercialOffer({ catalogReference: "plan_fixture", currency: "ARS", amountMinor: 1999, interval: "month" }), { kind: expected });
  };
  await validate("19.99", "ready");
  await validate("19.990", "invalid");
  await validate("1e3", "invalid");
  await validate(19.99, "ready");
});
