export type IntegrationConnectionId = string & { readonly __brand: "IntegrationConnectionId" };
export type IntegrationConnectionStatus = "inactive" | "active";
export type IntegrationValidationState = "not_validated" | "valid" | "invalid";
export type IntegrationHealthState = "inactive" | "healthy" | "degraded";
export type IntegrationFailureCode = "credentials_invalid" | "provider_identity_mismatch" | "provider_unavailable" | "provider_timeout" | "provider_rejected";
export type IntegrationConnectionAuditEventType = "created" | "configured" | "secret_configured" | "validated" | "validation_failed" | "activated" | "deactivated";

export interface IntegrationConnection {
  readonly id: IntegrationConnectionId;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly provider: string;
  readonly kind: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly status: IntegrationConnectionStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationOperationalState {
  readonly connectionId: IntegrationConnectionId;
  readonly validationState: IntegrationValidationState;
  readonly validatedAt: string | null;
  readonly validationFailureCode: IntegrationFailureCode | null;
  readonly healthState: IntegrationHealthState;
  readonly healthFailureCode: IntegrationFailureCode | null;
  readonly lastProviderActivityAt: string | null;
  readonly updatedAt: string;
}

export class IntegrationConnectionDomainError extends Error {}

export function integrationConnectionId(value: string): IntegrationConnectionId {
  if (!/^inc_[0-9a-f]{32}$/.test(value)) throw new IntegrationConnectionDomainError("Integration Connection identifier is invalid.");
  return value as IntegrationConnectionId;
}

export function integrationProvider(value: string): string { return key(value, "Integration provider"); }
export function integrationKind(value: string): string { return key(value, "Integration kind"); }

export function reconstructIntegrationConnection(value: IntegrationConnection): IntegrationConnection {
  if (!Number.isSafeInteger(value.workspaceId) || value.workspaceId < 1 || !Number.isSafeInteger(value.companyId) || value.companyId < 1 || !Number.isSafeInteger(value.version) || value.version < 1) throw new IntegrationConnectionDomainError("Integration Connection ownership is invalid.");
  if (value.status !== "inactive" && value.status !== "active") throw new IntegrationConnectionDomainError("Integration Connection status is invalid.");
  return Object.freeze({ ...value, id: integrationConnectionId(value.id), provider: integrationProvider(value.provider), kind: integrationKind(value.kind), configuration: configuration(value.configuration), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) });
}

export function reconstructIntegrationOperationalState(value: IntegrationOperationalState): IntegrationOperationalState {
  if (!(["not_validated", "valid", "invalid"] as const).includes(value.validationState) || !(["inactive", "healthy", "degraded"] as const).includes(value.healthState)) throw new IntegrationConnectionDomainError("Integration operational state is invalid.");
  if ((value.validationState === "not_validated") !== (value.validatedAt === null)) throw new IntegrationConnectionDomainError("Integration validation state is invalid.");
  if ((value.validationState === "invalid") !== (value.validationFailureCode !== null) || (value.validationState === "valid" && value.validationFailureCode !== null)) throw new IntegrationConnectionDomainError("Integration validation failure is invalid.");
  if ((value.healthState === "degraded") !== (value.healthFailureCode !== null)) throw new IntegrationConnectionDomainError("Integration health failure is invalid.");
  return Object.freeze({ ...value, connectionId: integrationConnectionId(value.connectionId), validatedAt: value.validatedAt === null ? null : timestamp(value.validatedAt), lastProviderActivityAt: value.lastProviderActivityAt === null ? null : timestamp(value.lastProviderActivityAt), updatedAt: timestamp(value.updatedAt) });
}

function key(value: string, label: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!/^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/.test(normalized) || normalized.length > 100) throw new IntegrationConnectionDomainError(`${label} is invalid.`);
  return normalized;
}
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new IntegrationConnectionDomainError("Integration timestamp is invalid."); return value; }
function configuration(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (!value || Array.isArray(value) || Object.keys(value).length > 50 || JSON.stringify(value).length > 16_384 || containsSensitiveConfiguration(value, 0)) throw new IntegrationConnectionDomainError("Integration configuration is invalid.");
  return Object.freeze({ ...value });
}
function containsSensitiveConfiguration(value: unknown, depth: number): boolean {
  if (depth > 5) return true;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some(item => containsSensitiveConfiguration(item, depth + 1));
  if (typeof value !== "object") return true;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => /(?:token|secret|password|credential|api[_-]?key|authorization|cookie|private[_-]?key)/i.test(key) || containsSensitiveConfiguration(item, depth + 1));
}
