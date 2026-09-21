import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";
import { BillingApplicationService } from "../billing/application/billingApplicationService.js";
import { BillingOperationService } from "../billing/application/billingOperationService.js";
import { type BillingProvider, stripeBillingProviderCapabilities } from "../billing/application/billingProvider.js";
import { BillingProviderRegistry } from "../billing/application/billingProviderRegistry.js";
import { BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { BillingReconciliationRuntime, billingReconciliationRuntimeConfiguration } from "../billing/services/billingReconciliationRuntime.js";
import { BillingReconciliationWorker } from "../billing/services/billingReconciliationWorker.js";
import { runMigrations } from "../config/migrations.js";
import { createBillingControllers } from "../controllers/billingController.js";
import { createBillingWebhookController } from "../controllers/billingWebhookController.js";
import { BillingOperationRepository } from "../repositories/billingOperationRepository.js";
import { BillingReconciliationRepository } from "../repositories/billingReconciliationRepository.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingSubscriptionRepository } from "../repositories/billingRepository.js";
import { BillingWebhookRepository } from "../repositories/billingWebhookRepository.js";
import { createBillingRouter } from "../routes/billing.js";
import { createBillingWebhookRouter } from "../routes/billingWebhook.js";
import { asyncBillingPersistence } from "./helpers/asyncBillingTestComposition.js";

const at = "2026-09-01T00:00:00.000Z", stripeTimestamp = Math.floor(Date.parse(at) / 1_000);
type CycleWorker = Pick<BillingReconciliationWorker, "runBatch">;

function runtime(worker: CycleWorker, callback: { value: (() => void) | null }): BillingReconciliationRuntime {
  return new BillingReconciliationRuntime(worker as BillingReconciliationWorker, { intervalMilliseconds: 1_000, batchSize: 2 }, { schedule: (scheduled) => { callback.value = scheduled; return { unref() {} }; }, clear: () => {}, reportError: () => {} });
}

test("EPIC046 PASS4F6 bounds reconciliation runtime environment configuration", () => {
  assert.deepEqual(billingReconciliationRuntimeConfiguration({}), { intervalMilliseconds: 5_000, batchSize: 25 });
  assert.deepEqual(billingReconciliationRuntimeConfiguration({ BILLING_RECONCILIATION_INTERVAL_MS: "1000", BILLING_RECONCILIATION_BATCH_SIZE: "1" }), { intervalMilliseconds: 1_000, batchSize: 1 });
  for (const environment of [{ BILLING_RECONCILIATION_INTERVAL_MS: "999" }, { BILLING_RECONCILIATION_INTERVAL_MS: "60001" }, { BILLING_RECONCILIATION_INTERVAL_MS: "1.5" }, { BILLING_RECONCILIATION_BATCH_SIZE: "0" }, { BILLING_RECONCILIATION_BATCH_SIZE: "26" }]) assert.throws(() => billingReconciliationRuntimeConfiguration(environment));
});

test("EPIC046 PASS4F6 lifecycle is idempotent, non-overlapping, and recovers from safe cycle failures", async () => {
  let calls = 0, release: (() => void) | null = null, failures = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const callback = { value: null as (() => void) | null };
  const worker: CycleWorker = { async runBatch(): Promise<readonly []> { calls += 1; if (calls === 1) await gate; else if (calls === 2) throw new Error("provider secret must not be reported"); return []; } };
  const subject = new BillingReconciliationRuntime(worker as BillingReconciliationWorker, { intervalMilliseconds: 1_000, batchSize: 2 }, { schedule: (scheduled) => { callback.value = scheduled; return { unref() {} }; }, clear: () => {}, reportError: (message) => { failures += 1; assert.equal(message, "Billing reconciliation cycle failed."); } });
  subject.start(); subject.start(); callback.value!(); callback.value!();
  assert.equal(calls, 1);
  release!(); await new Promise<void>((resolve) => setImmediate(resolve));
  callback.value!(); await new Promise<void>((resolve) => setImmediate(resolve));
  callback.value!(); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 3); assert.equal(failures, 1);
  await subject.stop(); await subject.stop(); callback.value!();
  assert.equal(calls, 3);
});

test("EPIC055 PASS6 recovers durable provider operations before normal reconciliation in every cycle", async () => {
  const order: string[] = [], callback = { value: null as (() => void) | null };
  const subject = new BillingReconciliationRuntime({ async runBatch() { order.push("reconciliation"); return []; } } as never, { intervalMilliseconds: 1_000, batchSize: 1 }, { schedule: scheduled => { callback.value = scheduled; return { unref() {} }; }, clear: () => {}, reportError: () => {} }, { async runBatch() { order.push("operation_recovery"); return []; } });
  subject.start(); await new Promise<void>(resolve => setImmediate(resolve)); callback.value!(); await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(order, ["operation_recovery", "reconciliation", "operation_recovery", "reconciliation"]);
  await subject.stop();
});

test("EPIC046 PASS4F6 e2e webhook acceptance wakes runtime to paused authority and safe HTTP projection", async () => {
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db);
  const workspaceId = (db.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number }).id;
  const account = new BillingAccountRepository(db).findByWorkspace(workspaceId)!;
  db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_runtime' WHERE id=?").run(account.id);
  db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_runtime',provider_evidence_state='active',effective_state='active' WHERE billing_account_id=?").run(account.id);
  const provider: BillingProvider = { capabilities: stripeBillingProviderCapabilities, createCheckoutSession: async () => ({ kind: "failed", code: "invalid_request" }), createPortalSession: async () => ({ kind: "failed", code: "invalid_request" }), cancelAtPeriodEnd: async () => ({ kind: "failed", code: "invalid_request" }), reactivateSubscription: async () => ({ kind: "failed", code: "invalid_request" }), readSubscription: async () => ({ kind: "success", evidence: { providerSubscriptionId: "sub_runtime", providerEvidenceState: "paused", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false } }) };
  const reconciliation = new BillingReconciliationRuntime(new BillingReconciliationWorker(new BillingReconciliationRepository(db), new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at), { intervalMilliseconds: 1_000, batchSize: 1 }, { schedule: () => ({ unref() {} }), clear: () => {}, reportError: () => { throw new Error("unexpected reconciliation failure"); } });
  const webhook = new BillingWebhookService({ stripe: "webhook-secret", mercadopago: "" }, new BillingWebhookRepository(db), () => at);
  const raw = Buffer.from(JSON.stringify({ id: "evt_runtime_paused", type: "customer.subscription.updated", data: { object: { id: "sub_runtime", customer: "cus_runtime" } } }));
  const signature = createHmac("sha256", "webhook-secret").update(`${stripeTimestamp}.`).update(raw).digest("hex");
  const billing = asyncBillingPersistence(db);
  const operations = new BillingOperationService(billing.customer, billing.operations, new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at, billing.payerIdentities);
  const service = new BillingApplicationService(billing.customer, billing.payerIdentities, operations, { checkoutSuccess: "https://atlas.test/success", checkoutCancel: "https://atlas.test/cancel", portalReturn: "https://atlas.test/portal" }, () => at);
  const billingRouter = createBillingRouter({ authentication: { cookieName: () => "atlas", current: (value: string) => value === "manager" ? { userId: "manager", authenticationIdentityId: "manager-identity" } : null, validateCsrf: () => true } as never, users: { findById: () => ({ id: "manager", status: "active" }) } as never, authorization: { authorize: (_user: unknown, _workspace: string, permission: string) => ({ workspaceId, workspacePublicId: "default", userId: "manager", membershipId: "member", role: "owner", capabilities: new Set(["workspace:read", "workspace:manage"]), permission }) } as never, resolver: { resolve: () => ({ workspaceId, workspaceKey: "default" }) } as never, originPolicy: { allows: () => true } as never, controllers: createBillingControllers(service) });
  const empty = Router();
  const app = createApp({ authorizedCompaniesRouter: empty, billingRouter, billingWebhookRouter: createBillingWebhookRouter({ stripe: createBillingWebhookController(webhook, "stripe"), mercadoPago: createBillingWebhookController(webhook, "mercadopago") }), chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const accepted = await fetch(`${origin}/webhooks/billing/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${stripeTimestamp},v1=${signature}` }, body: raw });
    assert.equal(accepted.status, 200);
    reconciliation.start(); await reconciliation.stop();
    assert.equal((db.prepare("SELECT effective_state FROM billing_subscriptions WHERE billing_account_id=?").get(account.id) as { effective_state: string }).effective_state, "paused");
    const response = await fetch(`${origin}/workspaces/default/billing/summary`, { headers: { cookie: "atlas=manager" } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { rolloutMode: "managed", subscription: { state: "paused", plan: null }, entitlement: { state: "restricted", maxCompanies: null, maxAssistantProfiles: null, maxActiveChannels: null, mutationEligible: false, effectiveAt: at, expiresAt: null }, capabilities: { canOpenBillingPortal: true, canCancel: false, canReactivate: false, canStartNewCheckout: false, canSwitchProvider: false } });
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); db.close(); }
});
