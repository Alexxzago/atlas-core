import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BillingApplicationService } from "../billing/application/billingApplicationService.js";
import { BillingOperationService } from "../billing/application/billingOperationService.js";
import { DeterministicFakeBillingProvider, mercadoPagoBillingProviderCapabilities, stripeBillingProviderCapabilities } from "../billing/application/billingProvider.js";
import { BillingProviderRegistry } from "../billing/application/billingProviderRegistry.js";
import { BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { BillingReconciliationWorker } from "../billing/services/billingReconciliationWorker.js";
import { runMigrations } from "../config/migrations.js";
import { BillingOperationRepository } from "../repositories/billingOperationRepository.js";
import { BillingReconciliationRepository } from "../repositories/billingReconciliationRepository.js";
import { BillingWebhookRepository } from "../repositories/billingWebhookRepository.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingProviderCommercialOfferRepository, BillingSubscriptionRepository } from "../repositories/billingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { asyncBillingApplication, asyncBillingOperations } from "./helpers/asyncBillingTestComposition.js";

const at = "2026-09-01T00:00:00.000Z";
const stripeTimestamp = Math.floor(Date.parse(at) / 1_000);
type ProviderKind = "stripe" | "mercadopago";

function open(): DatabaseSync { const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db); return db; }
function account(db: DatabaseSync, workspaceId = (db.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number }).id) { return new BillingAccountRepository(db).findByWorkspace(workspaceId)!; }
function plan(db: DatabaseSync, key: string, kind: ProviderKind, amount = 100) { return new BillingCatalogRepository(db).create({ planKey: key, catalogVersion: 1, displayName: key, interval: "month", currency: kind === "stripe" ? "USD" : "ARS", amountMinor: amount, lifecycle: "active", maxCompanies: 1, maxAssistantProfiles: 1, maxActiveChannels: 1, mutationEligible: true, entitlementDefinitionVersion: 1, providerKind: kind, providerPriceId: `${kind}_${key}` }); }
function offer(db: DatabaseSync, entryId: string, kind: ProviderKind) { return new BillingProviderCommercialOfferRepository(db).findForCatalogProvider(entryId, kind)!; }
function operations(db: DatabaseSync, providers: BillingProviderRegistry) { return asyncBillingOperations(db, providers, () => at); }
function evidence(subscriptionId: string, reference: string) { return { kind: "success" as const, evidence: { providerSubscriptionId: subscriptionId, providerCommercialReference: reference, providerEvidenceState: "active" as const, currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false } }; }
function enroll(db: DatabaseSync, value: { accountId: string; entryId: string; offerId: string; kind: ProviderKind; subscriptionId: string; suffix: string }): void {
  const created = new BillingOperationRepository(db).createOrReplay({ billingAccountId: value.accountId, kind: "checkout_session_create", providerKind: value.kind, operationId: `op_${value.suffix}`, fingerprint: "a".repeat(64), catalogEntryId: value.entryId, providerCommercialOfferId: value.offerId, at }).operation!;
  db.prepare("INSERT INTO billing_checkout_enrollments(id,billing_account_id,catalog_entry_id,provider_commercial_offer_id,checkout_operation_id,provider_kind,provider_checkout_object_id,provider_subscription_id,provider_customer_id,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,NULL,'ready',1,?,?)").run(`enrollment_${value.suffix}`, value.accountId, value.entryId, value.offerId, created.id, value.kind, `checkout_${value.suffix}`, value.subscriptionId, at, at);
  db.prepare("INSERT INTO billing_reconciliation_work(id,billing_account_id,provider_kind,reason,provider_object_id,coalesce_key,status,attempt_count,lease_owner,lease_token,lease_expires_at,next_attempt_at,safe_failure_code,version,wake_generation,created_at,updated_at) VALUES(?,?,?,'test',?,?,'pending',0,NULL,NULL,NULL,?,NULL,1,1,?,?)").run(`work_${value.suffix}`, value.accountId, value.kind, value.subscriptionId, `test:${value.suffix}`, at, at, at);
}

test("EPIC052 PASS3 binds Stripe checkout to the exact offer and ignores client commercial claims", async () => {
  const db = open();
  try {
    const entry = plan(db, "exact", "stripe"), selected = offer(db, entry.id, "stripe"), replacement = new BillingProviderCommercialOfferRepository(db).create({ catalogEntryId: entry.id, providerKind: "stripe", offerVersion: 2, currency: "USD", amountMinor: 999, interval: "year", providerPlanReference: "price_replacement", readinessState: "ready", lifecycle: "sellable", at });
    const received: { value?: { catalogReference: string; correlationToken?: string } } = {}; let calls = 0;
    const provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "cs_exact" });
    provider.createCheckoutSession = async input => { calls += 1; received.value = input.correlationToken === undefined ? { catalogReference: input.catalogReference } : { catalogReference: input.catalogReference, correlationToken: input.correlationToken }; return { kind: "success", providerObjectId: "cs_exact" }; };
    const a = account(db), service = operations(db, new BillingProviderRegistry([{ kind: "stripe", provider }]));
    const input = { workspaceId: a.workspaceId, catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "exact", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c", amountMinor: 1, currency: "EUR", providerPlanReference: "attacker_reference" };
    assert.equal((await service.checkout(input)).kind, "succeeded");
    assert.ok(received.value);
    const observed = received.value;
    assert.deepEqual({ catalogReference: observed.catalogReference, hasCorrelation: typeof observed.correlationToken === "string" }, { catalogReference: selected.providerPlanReference, hasCorrelation: true });
    assert.equal((await service.checkout({ ...input, providerCommercialOfferId: replacement.id })).kind, "conflict");
    assert.equal(calls, 1);
  } finally { db.close(); }
});

test("EPIC052 PASS3 binds Mercado Pago checkout to its exact persisted offer", async () => {
  const db = open();
  try {
    const entry = plan(db, "mp-exact", "mercadopago", 2500), selected = offer(db, entry.id, "mercadopago"), replacement = new BillingProviderCommercialOfferRepository(db).create({ catalogEntryId: entry.id, providerKind: "mercadopago", offerVersion: 2, currency: "ARS", amountMinor: 3500, interval: "year", providerPlanReference: "mp_replacement", readinessState: "ready", lifecycle: "sellable", at });
    let reference: string | null = null, calls = 0;
    const provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "mp_exact" }, { ...mercadoPagoBillingProviderCapabilities, requiresPayerEmailForCheckout: false });
    provider.createCheckoutSession = async input => { calls += 1; reference = input.catalogReference; return { kind: "success", providerObjectId: "mp_exact" }; };
    const a = account(db), service = operations(db, new BillingProviderRegistry([{ kind: "mercadopago", provider }]));
    const input = { workspaceId: a.workspaceId, catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "mp-exact", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c", amountMinor: 1, currency: "USD", providerPlanReference: "attacker_reference" };
    assert.equal((await service.checkout(input)).kind, "succeeded");
    assert.equal(reference, selected.providerPlanReference);
    assert.equal((await service.checkout({ ...input, providerCommercialOfferId: replacement.id })).kind, "conflict");
    assert.equal(calls, 1);
  } finally { db.close(); }
});

test("EPIC052 PASS3 rejects unsellable and mismatched offers without provider mutation", async () => {
  const db = open();
  try {
    const stripe = plan(db, "sellable", "stripe"), other = plan(db, "other", "stripe"), selected = new BillingProviderCommercialOfferRepository(db).create({ catalogEntryId: stripe.id, providerKind: "stripe", offerVersion: 2, currency: "USD", amountMinor: 100, interval: "month", providerPlanReference: "price_unsellable", readinessState: "invalid", lifecycle: "draft", at }), provider = new DeterministicFakeBillingProvider(), service = operations(db, new BillingProviderRegistry([{ kind: "stripe", provider }])), a = account(db);
    const base = { workspaceId: a.workspaceId, catalogEntryId: stripe.id, providerCommercialOfferId: selected.id, operationId: "retired", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" };
    assert.equal((await service.checkout(base)).kind, "invalid");
    assert.equal((await service.checkout({ ...base, operationId: "mismatch", providerCommercialOfferId: offer(db, other.id, "stripe").id })).kind, "invalid");
    assert.equal(provider.calls.length, 0);
  } finally { db.close(); }
});

test("EPIC052 PASS3 replays and preserves uncertain checkout operations without double billing", async () => {
  const db = open();
  try {
    const entry = plan(db, "uncertain-create", "stripe"), selected = offer(db, entry.id, "stripe"), provider = new DeterministicFakeBillingProvider({ kind: "uncertain" }), service = operations(db, new BillingProviderRegistry([{ kind: "stripe", provider }])), a = account(db);
    const input = { workspaceId: a.workspaceId, catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "uncertain", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" };
    assert.equal((await service.checkout(input)).kind, "uncertain");
    assert.equal((await service.checkout(input)).kind, "uncertain");
    assert.equal(provider.calls.length, 1);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_operations WHERE billing_account_id=?").get(a.id) as { count: number }).count, 1);
  } finally { db.close(); }
});

test("EPIC052 PASS3 accepts only verified, matched Stripe webhooks and never grants entitlement directly", () => {
  const db = open();
  try {
    const entry = plan(db, "webhook", "stripe"), selected = offer(db, entry.id, "stripe"), a = account(db), repository = new BillingOperationRepository(db), pending = repository.createOrReplay({ billingAccountId: a.id, kind: "checkout_session_create", providerKind: "stripe", operationId: "webhook", fingerprint: "a".repeat(64), catalogEntryId: entry.id, providerCommercialOfferId: selected.id, at }).operation!, started = repository.start(pending.id, pending.version, at)!;
    const service = new BillingWebhookService({ stripe: "secret", mercadopago: "mp-secret" }, new BillingWebhookRepository(db), () => at);
    const signed = (payload: unknown) => { const raw = Buffer.from(JSON.stringify(payload)); const signature = createHmac("sha256", "secret").update(`${stripeTimestamp}.`).update(raw).digest("hex"); return { raw, headers: { "stripe-signature": `t=${stripeTimestamp},v1=${signature}` } }; };
    const before = db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(a.id);
    const early = signed({ id: "evt_early", type: "customer.subscription.updated", data: { object: { id: "sub_early", customer: "cus_early" } } });
    assert.equal(service.receive("stripe", early.raw, early.headers), "ignored");
    const complete = signed({ id: "evt_complete", type: "checkout.session.completed", data: { object: { id: "cs_webhook", subscription: "sub_webhook", customer: "cus_webhook", client_reference_id: started.recoveryCorrelationToken } } });
    assert.equal(service.receive("stripe", complete.raw, complete.headers), "accepted");
    assert.equal(service.receive("stripe", complete.raw, complete.headers), "duplicate");
    assert.equal(service.receive("stripe", Buffer.from("{"), { "stripe-signature": "bad" }), "invalid");
    const unmatched = signed({ id: "evt_unmatched", type: "customer.subscription.updated", data: { object: { id: "sub_unknown", customer: "cus_unknown" } } });
    assert.equal(service.receive("stripe", unmatched.raw, unmatched.headers), "ignored");
    assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(a.id), before);
    assert.equal((db.prepare("SELECT provider_commercial_offer_id FROM billing_checkout_enrollments WHERE checkout_operation_id=?").get(pending.id) as { provider_commercial_offer_id: string }).provider_commercial_offer_id, selected.id);
  } finally { db.close(); }
});

test("EPIC052 PASS3 reconciles exact Stripe and Mercado Pago commercial references only", async () => {
  for (const kind of ["stripe", "mercadopago"] as const) {
    const db = open();
    try {
      const entry = plan(db, `good-${kind}`, kind), selected = offer(db, entry.id, kind), a = account(db), subscriptionId = `sub_good_${kind}`;
      enroll(db, { accountId: a.id, entryId: entry.id, offerId: selected.id, kind, subscriptionId, suffix: `good_${kind}` });
      const provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "unused" }, kind === "stripe" ? stripeBillingProviderCapabilities : { ...mercadoPagoBillingProviderCapabilities, requiresPayerEmailForCheckout: false }, evidence(subscriptionId, selected.providerPlanReference));
      assert.equal(await new BillingReconciliationWorker(new BillingReconciliationRepository(db), new BillingProviderRegistry([{ kind, provider }]), () => at).runNext(), "applied");
      const managed = db.prepare("SELECT rollout_mode,provider_kind FROM billing_accounts WHERE id=?").get(a.id) as { rollout_mode: string; provider_kind: string };
      assert.equal(managed.rollout_mode, "managed");
      assert.equal(managed.provider_kind, kind);
      assert.equal((db.prepare("SELECT provider_commercial_offer_id FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(a.id) as { provider_commercial_offer_id: string }).provider_commercial_offer_id, selected.id);
    } finally { db.close(); }
  }
});

test("EPIC052 PASS3 rejects wrong provider commercial evidence and retries uncertain reads for both providers", async () => {
  for (const kind of ["stripe", "mercadopago"] as const) {
    const db = open();
    try {
      const entry = plan(db, `bad-${kind}`, kind), selected = offer(db, entry.id, kind), a = account(db), subscriptionId = `sub_bad_${kind}`;
      enroll(db, { accountId: a.id, entryId: entry.id, offerId: selected.id, kind, subscriptionId, suffix: `bad_${kind}` });
      const capabilities = kind === "stripe" ? stripeBillingProviderCapabilities : { ...mercadoPagoBillingProviderCapabilities, requiresPayerEmailForCheckout: false };
      const wrong = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "unused" }, capabilities, evidence(subscriptionId, "wrong_reference"));
      assert.equal(await new BillingReconciliationWorker(new BillingReconciliationRepository(db), new BillingProviderRegistry([{ kind, provider: wrong }]), () => at).runNext(), "retry");
      assert.equal((db.prepare("SELECT rollout_mode FROM billing_accounts WHERE id=?").get(a.id) as { rollout_mode: string }).rollout_mode, "unmanaged");
      db.prepare("UPDATE billing_reconciliation_work SET next_attempt_at=? WHERE billing_account_id=?").run(at, a.id);
      const uncertain = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "unused" }, capabilities, { kind: "uncertain" });
      assert.equal(await new BillingReconciliationWorker(new BillingReconciliationRepository(db), new BillingProviderRegistry([{ kind, provider: uncertain }]), () => at).runNext(), "retry");
      assert.equal((db.prepare("SELECT safe_failure_code FROM billing_reconciliation_work WHERE billing_account_id=?").get(a.id) as { safe_failure_code: string }).safe_failure_code, "uncertain");
    } finally { db.close(); }
  }
});

test("EPIC052 PASS3 preserves an historical offer binding after a newer price is published", async () => {
  const db = open();
  try {
    const entry = plan(db, "historical", "stripe"), old = offer(db, entry.id, "stripe"), newest = new BillingProviderCommercialOfferRepository(db).create({ catalogEntryId: entry.id, providerKind: "stripe", offerVersion: 2, currency: "USD", amountMinor: 200, interval: "year", providerPlanReference: "price_new", readinessState: "ready", lifecycle: "sellable", at }), a = account(db), subscriptionId = "sub_historical";
    enroll(db, { accountId: a.id, entryId: entry.id, offerId: old.id, kind: "stripe", subscriptionId, suffix: "historical" });
    const provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "unused" }, stripeBillingProviderCapabilities, evidence(subscriptionId, old.providerPlanReference));
    assert.equal(await new BillingReconciliationWorker(new BillingReconciliationRepository(db), new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at).runNext(), "applied");
    assert.notEqual(old.id, newest.id);
    assert.equal((db.prepare("SELECT provider_commercial_offer_id FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(a.id) as { provider_commercial_offer_id: string }).provider_commercial_offer_id, old.id);
  } finally { db.close(); }
});

test("EPIC052 PASS3 isolates reconciliation work in a mixed batch", async () => {
  const db = open();
  try {
    const entry = plan(db, "batch", "stripe"), selected = offer(db, entry.id, "stripe"), first = account(db), workspace = new WorkspaceRepository(db).create({ publicId: "wsp_pass3_batch", key: "pass3-batch", name: "PASS3 batch", timezone: null, defaultLocale: null }), second = account(db, workspace.id);
    enroll(db, { accountId: first.id, entryId: entry.id, offerId: selected.id, kind: "stripe", subscriptionId: "sub_batch_a", suffix: "batch_a" });
    enroll(db, { accountId: second.id, entryId: entry.id, offerId: selected.id, kind: "stripe", subscriptionId: "sub_batch_b", suffix: "batch_b" });
    const provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "unused" }, stripeBillingProviderCapabilities, { kind: "uncertain" });
    provider.readSubscription = async input => evidence(input.subscriptionReference, input.subscriptionReference === "sub_batch_a" ? selected.providerPlanReference : "wrong_reference");
    assert.deepEqual(await new BillingReconciliationWorker(new BillingReconciliationRepository(db), new BillingProviderRegistry([{ kind: "stripe", provider }]), () => at).runBatch(2), ["applied", "retry"]);
    assert.equal((db.prepare("SELECT rollout_mode FROM billing_accounts WHERE id=?").get(first.id) as { rollout_mode: string }).rollout_mode, "managed");
    assert.equal((db.prepare("SELECT rollout_mode FROM billing_accounts WHERE id=?").get(second.id) as { rollout_mode: string }).rollout_mode, "unmanaged");
  } finally { db.close(); }
});

test("EPIC052 PASS3 retains only safe billing projections and redacts raw webhook payloads", async () => {
  const db = open();
  try {
    const a = account(db), service = asyncBillingApplication(db, new BillingProviderRegistry(), { checkoutSuccess: "https://atlas.test/s", checkoutCancel: "https://atlas.test/c", portalReturn: "https://atlas.test/p" }, () => at);
    assert.deepEqual(await service.summary(a.workspaceId), { rolloutMode: "unmanaged", subscription: { state: "unmanaged", plan: null } });
    assert.deepEqual((db.prepare("PRAGMA table_info(billing_provider_events)").all() as Array<{ name: string }>).map(column => column.name).filter(name => /payload|body/i.test(name)), ["payload_digest"]);
    assert.equal((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='billing_provider_events'").get() as { sql: string }).sql.includes("raw"), false);
  } finally { db.close(); }
});
