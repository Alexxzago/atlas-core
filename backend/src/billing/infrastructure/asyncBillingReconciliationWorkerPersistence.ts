import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type {
  EffectiveSubscriptionState,
  ProviderEvidenceState,
} from "../domain/billing.js";
import { entitlementForEffectiveSubscription } from "../domain/effectiveSubscriptionMapper.js";
import type { AsyncReconciliationClaim } from "./asyncBillingPersistence.js";

type Row = Record<string, unknown>;
export type AsyncReconciliationSettle =
  "applied" | "requeued" | "lost_lease" | "cas_lost";

/** Async equivalent of reconciliation settlement, retaining its lease, wake, and CAS fences. */
export class AsyncBillingReconciliationWorkerRepository {
  public constructor(private readonly database: SqlDatabase) {}
  public async claimNext(
    owner: string,
    now: string,
    leaseExpiresAt: string,
  ): Promise<AsyncReconciliationClaim | null> {
    return this.database.transaction(async (database) => {
      const row = (
        await database.query<Row>(
          "SELECT * FROM billing_reconciliation_work WHERE (status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_expires_at<=?) ORDER BY next_attempt_at,id LIMIT 1",
          [now, now],
        )
      )[0];
      if (!row) return null;
      const token = `brl_${randomUUID().replaceAll("-", "")}`,
        changed = await database.execute(
          "UPDATE billing_reconciliation_work SET status='leased',lease_owner=?,lease_token=?,lease_expires_at=?,attempt_count=attempt_count+1,version=version+1,updated_at=? WHERE id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_expires_at<=?))",
          [owner, token, leaseExpiresAt, now, String(row.id), now, now],
        );
      if (Number(changed.rowsAffected) !== 1) return null;
      const claim = (
        await database.query<Row>(
          "SELECT * FROM billing_reconciliation_work WHERE id=?",
          [String(row.id)],
        )
      )[0]!;
      return Object.freeze({
        id: String(claim.id),
        billingAccountId: String(claim.billing_account_id),
        providerKind:
          claim.provider_kind as AsyncReconciliationClaim["providerKind"],
        leaseToken: token,
        version: Number(claim.version),
        wakeGeneration: Number(claim.wake_generation),
        attemptCount: Number(claim.attempt_count),
      });
    });
  }
  public async trustedSubscription(
    claim: AsyncReconciliationClaim,
  ): Promise<Row | null> {
    return (
      (
        await this.database.query<Row>(
          "SELECT * FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1 AND provider_kind=? AND provider_subscription_id IS NOT NULL",
          [claim.billingAccountId, claim.providerKind],
        )
      )[0] ?? null
    );
  }
  public async trustedEnrollment(
    claim: AsyncReconciliationClaim,
  ): Promise<Row | null> {
    return (
      (
        await this.database.query<Row>(
          "SELECT * FROM billing_checkout_enrollments WHERE billing_account_id=? AND provider_kind=? AND status='ready' AND provider_subscription_id IS NOT NULL ORDER BY created_at,id LIMIT 1",
          [claim.billingAccountId, claim.providerKind],
        )
      )[0] ?? null
    );
  }
  public async matchesEnrollmentCommercialEvidence(
    enrollment: Row,
    reference: string | null | undefined,
  ): Promise<boolean> {
    const operation = (
      await this.database.query<Row>(
        "SELECT provider_commercial_offer_id FROM billing_operations WHERE id=?",
        [String(enrollment.checkout_operation_id)],
      )
    )[0];
    return (
      !operation?.provider_commercial_offer_id ||
      (typeof reference === "string" &&
        (
          await this.database.query<Row>(
            "SELECT 1 FROM billing_provider_commercial_offers WHERE id=? AND provider_kind=? AND provider_plan_reference=?",
            [
              String(operation.provider_commercial_offer_id),
              String(enrollment.provider_kind),
              reference,
            ],
          )
        ).length > 0)
    );
  }
  public async matchesSubscriptionCommercialEvidence(
    subscription: Row,
    reference: string | null | undefined,
  ): Promise<boolean> {
    return (
      typeof reference === "string" &&
      subscription.provider_commercial_offer_id !== null &&
      (
        await this.database.query<Row>(
          "SELECT 1 FROM billing_provider_commercial_offers WHERE id=? AND provider_kind=? AND provider_plan_reference=?",
          [
            String(subscription.provider_commercial_offer_id),
            String(subscription.provider_kind),
            reference,
          ],
        )
      ).length > 0
    );
  }
  public async retry(
    claim: AsyncReconciliationClaim,
    now: string,
    next: string,
    code: string,
  ): Promise<boolean> {
    return (
      Number(
        (
          await this.database.execute(
            "UPDATE billing_reconciliation_work SET status='pending',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,safe_failure_code=?,version=version+1,updated_at=? WHERE id=? AND status='leased' AND lease_token=? AND version=? AND lease_expires_at>?",
            [next, code, now, claim.id, claim.leaseToken, claim.version, now],
          )
        ).rowsAffected,
      ) === 1
    );
  }
  public async apply(
    claim: AsyncReconciliationClaim,
    value: Row,
    evidence: {
      providerEvidenceState: ProviderEvidenceState;
      currentPeriodStart: string | null;
      currentPeriodEnd: string | null;
      trialEndsAt: string | null;
      cancelAtPeriodEnd: boolean;
    },
    state: EffectiveSubscriptionState,
    at: string,
  ): Promise<AsyncReconciliationSettle> {
    return this.database.transaction(async (database) => {
      if (!(await this.valid(database, claim, at))) return "lost_lease";
      if (await this.woken(database, claim)) {
        await this.requeue(database, claim, at);
        return "requeued";
      }
      const same =
        value.provider_evidence_state === evidence.providerEvidenceState &&
        value.effective_state === state &&
        value.current_period_start === evidence.currentPeriodStart &&
        value.current_period_end === evidence.currentPeriodEnd &&
        value.trial_ends_at === evidence.trialEndsAt &&
        Number(value.cancel_at_period_end) ===
          (evidence.cancelAtPeriodEnd ? 1 : 0);
      if (!same) {
        const changed = await database.execute(
          "UPDATE billing_subscriptions SET provider_evidence_state=?,effective_state=?,current_period_start=?,current_period_end=?,trial_ends_at=?,cancel_at_period_end=?,version=version+1,updated_at=? WHERE id=? AND billing_account_id=? AND version=?",
          [
            evidence.providerEvidenceState,
            state,
            evidence.currentPeriodStart,
            evidence.currentPeriodEnd,
            evidence.trialEndsAt,
            evidence.cancelAtPeriodEnd ? 1 : 0,
            at,
            String(value.id),
            claim.billingAccountId,
            Number(value.version),
          ],
        );
        if (Number(changed.rowsAffected) !== 1) return "cas_lost";
        await this.project(
          database,
          String(value.catalog_entry_id ?? ""),
          claim.billingAccountId,
          state,
          String(value.id),
          at,
        );
      }
      return this.complete(database, claim, at);
    });
  }
  public async applyEnrollment(
    claim: AsyncReconciliationClaim,
    value: Row,
    evidence: {
      providerSubscriptionId: string;
      providerEvidenceState: ProviderEvidenceState;
      currentPeriodStart: string | null;
      currentPeriodEnd: string | null;
      trialEndsAt: string | null;
      cancelAtPeriodEnd: boolean;
    },
    state: EffectiveSubscriptionState,
    at: string,
  ): Promise<AsyncReconciliationSettle> {
    return this.database.transaction(async (database) => {
      if (!(await this.valid(database, claim, at))) return "lost_lease";
      if (await this.woken(database, claim)) {
        await this.requeue(database, claim, at);
        return "requeued";
      }
      const enrollment = (
          await database.query<Row>(
            "SELECT * FROM billing_checkout_enrollments WHERE id=?",
            [String(value.id)],
          )
        )[0],
        account = enrollment
          ? (
              await database.query<Row>(
                "SELECT * FROM billing_accounts WHERE id=?",
                [claim.billingAccountId],
              )
            )[0]
          : undefined,
        current = account
          ? (
              await database.query<Row>(
                "SELECT * FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1",
                [claim.billingAccountId],
              )
            )[0]
          : undefined;
      if (
        !enrollment ||
        enrollment.status !== "ready" ||
        enrollment.provider_subscription_id !==
          evidence.providerSubscriptionId ||
        String(enrollment.billing_account_id) !== claim.billingAccountId ||
        !(await this.trustedCommercial(database, enrollment)) ||
        !account ||
        !this.compatible(account, enrollment) ||
        !current ||
        !(
          (current.provider_kind === null &&
            current.provider_subscription_id === null) ||
          (current.effective_state === "canceled" &&
            current.provider_kind === enrollment.provider_kind &&
            current.provider_subscription_id !== null)
        )
      )
        return "cas_lost";
      if (
        Number(
          (
            await database.execute(
              "UPDATE billing_accounts SET rollout_mode='managed',provider_kind=?,provider_customer_id=COALESCE(provider_customer_id,?),version=version+1,updated_at=? WHERE id=? AND version=?",
              [
                String(enrollment.provider_kind),
                enrollment.provider_customer_id as string | null,
                at,
                String(account.id),
                Number(account.version),
              ],
            )
          ).rowsAffected,
        ) !== 1 ||
        Number(
          (
            await database.execute(
              "UPDATE billing_subscriptions SET is_current=0,version=version+1,updated_at=? WHERE id=? AND version=?",
              [at, String(current.id), Number(current.version)],
            )
          ).rowsAffected,
        ) !== 1
      )
        return "cas_lost";
      const subscriptionId = `bsub_${randomUUID().replaceAll("-", "")}`;
      await database.execute(
        "INSERT INTO billing_subscriptions(id,billing_account_id,catalog_entry_id,provider_commercial_offer_id,provider_kind,provider_subscription_id,provider_evidence_state,effective_state,current_period_start,current_period_end,trial_ends_at,grace_ends_at,cancel_at_period_end,is_current,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)",
        [
          subscriptionId,
          claim.billingAccountId,
          String(enrollment.catalog_entry_id),
          enrollment.provider_commercial_offer_id as string | null,
          String(enrollment.provider_kind),
          evidence.providerSubscriptionId,
          evidence.providerEvidenceState,
          state,
          evidence.currentPeriodStart,
          evidence.currentPeriodEnd,
          evidence.trialEndsAt,
          null,
          evidence.cancelAtPeriodEnd ? 1 : 0,
          at,
          at,
        ],
      );
      await database.execute(
        "UPDATE billing_checkout_enrollments SET status='consumed',version=version+1,updated_at=? WHERE id=? AND version=?",
        [at, String(enrollment.id), Number(enrollment.version)],
      );
      await this.project(
        database,
        String(enrollment.catalog_entry_id),
        claim.billingAccountId,
        state,
        subscriptionId,
        at,
      );
      return this.complete(database, claim, at);
    });
  }
  private compatible(account: Row, enrollment: Row): boolean {
    return (
      (account.rollout_mode === "unmanaged" &&
        account.provider_kind === null &&
        account.provider_customer_id === null) ||
      (account.rollout_mode === "managed" &&
        account.provider_kind === enrollment.provider_kind &&
        (account.provider_customer_id === null ||
          enrollment.provider_customer_id === null ||
          account.provider_customer_id === enrollment.provider_customer_id))
    );
  }
  private async trustedCommercial(
    database: SqlDatabase,
    enrollment: Row,
  ): Promise<boolean> {
    return (
      enrollment.provider_commercial_offer_id !== null ||
      (
        await database.query<Row>(
          "SELECT 1 FROM billing_catalog_entries WHERE id=? AND provider_kind=? AND provider_price_id IS NOT NULL",
          [
            String(enrollment.catalog_entry_id),
            String(enrollment.provider_kind),
          ],
        )
      ).length > 0
    );
  }
  private async project(
    database: SqlDatabase,
    catalogId: string,
    accountId: string,
    state: EffectiveSubscriptionState,
    subscriptionId: string,
    at: string,
  ): Promise<void> {
    const catalog = catalogId
        ? (
            await database.query<Row>(
              "SELECT * FROM billing_catalog_entries WHERE id=?",
              [catalogId],
            )
          )[0]
        : undefined,
      entitlement = entitlementForEffectiveSubscription(state);
    await database.execute(
      "UPDATE billing_entitlement_snapshots SET billing_subscription_id=?,entitlement_state=?,max_companies=?,max_assistant_profiles=?,max_active_channels=?,mutation_eligible=?,version=version+1,evaluated_at=?,effective_at=? WHERE billing_account_id=? AND is_current=1",
      [
        subscriptionId,
        entitlement.state,
        (catalog?.entitlement_max_companies as number | null | undefined) ??
          null,
        (catalog?.entitlement_max_assistant_profiles as
          number | null | undefined) ?? null,
        (catalog?.entitlement_max_active_channels as
          number | null | undefined) ?? null,
        entitlement.mutationEligible ? 1 : 0,
        at,
        at,
        accountId,
      ],
    );
  }
  private async valid(
    database: SqlDatabase,
    claim: AsyncReconciliationClaim,
    at: string,
  ): Promise<boolean> {
    const row = (
      await database.query<Row>(
        "SELECT status,lease_token,version,lease_expires_at FROM billing_reconciliation_work WHERE id=?",
        [claim.id],
      )
    )[0];
    return (
      !!row &&
      row.status === "leased" &&
      row.lease_token === claim.leaseToken &&
      Number(row.version) === claim.version &&
      typeof row.lease_expires_at === "string" &&
      row.lease_expires_at > at
    );
  }
  private async woken(
    database: SqlDatabase,
    claim: AsyncReconciliationClaim,
  ): Promise<boolean> {
    return (
      Number(
        (
          await database.query<Row>(
            "SELECT wake_generation FROM billing_reconciliation_work WHERE id=?",
            [claim.id],
          )
        )[0]!.wake_generation,
      ) !== claim.wakeGeneration
    );
  }
  private async complete(
    database: SqlDatabase,
    claim: AsyncReconciliationClaim,
    at: string,
  ): Promise<AsyncReconciliationSettle> {
    return Number(
      (
        await database.execute(
          "UPDATE billing_reconciliation_work SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,safe_failure_code=NULL,version=version+1,updated_at=? WHERE id=? AND status='leased' AND lease_token=? AND version=? AND wake_generation=? AND lease_expires_at>?",
          [at, claim.id, claim.leaseToken, claim.version, claim.wakeGeneration, at],
        )
      ).rowsAffected,
    ) === 1
      ? "applied"
      : "lost_lease";
  }
  private async requeue(
    database: SqlDatabase,
    claim: AsyncReconciliationClaim,
    at: string,
  ): Promise<void> {
    await database.execute(
      "UPDATE billing_reconciliation_work SET status='pending',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND version=?",
      [at, at, claim.id, claim.leaseToken, claim.version],
    );
  }
}
