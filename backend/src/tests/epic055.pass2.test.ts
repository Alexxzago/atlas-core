import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BillingOperationService } from "../billing/application/billingOperationService.js";
import { DeterministicFakeBillingProvider, stripeBillingProviderCapabilities } from "../billing/application/billingProvider.js";
import { BillingProviderRegistry } from "../billing/application/billingProviderRegistry.js";
import { BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { StripeBillingProvider } from "../billing/providers/stripeBillingProvider.js";
import { AsyncBillingReconciliationWorkerRepository } from "../billing/infrastructure/asyncBillingReconciliationWorkerPersistence.js";
import { AsyncBillingReconciliationWorker } from "../billing/services/asyncBillingReconciliationWorker.js";
import { runMigrations } from "../config/migrations.js";
import { SynchronousSqlDatabaseAdapter } from "../config/sqlDatabase.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingProviderCommercialOfferRepository } from "../repositories/billingRepository.js";
import { BillingWebhookRepository } from "../repositories/billingWebhookRepository.js";
import { asyncBillingOperations } from "./helpers/asyncBillingTestComposition.js";

const at = "2026-09-21T00:00:00.000Z";
function open(): DatabaseSync { const database = new DatabaseSync(":memory:"); database.exec("PRAGMA foreign_keys=ON"); runMigrations(database); return database; }
function workspace(database: DatabaseSync): number { return (database.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number }).id; }
function offer(database: DatabaseSync, key = "stripe-pass2") { const entry = new BillingCatalogRepository(database).create({ planKey: key, catalogVersion: 1, displayName: key, interval: "month", currency: "USD", amountMinor: 1200, lifecycle: "active", maxCompanies: 1, maxAssistantProfiles: 1, maxActiveChannels: 1, mutationEligible: true, entitlementDefinitionVersion: 1, providerKind: "stripe", providerPriceId: `price_${key}` }); return { entry, offer: new BillingProviderCommercialOfferRepository(database).findForCatalogProvider(entry.id, "stripe")! }; }

test("EPIC055 PASS2 creates Stripe subscription checkout from one immutable USD price and fails closed on unsafe responses", async () => {
  const requests: RequestInit[] = [];
  const provider = new StripeBillingProvider({ secretKey: "sk_test_fixture", apiBaseUrl: "https://api.stripe.test", timeoutMs: 100, allowedRedirectOrigins: ["https://atlas.test", "https://checkout.stripe.test"] }, async (_url, init) => {
    requests.push(init);
    return new Response(JSON.stringify({ id: "cs_fixture", url: "https://checkout.stripe.test/session" }));
  });
  const result = await provider.createCheckoutSession({ idempotencyKey: "atlas-key", catalogReference: "price_fixture", successTarget: "https://atlas.test/billing/checkout/success", cancelTarget: "https://atlas.test/billing/checkout/cancel", correlationToken: "aco_opaque" });
  assert.deepEqual(result, { kind: "success", providerObjectId: "cs_fixture", redirectUrl: "https://checkout.stripe.test/session" });
  const body = new URLSearchParams(String(requests[0]!.body));
  assert.deepEqual([...body.keys()].sort(), ["cancel_url", "client_reference_id", "line_items[0][price]", "line_items[0][quantity]", "mode", "success_url"]);
  assert.equal(body.get("mode"), "subscription");
  assert.equal(body.get("line_items[0][price]"), "price_fixture");
  assert.equal(new Headers(requests[0]!.headers).get("idempotency-key"), "atlas-key");
  assert.equal((await provider.createCheckoutSession({ idempotencyKey: "next", catalogReference: "price_fixture", successTarget: "https://evil.test/s", cancelTarget: "https://atlas.test/c" })).kind, "failed");
  assert.equal(requests.length, 1);

  const uncertain = new StripeBillingProvider({ secretKey: "sk_test_fixture", apiBaseUrl: "https://api.stripe.test", timeoutMs: 100, allowedRedirectOrigins: ["https://atlas.test"] }, async () => new Response("not-json"));
  assert.deepEqual(await uncertain.createCheckoutSession({ idempotencyKey: "uncertain", catalogReference: "price_fixture", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" }), { kind: "uncertain" });
  const prices = new StripeBillingProvider({ secretKey: "sk_test_fixture", apiBaseUrl: "https://api.stripe.test", timeoutMs: 100, allowedRedirectOrigins: ["https://atlas.test"] }, async () => new Response(JSON.stringify({ active: true, currency: "usd", unit_amount: 1200, recurring: { interval: "month" } })));
  assert.deepEqual(await prices.validateCommercialOffer({ catalogReference: "price_fixture", currency: "USD", amountMinor: 1200, interval: "month" }), { kind: "ready" });
  assert.deepEqual(await prices.validateCommercialOffer({ catalogReference: "price_fixture", currency: "EUR", amountMinor: 1200, interval: "month" }), { kind: "invalid" });
});

test("EPIC055 PASS2 replays checkout operations, conflicts divergent reuse, and never replaces an uncertain Stripe create", async () => {
  const database = open();
  try {
    const { entry, offer: selected } = offer(database), provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "cs_once", redirectUrl: "https://checkout.test/session" }), service = asyncBillingOperations(database, new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at), input = { workspaceId: workspace(database), catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "checkout-once", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" };
    assert.equal((await service.checkout(input)).kind, "succeeded");
    assert.equal((await service.checkout(input)).kind, "succeeded");
    assert.equal((await service.checkout({ ...input, cancelTarget: "https://atlas.test/changed" })).kind, "conflict");
    assert.equal(provider.calls.filter(call => call.kind === "checkout_session_create").length, 1);
    database.prepare("DELETE FROM billing_checkout_enrollments WHERE billing_account_id=(SELECT id FROM billing_accounts WHERE workspace_id=?)").run(workspace(database));

    const { entry: uncertainEntry, offer: uncertainOffer } = offer(database, "stripe-uncertain"), uncertainProvider = new DeterministicFakeBillingProvider({ kind: "uncertain" }), uncertainService = asyncBillingOperations(database, new BillingProviderRegistry([{ kind: "stripe", provider: uncertainProvider }]), () => at), uncertainInput = { workspaceId: workspace(database), catalogEntryId: uncertainEntry.id, providerCommercialOfferId: uncertainOffer.id, operationId: "checkout-uncertain", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" };
    assert.equal((await uncertainService.checkout(uncertainInput)).kind, "uncertain");
    assert.equal((await uncertainService.checkout(uncertainInput)).kind, "uncertain");
    assert.equal(uncertainProvider.calls.filter(call => call.kind === "checkout_session_create").length, 1);
  } finally { database.close(); }
});

test("EPIC055 PASS2 blocks a second same-provider checkout and keeps cancel commands outside entitlement transitions", async () => {
  const database = open();
  try {
    const { entry, offer: selected } = offer(database), account = new BillingAccountRepository(database).findByWorkspace(workspace(database))!, provider = new DeterministicFakeBillingProvider(), service = asyncBillingOperations(database, new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at);
    database.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_trusted' WHERE id=?").run(account.id);
    database.prepare("UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind='stripe',provider_subscription_id='sub_trusted',effective_state='active' WHERE billing_account_id=?").run(entry.id, selected.id, account.id);
    assert.equal((await service.checkout({ workspaceId: workspace(database), catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "second", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" })).kind, "conflict");
    const before = database.prepare("SELECT effective_state,entitlement_state FROM billing_subscriptions JOIN billing_entitlement_snapshots ON billing_entitlement_snapshots.billing_account_id=billing_subscriptions.billing_account_id WHERE billing_subscriptions.billing_account_id=?").get(account.id);
    const subscriptionId = (database.prepare("SELECT id FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(account.id) as { id: string }).id;
    assert.equal((await service.cancelAtPeriodEnd({ workspaceId: workspace(database), subscriptionId, operationId: "cancel" })).kind, "succeeded");
    assert.deepEqual(database.prepare("SELECT effective_state,entitlement_state FROM billing_subscriptions JOIN billing_entitlement_snapshots ON billing_entitlement_snapshots.billing_account_id=billing_subscriptions.billing_account_id WHERE billing_subscriptions.billing_account_id=?").get(account.id), before);
    assert.equal(provider.calls.filter(call => call.kind === "checkout_session_create").length, 0);
  } finally { database.close(); }
});

test("EPIC055 PASS2 permits only canceled current subscriptions to start a new same-provider checkout", async () => {
  for (const state of ["trial", "active", "canceling_at_period_end", "grace", "paused", "payment_required", "reconciliation_required"] as const) {
    const database = open();
    try {
      const { entry, offer: selected } = offer(database, `stripe-${state}`), account = new BillingAccountRepository(database).findByWorkspace(workspace(database))!, provider = new DeterministicFakeBillingProvider(), service = asyncBillingOperations(database, new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at);
      database.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_trusted' WHERE id=?").run(account.id);
      database.prepare("UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind='stripe',provider_subscription_id='sub_existing',effective_state=? WHERE billing_account_id=?").run(entry.id, selected.id, state, account.id);
      assert.equal((await service.checkout({ workspaceId: workspace(database), catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: `blocked-${state}`, successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" })).kind, "conflict");
      assert.equal(provider.calls.length, 0);
    } finally { database.close(); }
  }

  const database = open();
  try {
    const { entry, offer: selected } = offer(database, "stripe-canceled"), account = new BillingAccountRepository(database).findByWorkspace(workspace(database))!, provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "cs_replacement", redirectUrl: "https://checkout.test/replacement" }), service = asyncBillingOperations(database, new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at);
    database.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_trusted' WHERE id=?").run(account.id);
    database.prepare("UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind='stripe',provider_subscription_id='sub_canceled',effective_state='canceled' WHERE billing_account_id=?").run(entry.id, selected.id, account.id);
    const input = { workspaceId: workspace(database), catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "resubscribe", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" };
    assert.equal((await service.checkout(input)).kind, "succeeded");
    assert.equal((await service.checkout(input)).kind, "succeeded");
    assert.equal((await service.checkout({ ...input, cancelTarget: "https://atlas.test/changed" })).kind, "conflict");
    assert.equal(provider.calls.filter(call => call.kind === "checkout_session_create").length, 1);
    assert.equal((await service.checkout({ ...input, operationId: "duplicate-after-canceled" })).kind, "conflict");
  } finally { database.close(); }
});

test("EPIC055 PASS2 replaces a canceled Stripe subscription only after trusted completion and reconciliation", async () => {
  const database = open();
  try {
    const { entry, offer: selected } = offer(database, "stripe-replacement"), account = new BillingAccountRepository(database).findByWorkspace(workspace(database))!, provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "cs_replacement", redirectUrl: "https://checkout.test/replacement" }, stripeBillingProviderCapabilities, { kind: "success", evidence: { providerSubscriptionId: "sub_replacement", providerCommercialReference: selected.providerPlanReference, providerEvidenceState: "active", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false } }), registry = new BillingProviderRegistry([{ kind: "stripe", provider }]), service = asyncBillingOperations(database, registry, () => at);
    database.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_trusted' WHERE id=?").run(account.id);
    database.prepare("UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind='stripe',provider_subscription_id='sub_canceled',provider_evidence_state='canceled',effective_state='canceled' WHERE billing_account_id=?").run(entry.id, selected.id, account.id);
    assert.equal((await service.checkout({ workspaceId: workspace(database), catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "replace-canceled", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" })).kind, "succeeded");
    assert.equal((database.prepare("SELECT provider_subscription_id FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(account.id) as { provider_subscription_id: string }).provider_subscription_id, "sub_canceled");
    const raw = Buffer.from(JSON.stringify({ id: "evt_replacement", type: "checkout.session.completed", data: { object: { id: "cs_replacement", subscription: "sub_replacement", customer: "cus_trusted" } } })), timestamp = Math.floor(Date.parse(at) / 1_000), signature = createHmac("sha256", "stripe-secret").update(`${timestamp}.`).update(raw).digest("hex");
    assert.equal(new BillingWebhookService({ stripe: "stripe-secret", mercadopago: "" }, new BillingWebhookRepository(database), () => at).receive("stripe", raw, { "stripe-signature": `t=${timestamp},v1=${signature}` }), "accepted");
    assert.equal(await new AsyncBillingReconciliationWorker(new AsyncBillingReconciliationWorkerRepository(new SynchronousSqlDatabaseAdapter(database)), registry, () => at).runNext("replacement"), "applied");
    assert.deepEqual((database.prepare("SELECT provider_subscription_id,effective_state,is_current FROM billing_subscriptions WHERE billing_account_id=? ORDER BY is_current,id").all(account.id) as Array<Record<string, unknown>>).map(row => ({ ...row })), [{ provider_subscription_id: "sub_canceled", effective_state: "canceled", is_current: 0 }, { provider_subscription_id: "sub_replacement", effective_state: "active", is_current: 1 }]);
    const replacement = database.prepare("SELECT id FROM billing_subscriptions WHERE billing_account_id=? AND provider_subscription_id='sub_replacement'").get(account.id) as { id: string };
    assert.deepEqual({ ...database.prepare("SELECT billing_subscription_id,entitlement_state,mutation_eligible FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(account.id) as Record<string, unknown> }, { billing_subscription_id: replacement.id, entitlement_state: "enabled", mutation_eligible: 1 });
  } finally { database.close(); }
});

test("EPIC055 PASS2 retries canonical reconciliation when Stripe price evidence differs from the immutable offer", async () => {
  const database = open();
  try {
    const { entry, offer: selected } = offer(database), account = new BillingAccountRepository(database).findByWorkspace(workspace(database))!;
    database.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_trusted' WHERE id=?").run(account.id);
    database.prepare("UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind='stripe',provider_subscription_id='sub_trusted',provider_evidence_state='active',effective_state='active' WHERE billing_account_id=?").run(entry.id, selected.id, account.id);
    new BillingWebhookRepository(database).accept({ providerKind: "stripe", providerEventId: "evt_price_mismatch", eventType: "customer.subscription.updated", providerObjectId: "sub_trusted", providerCustomerId: "cus_trusted", providerSubscriptionId: "sub_trusted", payloadDigest: "a".repeat(64) }, at);
    const provider = new DeterministicFakeBillingProvider(undefined, stripeBillingProviderCapabilities, { kind: "success", evidence: { providerSubscriptionId: "sub_trusted", providerCommercialReference: "price_wrong", providerEvidenceState: "active", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false } });
    const worker = new AsyncBillingReconciliationWorker(new AsyncBillingReconciliationWorkerRepository(new SynchronousSqlDatabaseAdapter(database)), new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at);
    assert.equal(await worker.runNext("price-mismatch"), "retry");
    assert.equal((database.prepare("SELECT effective_state FROM billing_subscriptions WHERE billing_account_id=?").get(account.id) as { effective_state: string }).effective_state, "active");
    assert.equal((database.prepare("SELECT safe_failure_code FROM billing_reconciliation_work WHERE billing_account_id=?").get(account.id) as { safe_failure_code: string }).safe_failure_code, "commercial_mismatch");
  } finally { database.close(); }
});
