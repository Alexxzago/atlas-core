import { randomUUID } from "node:crypto";
import type { BillingProviderRegistry } from "../application/billingProviderRegistry.js";
import { effectiveSubscriptionStateForEvidence, type BillingSubscriptionEvidence } from "../domain/effectiveSubscriptionMapper.js";
import type { AsyncReconciliationClaim } from "../infrastructure/asyncBillingPersistence.js";
import { AsyncBillingReconciliationWorkerRepository } from "../infrastructure/asyncBillingReconciliationWorkerPersistence.js";
import type { BillingReconciliationRunResult } from "./billingReconciliationWorker.js";

/** Runs durable reconciliation through the async SQL boundary. */
export class AsyncBillingReconciliationWorker {
  public constructor(private readonly work: AsyncBillingReconciliationWorkerRepository, private readonly providers: BillingProviderRegistry, private readonly now: () => string = () => new Date().toISOString(), private readonly leaseMilliseconds = 60_000) {}

  public async runNext(owner = `billing-reconciliation-${randomUUID()}`): Promise<BillingReconciliationRunResult> {
    const now = this.now(), claim = await this.work.claimNext(owner, now, new Date(new Date(now).getTime() + this.leaseMilliseconds).toISOString());
    if (!claim) return "no_work";
    const subscription = await this.work.trustedSubscription(claim), enrollment = subscription?.effective_state === "canceled" ? await this.work.trustedEnrollment(claim) : subscription ? null : await this.work.trustedEnrollment(claim), canonical = enrollment ? null : subscription, reference = canonical?.provider_subscription_id ?? enrollment?.provider_subscription_id, provider = this.providers.get((canonical?.provider_kind ?? enrollment?.provider_kind) as "stripe" | "mercadopago");
    if (!reference || !provider) return this.retry(claim, "invalid_linkage");
    const read = await provider.readSubscription({ subscriptionReference: String(reference) });
    if (read.kind === "not_found") {
      if (enrollment) return this.retry(claim, "not_found");
      const evidence: BillingSubscriptionEvidence = { providerSubscriptionId: String(reference), providerEvidenceState: "unknown", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false };
      return this.work.apply(claim, canonical!, evidence, "reconciliation_required", this.now());
    }
    if (read.kind !== "success") return this.retry(claim, read.kind === "failed" ? read.code : "uncertain");
    if (read.evidence.providerSubscriptionId !== reference) return this.retry(claim, "invalid_evidence");
    if (enrollment && !await this.work.matchesEnrollmentCommercialEvidence(enrollment, read.evidence.providerCommercialReference)) return this.retry(claim, "commercial_mismatch");
    if (canonical && !await this.work.matchesSubscriptionCommercialEvidence(canonical, read.evidence.providerCommercialReference)) return this.retry(claim, "commercial_mismatch");
    return enrollment ? this.work.applyEnrollment(claim, enrollment, read.evidence, effectiveSubscriptionStateForEvidence(read.evidence), this.now()) : this.work.apply(claim, canonical!, read.evidence, effectiveSubscriptionStateForEvidence(read.evidence), this.now());
  }

  public async runBatch(limit = 25, ownerPrefix = "billing-reconciliation"): Promise<readonly BillingReconciliationRunResult[]> { const results: BillingReconciliationRunResult[] = []; for (let index = 0; index < Math.min(limit, 25); index += 1) { const result = await this.runNext(`${ownerPrefix}-${index}`); if (result === "no_work") break; results.push(result); } return results; }
  private async retry(claim: AsyncReconciliationClaim, code: string): Promise<BillingReconciliationRunResult> { const now = this.now(); return await this.work.retry(claim, now, backoff(now, claim.attemptCount), code) ? "retry" : "lost_lease"; }
}

function backoff(now: string, attempt: number): string { return new Date(new Date(now).getTime() + Math.min(60, 2 ** Math.max(0, attempt - 1)) * 60_000).toISOString(); }
