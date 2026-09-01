import { createHash } from "node:crypto";

export type ProactiveActionId = string & { readonly __brand: "ProactiveActionId" };
export type ProactiveActionState = "scheduled" | "ready" | "leased" | "retryable" | "runtime_completed" | "awaiting_outbound" | "succeeded" | "cancelled" | "suppressed" | "permanent_failure" | "uncertain";
export type ProactiveActionOperation = "policy_update" | "create" | "cancel";
export type ProactiveActionOperationOutcome = "applied" | "stale_version" | "cancel_after_send_started";
export type ProactiveActionAuditEventType = "created" | "cancelled" | "claimed" | "retry_scheduled" | "suppressed" | "runtime_failed" | "outbound_reserved" | "outbound_accepted" | "outbound_uncertain" | "completed";

export interface ProactiveActionPolicy {
  readonly workspaceId: number;
  readonly companyId: number;
  readonly enabled: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProactiveAction {
  readonly id: ProactiveActionId;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly conversationId: string;
  readonly whatsAppConnectionId: string;
  readonly assistantProfileId: string;
  readonly assistantParticipantId: string;
  readonly intentKind: "follow_up";
  readonly runAt: string;
  readonly state: ProactiveActionState;
  readonly expectedAuthorityGeneration: number;
  readonly attemptCount: number;
  readonly nextAttemptAt: string;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseAcquiredAt: string | null;
  readonly leaseExpiresAt: string | null;
  readonly safeReasonCode: string | null;
  readonly assistantExecutionRecordId: string | null;
  readonly outboundMessageId: string | null;
  readonly outboundDeliveryId: string | null;
  readonly version: number;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProactiveActionLease {
  readonly action: ProactiveAction;
  readonly leaseToken: string;
}

export class ProactiveActionDomainError extends Error {}

export function proactiveActionId(value: string): ProactiveActionId {
  if (!/^pac_[0-9a-f]{32}$/.test(value)) throw new ProactiveActionDomainError("Proactive action identifier is invalid.");
  return value as ProactiveActionId;
}

export function proactiveActionOperationId(value: string): string {
  return bounded(value, "Proactive action operation ID", 200);
}

export function proactiveActionPositive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ProactiveActionDomainError(`${label} is invalid.`);
  return value;
}

export function proactiveActionTimestamp(value: string, label = "Proactive action timestamp"): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ProactiveActionDomainError(`${label} is invalid.`);
  return value;
}

export function proactiveActionFingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function proactiveActionPolicyFingerprint(input: { readonly actorId: string; readonly expectedVersion: number; readonly enabled: boolean }): string {
  return proactiveActionFingerprint({ actorId: bounded(input.actorId, "Proactive action actor", 128), expectedVersion: proactiveActionPositive(input.expectedVersion, "Proactive action expected version"), enabled: input.enabled });
}

export function proactiveActionCreateFingerprint(input: { readonly actorId: string; readonly conversationId: string; readonly whatsAppConnectionId: string; readonly assistantProfileId: string; readonly assistantParticipantId: string; readonly runAt: string; readonly intentKind: "follow_up" }): string {
  return proactiveActionFingerprint({ actorId: bounded(input.actorId, "Proactive action actor", 128), conversationId: bounded(input.conversationId, "Conversation ID", 200), whatsAppConnectionId: bounded(input.whatsAppConnectionId, "WhatsApp connection ID", 200), assistantProfileId: bounded(input.assistantProfileId, "Assistant Profile ID", 200), assistantParticipantId: bounded(input.assistantParticipantId, "Assistant participant ID", 200), runAt: proactiveActionTimestamp(input.runAt), intentKind: input.intentKind });
}

export function proactiveActionCancelFingerprint(input: { readonly actorId: string; readonly expectedVersion: number }): string {
  return proactiveActionFingerprint({ actorId: bounded(input.actorId, "Proactive action actor", 128), expectedVersion: proactiveActionPositive(input.expectedVersion, "Proactive action expected version") });
}

export function proactiveActionBounded(value: string, label: string, maximum: number): string {
  return bounded(value, label, maximum);
}

function bounded(value: string, label: string, maximum: number): string {
  const normalized = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!normalized || Array.from(normalized).length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) throw new ProactiveActionDomainError(`${label} is invalid.`);
  return normalized;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") throw new ProactiveActionDomainError("Proactive action fingerprint is invalid.");
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
