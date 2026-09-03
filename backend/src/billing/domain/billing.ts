export const rolloutModes = ["unmanaged", "managed"] as const;
export const providerEvidenceStates = ["checkout_pending", "trialing", "active", "past_due", "paused", "canceled", "unpaid", "incomplete", "incomplete_expired", "unknown"] as const;
export const effectiveSubscriptionStates = ["unmanaged", "trial", "active", "canceling_at_period_end", "grace", "paused", "payment_required", "canceled", "reconciliation_required"] as const;
export const entitlementStates = ["enabled", "grace_enabled", "restricted", "suspended", "unavailable"] as const;
export const billingIntervals = ["month", "year"] as const;

export type RolloutMode = typeof rolloutModes[number];
export type ProviderEvidenceState = typeof providerEvidenceStates[number];
export type EffectiveSubscriptionState = typeof effectiveSubscriptionStates[number];
export type EntitlementState = typeof entitlementStates[number];
export type BillingInterval = typeof billingIntervals[number];
export const billingProviderKinds = ["stripe", "mercadopago"] as const;
export type BillingProviderKind = typeof billingProviderKinds[number];
export const billingProviderKind = (value: unknown): BillingProviderKind => closed(billingProviderKinds, value, "Billing provider kind");

function closed<T extends readonly string[]>(values: T, value: unknown, name: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${name} is invalid.`);
  return value as T[number];
}

export const rolloutMode = (value: unknown): RolloutMode => closed(rolloutModes, value, "Billing rollout mode");
export const providerEvidenceState = (value: unknown): ProviderEvidenceState => closed(providerEvidenceStates, value, "Provider evidence state");
export const effectiveSubscriptionState = (value: unknown): EffectiveSubscriptionState => closed(effectiveSubscriptionStates, value, "Billing effective subscription state");
export const entitlementState = (value: unknown): EntitlementState => closed(entitlementStates, value, "Billing entitlement state");
export const billingInterval = (value: unknown): BillingInterval => closed(billingIntervals, value, "Billing interval");

export function currencyCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/u.test(value)) throw new Error("Billing currency is invalid.");
  return value;
}

export function amountMinor(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Billing amount minor must be a non-negative integer.");
  return value;
}
