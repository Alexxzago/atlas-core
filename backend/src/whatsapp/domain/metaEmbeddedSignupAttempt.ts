import type { AssistantProfileId } from "../../assistant/domain/assistantProfile.js";
import type { UserId } from "../../identity/domain/user.js";
import type { IntegrationConnectionId } from "../../integrations/domain/integrationConnection.js";
import type { WhatsAppConnectionId } from "./whatsappConnection.js";

export type MetaEmbeddedSignupAttemptId = string & { readonly __brand: "MetaEmbeddedSignupAttemptId" };
export type MetaEmbeddedSignupAttemptStatus = "started" | "completing" | "completed" | "failed" | "expired";
export type MetaEmbeddedSignupAttemptFailureCode = "cancelled" | "expired" | "verification_failed" | "provider_rejected" | "provider_unavailable";

export interface MetaEmbeddedSignupAttempt {
  readonly id: MetaEmbeddedSignupAttemptId;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly initiatingUserId: UserId;
  readonly assistantProfileId: AssistantProfileId;
  readonly targetWhatsAppConnectionId: WhatsAppConnectionId | null;
  readonly targetIntegrationConnectionId: IntegrationConnectionId | null;
  readonly resolvedIntegrationConnectionId: IntegrationConnectionId | null;
  readonly provider: "meta_whatsapp";
  readonly kind: "cloud_api";
  readonly status: MetaEmbeddedSignupAttemptStatus;
  readonly stateDigest: string;
  readonly completionCodeDigest: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly expiredAt: string | null;
  readonly safeFailureCode: MetaEmbeddedSignupAttemptFailureCode | null;
  readonly version: number;
  readonly updatedAt: string;
}

export class MetaEmbeddedSignupAttemptDomainError extends Error {}

export function metaEmbeddedSignupAttemptId(value: string): MetaEmbeddedSignupAttemptId {
  if (!/^msa_[0-9a-f]{32}$/.test(value)) throw new MetaEmbeddedSignupAttemptDomainError("Meta Embedded Signup attempt identifier is invalid.");
  return value as MetaEmbeddedSignupAttemptId;
}

export function reconstructMetaEmbeddedSignupAttempt(value: MetaEmbeddedSignupAttempt): MetaEmbeddedSignupAttempt {
  if (!Number.isSafeInteger(value.workspaceId) || value.workspaceId < 1 || !Number.isSafeInteger(value.companyId) || value.companyId < 1 || !Number.isSafeInteger(value.version) || value.version < 1 || value.provider !== "meta_whatsapp" || value.kind !== "cloud_api" || !digest(value.stateDigest) || (value.completionCodeDigest !== null && !digest(value.completionCodeDigest))) throw new MetaEmbeddedSignupAttemptDomainError("Meta Embedded Signup attempt is invalid.");
  const status = attemptStatus(value.status), createdAt = timestamp(value.createdAt), expiresAt = timestamp(value.expiresAt), claimedAt = nullableTimestamp(value.claimedAt), completedAt = nullableTimestamp(value.completedAt), failedAt = nullableTimestamp(value.failedAt), expiredAt = nullableTimestamp(value.expiredAt), safeFailureCode = nullableFailureCode(value.safeFailureCode);
  if (expiresAt <= createdAt || (claimedAt === null) !== (value.completionCodeDigest === null) || !consistent(status, claimedAt, completedAt, failedAt, expiredAt, safeFailureCode)) throw new MetaEmbeddedSignupAttemptDomainError("Meta Embedded Signup attempt lifecycle is inconsistent.");
  return Object.freeze({ ...value, id: metaEmbeddedSignupAttemptId(value.id), targetIntegrationConnectionId: value.targetIntegrationConnectionId === null ? null : integrationConnectionId(value.targetIntegrationConnectionId), resolvedIntegrationConnectionId: value.resolvedIntegrationConnectionId === null ? null : integrationConnectionId(value.resolvedIntegrationConnectionId), status, createdAt, expiresAt, claimedAt, completedAt, failedAt, expiredAt, safeFailureCode, updatedAt: timestamp(value.updatedAt) });
}

export function metaEmbeddedSignupAttemptFailureCode(value: string): MetaEmbeddedSignupAttemptFailureCode {
  if (value === "cancelled" || value === "expired" || value === "verification_failed" || value === "provider_rejected" || value === "provider_unavailable") return value;
  throw new MetaEmbeddedSignupAttemptDomainError("Meta Embedded Signup failure code is invalid.");
}

function attemptStatus(value: string): MetaEmbeddedSignupAttemptStatus { if (value === "started" || value === "completing" || value === "completed" || value === "failed" || value === "expired") return value; throw new MetaEmbeddedSignupAttemptDomainError("Meta Embedded Signup attempt status is invalid."); }
function nullableFailureCode(value: string | null): MetaEmbeddedSignupAttemptFailureCode | null { return value === null ? null : metaEmbeddedSignupAttemptFailureCode(value); }
function digest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new MetaEmbeddedSignupAttemptDomainError("Meta Embedded Signup timestamp is invalid."); return value; }
function nullableTimestamp(value: string | null): string | null { return value === null ? null : timestamp(value); }
function integrationConnectionId(value: string): IntegrationConnectionId { if (!/^inc_[0-9a-f]{32}$/.test(value)) throw new MetaEmbeddedSignupAttemptDomainError("Meta Embedded Signup Integration Connection identifier is invalid."); return value as IntegrationConnectionId; }
function consistent(status: MetaEmbeddedSignupAttemptStatus, claimedAt: string | null, completedAt: string | null, failedAt: string | null, expiredAt: string | null, failureCode: MetaEmbeddedSignupAttemptFailureCode | null): boolean {
  return status === "started" ? claimedAt === null && completedAt === null && failedAt === null && expiredAt === null && failureCode === null
    : status === "completing" ? claimedAt !== null && completedAt === null && failedAt === null && expiredAt === null && failureCode === null
      : status === "completed" ? claimedAt !== null && completedAt !== null && failedAt === null && expiredAt === null && failureCode === null
        : status === "failed" ? completedAt === null && failedAt !== null && expiredAt === null && failureCode !== null
          : completedAt === null && failedAt === null && expiredAt !== null && failureCode === "expired";
}
