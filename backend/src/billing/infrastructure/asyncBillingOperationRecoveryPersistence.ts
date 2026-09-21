import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type { BillingOperation, RecoveryClaim } from "../../repositories/billingOperationRepository.js";
import type { BillingOperationKind } from "../domain/billingOperations.js";

type Row = Record<string, unknown>;

function text(row: Row, key: string): string | null { return row[key] === null || row[key] === undefined ? null : String(row[key]); }
function operation(row: Row): BillingOperation { return Object.freeze({ id: String(row.id), billingAccountId: String(row.billing_account_id), kind: row.operation_kind as BillingOperationKind, providerKind: row.provider_kind as BillingOperation["providerKind"], operationId: String(row.operation_id), fingerprint: String(row.request_fingerprint), providerIdempotencyKey: String(row.provider_idempotency_key), status: row.status as BillingOperation["status"], version: Number(row.version), providerObjectId: text(row, "provider_object_id"), safeResultJson: text(row, "safe_result_json"), catalogEntryId: text(row, "catalog_entry_id"), providerCommercialOfferId: text(row, "provider_commercial_offer_id"), successTarget: text(row, "success_target"), cancelTarget: text(row, "cancel_target"), targetSubscriptionId: text(row, "target_subscription_id"), recoveryCorrelationToken: text(row, "recovery_correlation_token"), requestStartedAt: text(row, "request_started_at"), recoveryNextAttemptAt: text(row, "recovery_next_attempt_at") }); }

/** Async persistence boundary for recovery only; checkout command persistence remains unchanged. */
export class AsyncBillingOperationRecoveryRepository {
  public constructor(private readonly database: SqlDatabase) {}

  public async claimRecovery(owner: string, now: string, staleBefore: string, leaseExpiresAt: string): Promise<RecoveryClaim | null> {
    return this.database.transaction(async database => {
      const row = (await database.query<Row>("SELECT * FROM billing_operations WHERE (recovery_lease_token IS NULL OR recovery_lease_expires_at<=?) AND ((status='uncertain' AND recovery_next_attempt_at<=?) OR (status='request_started' AND request_started_at<=?)) ORDER BY COALESCE(recovery_next_attempt_at,request_started_at),id LIMIT 1", [now, now, staleBefore]))[0];
      if (!row) return null;
      const token = `bor_${randomUUID().replaceAll("-", "")}`;
      const changed = await database.execute("UPDATE billing_operations SET recovery_lease_token=?,recovery_lease_expires_at=?,recovery_attempt_count=recovery_attempt_count+1,version=version+1,updated_at=? WHERE id=? AND (recovery_lease_token IS NULL OR recovery_lease_expires_at<=?)", [token, leaseExpiresAt, now, String(row.id), now]);
      if (Number(changed.rowsAffected) !== 1) return null;
      const current = await this.byId(database, String(row.id));
      if (!current) return null;
      const attempts = (await database.query<Row>("SELECT recovery_attempt_count FROM billing_operations WHERE id=?", [current.id]))[0];
      return Object.freeze({ operation: current, leaseToken: token, version: current.version, attemptCount: Number(attempts?.recovery_attempt_count) });
    });
  }

  public async retryRecovery(claim: RecoveryClaim, next: string, code: string, at: string): Promise<boolean> { return Number((await this.database.execute("UPDATE billing_operations SET status='uncertain',recovery_next_attempt_at=?,recovery_safe_failure_code=?,recovery_lease_token=NULL,recovery_lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND recovery_lease_token=? AND version=? AND recovery_lease_expires_at>?", [next, code, at, claim.operation.id, claim.leaseToken, claim.version, at])).rowsAffected) === 1; }
  public async releaseRecoveryWindowExpired(claim: RecoveryClaim, at: string): Promise<boolean> { return this.retryRecovery(claim, "9999-12-31T23:59:59.999Z", "recovery_window_expired", at); }
  public async targetProviderReference(value: BillingOperation): Promise<string | null> { if (!value.targetSubscriptionId) return null; const row = (await this.database.query<Row>("SELECT provider_subscription_id FROM billing_subscriptions WHERE id=? AND billing_account_id=? AND provider_kind=?", [value.targetSubscriptionId, value.billingAccountId, value.providerKind]))[0]; return row ? text(row, "provider_subscription_id") : null; }
  public async checkoutProviderReference(value: BillingOperation): Promise<string | null> { const offerId = value.providerCommercialOfferId ?? (value.catalogEntryId ? String((await this.database.query<Row>("SELECT id FROM billing_provider_commercial_offers WHERE catalog_entry_id=? AND provider_kind=? AND lifecycle_state='sellable' AND readiness_state='ready' ORDER BY offer_version DESC LIMIT 1", [value.catalogEntryId, value.providerKind]))[0]?.id ?? "") : ""); if (!offerId) return null; const row = (await this.database.query<Row>("SELECT provider_plan_reference FROM billing_provider_commercial_offers WHERE id=? AND provider_kind=?", [offerId, value.providerKind]))[0]; return row ? text(row, "provider_plan_reference") : null; }

  public async succeedRecovered(claim: RecoveryClaim, objectId: string, safeResultJson: string | null, at: string): Promise<BillingOperation | null> {
    const changed = await this.database.execute("UPDATE billing_operations SET status='succeeded',provider_object_id=?,safe_result_json=?,settled_at=?,recovery_lease_token=NULL,recovery_lease_expires_at=NULL,recovery_safe_failure_code=NULL,version=version+1,updated_at=? WHERE id=? AND status IN ('uncertain','request_started') AND recovery_lease_token=? AND version=? AND recovery_lease_expires_at>?", [objectId, safeResultJson, at, at, claim.operation.id, claim.leaseToken, claim.version, at]);
    const settled = Number(changed.rowsAffected) === 1 ? await this.byId(this.database, claim.operation.id) : null;
    if (settled && settled.kind !== "checkout_session_create") await this.enqueue(settled.billingAccountId, settled.providerKind, objectId, at);
    return settled;
  }

  public async succeedRecoveredCheckout(claim: RecoveryClaim, objectId: string, safeResultJson: string | null, at: string): Promise<BillingOperation | null> {
    return this.database.transaction(async database => {
      const changed = await database.execute("UPDATE billing_operations SET status='succeeded',provider_object_id=?,safe_result_json=?,settled_at=?,recovery_lease_token=NULL,recovery_lease_expires_at=NULL,recovery_safe_failure_code=NULL,version=version+1,updated_at=? WHERE id=? AND status IN ('uncertain','request_started') AND recovery_lease_token=? AND version=? AND recovery_lease_expires_at>?", [objectId, safeResultJson, at, at, claim.operation.id, claim.leaseToken, claim.version, at]);
      if (Number(changed.rowsAffected) !== 1) return null;
      const settled = await this.byId(database, claim.operation.id);
      if (!settled || !settled.catalogEntryId || !settled.providerCommercialOfferId) return null;
      const ready = settled.providerKind === "mercadopago";
      await database.execute("INSERT INTO billing_checkout_enrollments(id,billing_account_id,catalog_entry_id,provider_commercial_offer_id,checkout_operation_id,provider_kind,provider_checkout_object_id,provider_subscription_id,provider_customer_id,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(provider_kind,provider_checkout_object_id) DO NOTHING", [`bce_${randomUUID().replaceAll("-", "")}`, settled.billingAccountId, settled.catalogEntryId, settled.providerCommercialOfferId, settled.id, settled.providerKind, objectId, ready ? objectId : null, null, ready ? "ready" : "pending", at, at]);
      if (ready) await this.enqueue(settled.billingAccountId, settled.providerKind, objectId, at, database);
      return settled;
    });
  }

  private async byId(database: SqlDatabase, id: string): Promise<BillingOperation | null> { const row = (await database.query<Row>("SELECT * FROM billing_operations WHERE id=?", [id]))[0]; return row ? operation(row) : null; }
  private async enqueue(accountId: string, provider: BillingOperation["providerKind"], objectId: string, at: string, database: SqlDatabase = this.database): Promise<void> { const key = `provider_event:${provider}:${accountId}`; await database.execute("INSERT INTO billing_reconciliation_work(id,billing_account_id,provider_kind,reason,provider_object_id,coalesce_key,status,attempt_count,lease_owner,lease_token,lease_expires_at,next_attempt_at,safe_failure_code,version,wake_generation,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',0,NULL,NULL,NULL,?,NULL,1,1,?,?) ON CONFLICT(coalesce_key) DO UPDATE SET provider_object_id=excluded.provider_object_id,wake_generation=billing_reconciliation_work.wake_generation+1,next_attempt_at=MIN(billing_reconciliation_work.next_attempt_at,excluded.next_attempt_at),updated_at=excluded.updated_at", [`brw_${randomUUID().replaceAll("-", "")}`, accountId, provider, "checkout_enrollment", objectId, key, at, at, at]); }
}
