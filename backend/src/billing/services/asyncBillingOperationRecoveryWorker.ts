import type { BillingProviderRegistry } from "../application/billingProviderRegistry.js";
import type { RecoveryClaim } from "../../repositories/billingOperationRepository.js";
import { AsyncBillingOperationRecoveryRepository } from "../infrastructure/asyncBillingOperationRecoveryPersistence.js";

const minute = 60_000, stripeCheckoutRecoveryWindow = 23 * 60 * 60 * 1000, maximumProviderTimeout = 60_000, staleMargin = 60_000;
export const asyncBillingOperationRecoveryStaleMilliseconds = maximumProviderTimeout + staleMargin;

/** Recovers provider calls through async persistence while retaining lease and CAS fences. */
export class AsyncBillingOperationRecoveryWorker {
  public constructor(private readonly operations: AsyncBillingOperationRecoveryRepository, private readonly providers: BillingProviderRegistry, private readonly now: () => string = () => new Date().toISOString(), private readonly leaseMilliseconds = 60_000) {}

  public async runNext(owner = "billing-operation-recovery"): Promise<"no_work" | "succeeded" | "failed" | "retry" | "lost_lease"> {
    const now = this.now(), claim = await this.operations.claimRecovery(owner, now, new Date(new Date(now).getTime() - asyncBillingOperationRecoveryStaleMilliseconds).toISOString(), new Date(new Date(now).getTime() + this.leaseMilliseconds).toISOString());
    if (!claim) return "no_work";
    const value = claim.operation, provider = this.providers.get(value.providerKind);
    if (!provider?.recoverOperation) return this.retry(claim, "recovery_unsupported");
    if (value.kind === "checkout_session_create" && value.providerKind === "stripe" && value.requestStartedAt && new Date(now).getTime() - new Date(value.requestStartedAt).getTime() > stripeCheckoutRecoveryWindow) { await this.operations.releaseRecoveryWindowExpired(claim, now); return "retry"; }
    const target = await this.operations.targetProviderReference(value), catalogReference = value.kind === "checkout_session_create" ? await this.operations.checkoutProviderReference(value) : null;
    if (value.kind === "checkout_session_create" && !catalogReference) return this.retry(claim, "catalog_provider_mismatch");
    if (value.kind !== "checkout_session_create" && !target) return this.retry(claim, "invalid_target");
    const result = await provider.recoverOperation({ kind: value.kind, idempotencyKey: value.providerIdempotencyKey, catalogReference: catalogReference ?? undefined, successTarget: value.successTarget ?? undefined, cancelTarget: value.cancelTarget ?? undefined, correlationToken: value.recoveryCorrelationToken ?? undefined, subscriptionReference: target ?? undefined });
    if (result.kind === "success") { const safe = JSON.stringify({ providerObjectId: result.providerObjectId, ...(result.redirectUrl ? { redirectUrl: result.redirectUrl } : {}) }), settled = value.kind === "checkout_session_create" ? await this.operations.succeedRecoveredCheckout(claim, result.providerObjectId, safe, now) : await this.operations.succeedRecovered(claim, result.providerObjectId, safe, now); return settled ? "succeeded" : "lost_lease"; }
    if (result.kind === "failed") return await this.operations.retryRecovery(claim, "9999-12-31T23:59:59.999Z", result.code, now) ? "failed" : "lost_lease";
    return this.retry(claim, "uncertain");
  }

  public async runBatch(limit = 25, ownerPrefix = "billing-operation-recovery"): Promise<readonly string[]> { const values: string[] = []; for (let index = 0; index < Math.min(limit, 25); index += 1) { const result = await this.runNext(`${ownerPrefix}-${index}`); if (result === "no_work") break; values.push(result); } return values; }
  private async retry(claim: RecoveryClaim, code: string): Promise<"retry" | "lost_lease"> { const now = this.now(), next = new Date(new Date(now).getTime() + Math.min(60, 2 ** Math.max(0, claim.attemptCount - 1)) * minute).toISOString(); return await this.operations.retryRecovery(claim, next, code, now) ? "retry" : "lost_lease"; }
}
