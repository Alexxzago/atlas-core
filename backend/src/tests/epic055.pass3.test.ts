import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DeterministicFakeBillingProvider, mercadoPagoBillingProviderCapabilities } from "../billing/application/billingProvider.js";
import { BillingProviderRegistry } from "../billing/application/billingProviderRegistry.js";
import { AsyncBillingReconciliationWorkerRepository } from "../billing/infrastructure/asyncBillingReconciliationWorkerPersistence.js";
import { MercadoPagoBillingProvider } from "../billing/providers/mercadoPagoBillingProvider.js";
import { AsyncBillingReconciliationWorker } from "../billing/services/asyncBillingReconciliationWorker.js";
import { runMigrations } from "../config/migrations.js";
import { SynchronousSqlDatabaseAdapter } from "../config/sqlDatabase.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingProviderCommercialOfferRepository } from "../repositories/billingRepository.js";
import { asyncBillingOperations } from "./helpers/asyncBillingTestComposition.js";

const at = "2026-09-21T00:00:00.000Z";
function open(): DatabaseSync { const database = new DatabaseSync(":memory:"); database.exec("PRAGMA foreign_keys=ON"); runMigrations(database); return database; }
function workspace(database: DatabaseSync): number { return (database.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number }).id; }
function offer(database: DatabaseSync) { const entry = new BillingCatalogRepository(database).create({ planKey: "mp-pass3", catalogVersion: 1, displayName: "MP", interval: "month", currency: "ARS", amountMinor: 2500, lifecycle: "active", maxCompanies: 1, maxAssistantProfiles: 1, maxActiveChannels: 1, mutationEligible: true, entitlementDefinitionVersion: 1, providerKind: "mercadopago", providerPriceId: "mp_plan_pass3" }); return { entry, offer: new BillingProviderCommercialOfferRepository(database).findForCatalogProvider(entry.id, "mercadopago")! }; }

test("EPIC055 PASS3 fails closed when Mercado Pago create returns mismatched optional commercial correlation", async () => {
  const provider = new MercadoPagoBillingProvider({ accessToken: "token", apiBaseUrl: "https://api.mercadopago.test", timeoutMs: 100, allowedRedirectOrigins: ["https://atlas.test", "https://mp.test"] }, async () => new Response(JSON.stringify({ id: "pre_mismatch", init_point: "https://mp.test/checkout", preapproval_plan_id: "other_plan", external_reference: "aco_expected" })));
  assert.deepEqual(await provider.createCheckoutSession({ idempotencyKey: "operation", catalogReference: "trusted_plan", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c", correlationToken: "aco_expected", payerEmail: "payer@example.test" }), { kind: "uncertain" });
});

test("EPIC055 PASS3 replaces a canceled Mercado Pago subscription only through ready enrollment reconciliation", async () => {
  const database = open();
  try {
    const { entry, offer: selected } = offer(database), account = new BillingAccountRepository(database).findByWorkspace(workspace(database))!, provider = new DeterministicFakeBillingProvider({ kind: "success", providerObjectId: "pre_replacement", redirectUrl: "https://mp.test/checkout" }, { ...mercadoPagoBillingProviderCapabilities, requiresPayerEmailForCheckout: false }, { kind: "success", evidence: { providerSubscriptionId: "pre_replacement", providerCommercialReference: selected.providerPlanReference, providerEvidenceState: "active", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false } }), registry = new BillingProviderRegistry([{ kind: "mercadopago", provider }]), service = asyncBillingOperations(database, registry, () => at);
    database.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='mercadopago' WHERE id=?").run(account.id);
    database.prepare("UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind='mercadopago',provider_subscription_id='pre_canceled',provider_evidence_state='canceled',effective_state='canceled' WHERE billing_account_id=?").run(entry.id, selected.id, account.id);
    const input = { workspaceId: workspace(database), catalogEntryId: entry.id, providerCommercialOfferId: selected.id, operationId: "replace-canceled", successTarget: "https://atlas.test/s", cancelTarget: "https://atlas.test/c" };
    assert.equal((await service.checkout(input)).kind, "succeeded");
    assert.equal((await service.checkout({ ...input, operationId: "duplicate" })).kind, "conflict");
    assert.equal(await new AsyncBillingReconciliationWorker(new AsyncBillingReconciliationWorkerRepository(new SynchronousSqlDatabaseAdapter(database)), registry, () => at).runNext("mp-replacement"), "applied");
    assert.deepEqual((database.prepare("SELECT provider_subscription_id,effective_state,is_current FROM billing_subscriptions WHERE billing_account_id=? ORDER BY is_current,id").all(account.id) as Array<Record<string, unknown>>).map(row => ({ ...row })), [{ provider_subscription_id: "pre_canceled", effective_state: "canceled", is_current: 0 }, { provider_subscription_id: "pre_replacement", effective_state: "active", is_current: 1 }]);
    assert.equal((database.prepare("SELECT entitlement_state FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(account.id) as { entitlement_state: string }).entitlement_state, "enabled");
  } finally { database.close(); }
});
