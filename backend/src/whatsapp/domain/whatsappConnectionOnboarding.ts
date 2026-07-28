import type { WhatsAppConnectionId } from "./whatsappConnection.js";

export type WhatsAppConnectionValidationState = "not_validated" | "valid" | "invalid";
export type WhatsAppConnectionHealthState = "inactive" | "healthy" | "degraded";
export type WhatsAppConnectionFailureCode = "credentials_invalid" | "provider_identity_mismatch" | "provider_unavailable";

export interface EncryptedWhatsAppConnectionCredentials {
  readonly whatsAppConnectionId: WhatsAppConnectionId;
  readonly encryptedAccessToken: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WhatsAppConnectionOperationalState {
  readonly whatsAppConnectionId: WhatsAppConnectionId;
  readonly validationState: WhatsAppConnectionValidationState;
  readonly validatedAt: string | null;
  readonly validationFailureCode: WhatsAppConnectionFailureCode | null;
  readonly healthState: WhatsAppConnectionHealthState;
  readonly lastProviderActivityAt: string | null;
  readonly lastWebhookActivityAt: string | null;
  readonly healthFailureCode: WhatsAppConnectionFailureCode | null;
  readonly updatedAt: string;
}

export class WhatsAppConnectionOnboardingDomainError extends Error {}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new WhatsAppConnectionOnboardingDomainError("WhatsApp onboarding timestamp is invalid.");
  }
  return value;
}

function nullableTimestamp(value: string | null): string | null {
  return value === null ? null : timestamp(value);
}

function encrypted(value: string): string {
  if (!value || Array.from(value).length > 16_384) {
    throw new WhatsAppConnectionOnboardingDomainError("Encrypted WhatsApp credentials are invalid.");
  }
  return value;
}

function validationState(value: string): WhatsAppConnectionValidationState {
  if (value !== "not_validated" && value !== "valid" && value !== "invalid") {
    throw new WhatsAppConnectionOnboardingDomainError("WhatsApp validation state is invalid.");
  }
  return value;
}

function healthState(value: string): WhatsAppConnectionHealthState {
  if (value !== "inactive" && value !== "healthy" && value !== "degraded") {
    throw new WhatsAppConnectionOnboardingDomainError("WhatsApp health state is invalid.");
  }
  return value;
}

function failureCode(value: WhatsAppConnectionFailureCode | null): WhatsAppConnectionFailureCode | null {
  if (value === null || value === "credentials_invalid" || value === "provider_identity_mismatch" || value === "provider_unavailable") {
    return value;
  }
  throw new WhatsAppConnectionOnboardingDomainError("WhatsApp failure code is invalid.");
}

export function reconstructEncryptedWhatsAppConnectionCredentials(value: EncryptedWhatsAppConnectionCredentials): EncryptedWhatsAppConnectionCredentials {
  return Object.freeze({ ...value, encryptedAccessToken: encrypted(value.encryptedAccessToken), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) });
}

export function reconstructWhatsAppConnectionOperationalState(value: WhatsAppConnectionOperationalState): WhatsAppConnectionOperationalState {
  const validation = validationState(value.validationState), validatedAt = nullableTimestamp(value.validatedAt), validationFailure = failureCode(value.validationFailureCode), health = healthState(value.healthState), healthFailure = failureCode(value.healthFailureCode);
  if ((validation === "not_validated") !== (validatedAt === null) || (validation === "invalid") !== (validationFailure !== null) || (validation !== "invalid" && validationFailure !== null) || (health === "degraded") !== (healthFailure !== null) || (health !== "degraded" && healthFailure !== null)) {
    throw new WhatsAppConnectionOnboardingDomainError("WhatsApp operational state is inconsistent.");
  }
  return Object.freeze({ ...value, validationState: validation, validatedAt, validationFailureCode: validationFailure, healthState: health, lastProviderActivityAt: nullableTimestamp(value.lastProviderActivityAt), lastWebhookActivityAt: nullableTimestamp(value.lastWebhookActivityAt), healthFailureCode: healthFailure, updatedAt: timestamp(value.updatedAt) });
}
