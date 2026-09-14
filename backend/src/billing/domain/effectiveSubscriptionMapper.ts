import type { EffectiveSubscriptionState, ProviderEvidenceState } from "./billing.js";

export interface BillingSubscriptionEvidence {
  readonly providerSubscriptionId: string;
  readonly providerCommercialReference?: string | null;
  readonly providerEvidenceState: ProviderEvidenceState;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly trialEndsAt: string | null;
  readonly cancelAtPeriodEnd: boolean;
}

export interface EffectiveSubscriptionEntitlement {
  readonly state: "enabled" | "grace_enabled" | "restricted";
  readonly mutationEligible: boolean;
}

export function effectiveSubscriptionStateForEvidence(evidence: BillingSubscriptionEvidence): EffectiveSubscriptionState {
  switch (evidence.providerEvidenceState) {
    case "trialing": return "trial";
    case "active": return evidence.cancelAtPeriodEnd ? "canceling_at_period_end" : "active";
    case "past_due": return "payment_required";
    case "paused": return "paused";
    case "canceled":
    case "incomplete_expired": return "canceled";
    case "unpaid":
    case "incomplete": return "payment_required";
    case "checkout_pending": return "payment_required";
    case "unknown": return "reconciliation_required";
  }
}

export function entitlementForEffectiveSubscription(state: EffectiveSubscriptionState): EffectiveSubscriptionEntitlement {
  if (state === "active" || state === "trial" || state === "canceling_at_period_end") return Object.freeze({state:"enabled",mutationEligible:true});
  if (state === "grace") return Object.freeze({state:"grace_enabled",mutationEligible:true});
  return Object.freeze({state:"restricted",mutationEligible:false});
}
