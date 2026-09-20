import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import express from "express";
import { BillingApplicationService } from "../billing/application/billingApplicationService.js";
import { BillingOperationService } from "../billing/application/billingOperationService.js";
import { DeterministicFakeBillingProvider, mercadoPagoBillingProviderCapabilities, stripeBillingProviderCapabilities } from "../billing/application/billingProvider.js";
import { BillingProviderRegistry } from "../billing/application/billingProviderRegistry.js";
import { BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { BillingReconciliationWorker } from "../billing/services/billingReconciliationWorker.js";
import { runMigrations } from "../config/migrations.js";
import { createBillingControllers } from "../controllers/billingController.js";
import { BillingCatalogAdministrationRepository } from "../repositories/billingCatalogAdministrationRepository.js";
import { BillingOperationRepository } from "../repositories/billingOperationRepository.js";
import { BillingReconciliationRepository } from "../repositories/billingReconciliationRepository.js";
import { BillingWebhookRepository } from "../repositories/billingWebhookRepository.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingSubscriptionRepository } from "../repositories/billingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createBillingRouter } from "../routes/billing.js";
import { PlatformAdministrationService } from "../platformAdmin/services/platformAdministrationService.js";
import { PlatformAdministrationRepository } from "../repositories/platformAdministrationRepository.js";
import { asyncBillingApplication } from "./helpers/asyncBillingTestComposition.js";

const at = "2026-09-14T00:00:00.000Z";
const actor = "usr_pass5_admin";
function open(head = Number.POSITIVE_INFINITY): DatabaseSync { const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db, head); return db; }
function workspace(db: DatabaseSync, key = "default"): number { return (db.prepare("SELECT id FROM workspaces WHERE key=?").get(key) as { id: number }).id; }
function providers(stripe = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "cs_pass5" }), mp = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "mp_pass5" }, { ...mercadoPagoBillingProviderCapabilities, requiresPayerEmailForCheckout: false })): BillingProviderRegistry { return new BillingProviderRegistry([{ kind: "stripe", provider: stripe }, { kind: "mercadopago", provider: mp }]); }
function application(db: DatabaseSync, registry: BillingProviderRegistry): BillingApplicationService { return asyncBillingApplication(db, registry, { checkoutSuccess: "https://atlas.test/success", checkoutCancel: "https://atlas.test/cancel", portalReturn: "https://atlas.test/portal" }, () => at); }

test("EPIC052 PASS5 migrates a fresh database and a genuine 0073 billing fixture to the 0074 head", () => {
  const fresh = open();
  try {
    const head = fresh.prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as { id: number; name: string };
    assert.equal(head.id, 75);
    assert.equal(head.name, "0075_activation_verification_attempts");
    assert.deepEqual(fresh.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { fresh.close(); }
  const upgraded = open(73);
  try {
    const account = new BillingAccountRepository(upgraded).findByWorkspace(workspace(upgraded))!;
    upgraded.prepare("INSERT INTO billing_catalog_entries(id,plan_key,catalog_version,display_name,billing_interval,currency,amount_minor,lifecycle_state,entitlement_max_companies,entitlement_max_assistant_profiles,entitlement_max_active_channels,entitlement_mutation_eligible,entitlement_definition_version,provider_kind,provider_price_id,created_at) VALUES('legacy_pass5','legacy-pass5',1,'Legacy PASS5','month','USD',1200,'active',2,3,4,1,1,'stripe','price_legacy_pass5',?)").run(at);
    upgraded.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_legacy' WHERE id=?").run(account.id);
    upgraded.prepare("UPDATE billing_subscriptions SET catalog_entry_id='legacy_pass5',provider_kind='stripe',provider_subscription_id='sub_legacy',provider_evidence_state='active',effective_state='active' WHERE billing_account_id=? AND is_current=1").run(account.id);
    runMigrations(upgraded);
    const binding = upgraded.prepare("SELECT s.provider_commercial_offer_id,o.provider_plan_reference FROM billing_subscriptions s JOIN billing_provider_commercial_offers o ON o.id=s.provider_commercial_offer_id WHERE s.billing_account_id=? AND s.is_current=1").get(account.id) as { provider_commercial_offer_id: string; provider_plan_reference: string };
    assert.ok(binding.provider_commercial_offer_id);
    assert.equal(binding.provider_plan_reference, "price_legacy_pass5");
    assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { upgraded.close(); }
});

test("EPIC052 PASS5 keeps unconfigured providers and customer projections safe", async () => {
  const db = open();
  try {
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES(?,'active','en',?,?)").run(actor, at, at);
    const catalog = new BillingCatalogAdministrationRepository(db), admin = new PlatformAdministrationService(new PlatformAdministrationRepository(db), undefined, catalog, new BillingProviderRegistry());
    const plan = admin.createBillingPlan(actor, { operationId: "draft", planKey: "safe-pass5", catalogVersion: 1, displayName: "Safe", description: "Customer text", inclusions: ["knowledge"], maxCompanies: 1, maxAssistantProfiles: 1, maxActiveChannels: 1, mutationEligible: true, trialDurationDays: null, graceDurationDays: null });
    const mp = admin.addBillingOffer(actor, plan.id, { operationId: "mp", expectedVersion: plan.version, providerKind: "mercadopago", amountMinor: 2000, interval: "month", providerPlanReference: "mp_secret_reference", readinessState: "not_configured" });
    const checked = await admin.validateBillingOffer(actor, plan.id, mp.id, { operationId: "validate", expectedVersion: catalog.find(plan.id)!.version, expectedOfferVersion: mp.version });
    assert.equal(checked.readinessState, "not_configured");
    assert.equal((await application(db, new BillingProviderRegistry()).offersForWorkspace(workspace(db))).offers.length, 0);
  } finally { db.close(); }
});

test("EPIC052 PASS5 authorizes billing only in the requested workspace, never through platform identity", async () => {
  const db = open();
  const app = express();
  try {
    const service = application(db, new BillingProviderRegistry());
    app.use(express.json());
    app.use("/workspaces", createBillingRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "member" ? { userId: "member", authenticationIdentityId: "identity" } : raw === "platform" ? { userId: "platform", authenticationIdentityId: "platform_identity" } : null, validateCsrf: () => true } as never, users: { findById: (id: string) => id === "member" || id === "platform" ? { id, status: "active" } : null } as never, authorization: { authorize: (user: unknown, requested: string) => { if ((user as { id: string }).id !== "member" || requested !== "default") throw new Error("denied"); return { workspaceId: workspace(db), workspacePublicId: "default", userId: "member", membershipId: "member", role: "owner", capabilities: new Set(["workspace:read"]), permission: "workspace:read" }; } } as never, resolver: { resolve: (value: unknown) => ({ workspaceId: (value as { workspaceId: number }).workspaceId, workspaceKey: "default" }) } as never, originPolicy: { allows: () => true } as never, controllers: createBillingControllers(service) }));
    const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    try { const port = (server.address() as import("node:net").AddressInfo).port; assert.equal((await fetch(`http://127.0.0.1:${port}/workspaces/default/billing/summary`, { headers: { cookie: "atlas=member" } })).status, 200); assert.equal((await fetch(`http://127.0.0.1:${port}/workspaces/other/billing/summary`, { headers: { cookie: "atlas=member" } })).status, 404); assert.equal((await fetch(`http://127.0.0.1:${port}/workspaces/default/billing/summary`, { headers: { cookie: "atlas=platform" } })).status, 404); } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  } finally { db.close(); }
});

test("EPIC052 PASS5 activates exact Stripe and Mercado Pago offers, projects entitlement, and preserves repriced history", async () => {
  const db = open();
  try {
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES(?,'active','en',?,?)").run(actor, at, at);
    const stripe = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "cs_pass5" });
    const mpProvider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "mp_pass5" }, { ...mercadoPagoBillingProviderCapabilities, requiresPayerEmailForCheckout: false });
    const registry = providers(stripe, mpProvider), catalog = new BillingCatalogAdministrationRepository(db), admin = new PlatformAdministrationService(new PlatformAdministrationRepository(db), undefined, catalog, registry), service = application(db, registry);
    const draft = admin.createBillingPlan(actor, { operationId: "create", planKey: "atlas-pass5", catalogVersion: 1, displayName: "Atlas", description: "Safe description", inclusions: ["knowledge"], maxCompanies: 2, maxAssistantProfiles: 3, maxActiveChannels: 4, mutationEligible: true, trialDurationDays: null, graceDurationDays: null });
    const stripeOffer = admin.addBillingOffer(actor, draft.id, { operationId: "stripe-offer", expectedVersion: draft.version, providerKind: "stripe", amountMinor: 1200, interval: "month", providerPlanReference: "price_pass5_old", readinessState: "not_configured" });
    const mpOffer = admin.addBillingOffer(actor, draft.id, { operationId: "mp-offer", expectedVersion: catalog.find(draft.id)!.version, providerKind: "mercadopago", amountMinor: 2000, interval: "month", providerPlanReference: "mp_pass5_old", readinessState: "not_configured" });
    const stripeReady = await admin.validateBillingOffer(actor, draft.id, stripeOffer.id, { operationId: "stripe-valid", expectedVersion: catalog.find(draft.id)!.version, expectedOfferVersion: stripeOffer.version });
    await admin.validateBillingOffer(actor, draft.id, mpOffer.id, { operationId: "mp-valid", expectedVersion: catalog.find(draft.id)!.version, expectedOfferVersion: mpOffer.version });
    const published = admin.publishBillingPlan(actor, draft.id, { operationId: "publish", expectedVersion: catalog.find(draft.id)!.version });
    const currentStripe = catalog.offers(published.id).find(value => value.id === stripeReady.id)!;
    const offers = (await service.offersForWorkspace(workspace(db))).offers;
    assert.deepEqual(offers.map(value => [value.offerId, value.currency]), [[mpOffer.id, "ARS"], [stripeOffer.id, "USD"]]);
    assert.equal(JSON.stringify(offers).includes("price_pass5_old"), false);
    assert.equal((await service.checkoutOffer(workspace(db), currentStripe.id, "stripe-checkout")).status, "succeeded");
    const operation = new BillingOperationRepository(db).find(new BillingAccountRepository(db).findByWorkspace(workspace(db))!.id, "checkout_session_create", "http_checkout_" + (await import("node:crypto")).createHash("sha256").update("stripe-checkout").digest("hex"))!;
    const payload = Buffer.from(JSON.stringify({ id: "evt_pass5", type: "checkout.session.completed", data: { object: { id: "cs_pass5", subscription: "sub_pass5", customer: "cus_pass5", client_reference_id: operation.recoveryCorrelationToken } } }));
    const stamp = Math.floor(Date.parse(at) / 1000), signature = createHmac("sha256", "pass5-secret").update(`${stamp}.`).update(payload).digest("hex");
    assert.equal(new BillingWebhookService({ stripe: "pass5-secret", mercadopago: "unused" }, new BillingWebhookRepository(db), () => at).receive("stripe", payload, { "stripe-signature": `t=${stamp},v1=${signature}` }), "accepted");
    stripe.readSubscription = async () => ({ kind: "success", evidence: { providerSubscriptionId: "sub_pass5", providerCommercialReference: "price_pass5_old", providerEvidenceState: "active", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false } });
    const worker = new BillingReconciliationWorker(new BillingReconciliationRepository(db), registry, () => at);
    assert.equal(await worker.runNext(), "applied");
    assert.deepEqual((await service.customerSummary(workspace(db))).subscription, { state: "active", plan: { key: "atlas-pass5", name: "Atlas", interval: "month", currency: "USD", amountMinor: 1200 } });
    assert.deepEqual((await service.customerSummary(workspace(db))).entitlement, { state: "enabled", maxCompanies: 2, maxAssistantProfiles: 3, maxActiveChannels: 4, mutationEligible: true, effectiveAt: at, expiresAt: null });
    const repriced = admin.nextBillingPlanVersion(actor, published.id, { operationId: "reprice", expectedVersion: catalog.find(published.id)!.version });
    const newStripe = admin.nextBillingOfferVersion(actor, repriced.id, { operationId: "new-stripe", expectedVersion: repriced.version, providerKind: "stripe", amountMinor: 1800, interval: "month", providerPlanReference: "price_pass5_new", readinessState: "ready" });
    admin.publishBillingPlan(actor, repriced.id, { operationId: "publish-reprice", expectedVersion: catalog.find(repriced.id)!.version });
    assert.equal(catalog.offers(repriced.id).find(value => value.id === newStripe.id)!.lifecycle, "sellable");
    assert.equal((await service.customerSummary(workspace(db))).subscription.plan!.amountMinor, 1200);
    assert.equal(catalog.offers(published.id).find(value => value.id === mpOffer.id)!.amountMinor, 2000);
    const other = new WorkspaceRepository(db).create({ publicId: "wsp_pass5_mp", key: "pass5-mp", name: "PASS5 MP", timezone: null, defaultLocale: null });
    assert.equal((await service.checkoutOffer(other.id, mpOffer.id, "mp-checkout")).status, "succeeded");
    mpProvider.readSubscription = async () => ({ kind: "success", evidence: { providerSubscriptionId: "mp_pass5", providerCommercialReference: "mp_pass5_old", providerEvidenceState: "active", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false } });
    assert.equal(await worker.runNext(), "applied");
    assert.equal(await worker.runNext(), "no_work");
    assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(new BillingAccountRepository(db).findByWorkspace(other.id)!.id) as { count: number }).count, 1);
    assert.equal((await service.customerSummary(other.id)).subscription.plan!.currency, "ARS");
  } finally { db.close(); }
});
