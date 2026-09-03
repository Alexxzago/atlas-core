import { createHash } from "node:crypto";

export const billingOperationKinds = ["checkout_session_create", "subscription_cancel_at_period_end", "subscription_reactivate"] as const;
export type BillingOperationKind = typeof billingOperationKinds[number];
export const billingOperationStatuses = ["pending", "request_started", "succeeded", "failed", "uncertain"] as const;
export type BillingOperationStatus = typeof billingOperationStatuses[number];

export type BillingOperationFingerprintInput =
  | { readonly billingAccountId:string; readonly operationKind:"checkout_session_create"; readonly catalogEntryId:string; readonly providerKind?:string; readonly redirectTarget:string; readonly cancelTarget?:string }
  | { readonly billingAccountId:string; readonly operationKind:"subscription_cancel_at_period_end"|"subscription_reactivate"; readonly subscriptionId:string; readonly providerKind?:string };
export function billingOperationFingerprint(value: BillingOperationFingerprintInput): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function billingProviderIdempotencyKey(billingAccountId: string, kind: BillingOperationKind, operationId: string): string { return `atlas_billing_v1_${createHash("sha256").update(`${billingAccountId}\n${kind}\n${operationId}`).digest("hex")}`; }
function canonical(value: unknown): string { if (value===null||typeof value==="string"||typeof value==="number"||typeof value==="boolean") return JSON.stringify(value); if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`; if(!value||typeof value!=="object")throw new Error("Billing operation fingerprint is invalid.");const record=value as Record<string,unknown>;return`{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`; }
