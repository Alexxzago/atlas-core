export type AssistantProfileId = string & { readonly __brand: "AssistantProfileId" };
export type AssistantProfileStatus = "draft" | "ready" | "disabled" | "archived";
export type AssistantTone = "professional" | "friendly" | "concise" | "empathetic";
export type AssistantLanguage = "es" | "en";

export interface AssistantProfile {
  readonly id: AssistantProfileId;
  readonly companyId: number;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly businessRole: string | null;
  readonly objective: string | null;
  readonly audience: string | null;
  readonly tone: AssistantTone;
  readonly assistantLanguage: AssistantLanguage;
  readonly welcomeMessage: string | null;
  readonly fallbackMessage: string;
  readonly status: AssistantProfileStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export class AssistantProfileDomainError extends Error {}

export function assistantProfileId(value: string): AssistantProfileId {
  if (!/^asp_[0-9a-f]{32}$/.test(value)) throw new AssistantProfileDomainError("Invalid Assistant Profile identifier.");
  return value as AssistantProfileId;
}

export function normalizeAssistantProfileName(name: string): string {
  return name.trim().toLowerCase();
}

export function assistantProfileStatus(value: string): AssistantProfileStatus {
  if (value !== "draft" && value !== "ready" && value !== "disabled" && value !== "archived") {
    throw new AssistantProfileDomainError("Invalid Assistant Profile status.");
  }
  return value;
}

export function assistantTone(value: string): AssistantTone {
  if (value !== "professional" && value !== "friendly" && value !== "concise" && value !== "empathetic") {
    throw new AssistantProfileDomainError("Invalid Assistant Profile tone.");
  }
  return value;
}

export function assistantLanguage(value: string): AssistantLanguage {
  if (value !== "es" && value !== "en") throw new AssistantProfileDomainError("Invalid Assistant language.");
  return value;
}

export function requiredProfileText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > maximum) {
    throw new AssistantProfileDomainError(`${field} must contain between 1 and ${maximum} characters.`);
  }
  return normalized;
}

export function nullableProfileText(value: string | null, field: string, maximum: number): string | null {
  if (value === null) return null;
  return requiredProfileText(value, field, maximum);
}

export function reconstructAssistantProfile(value: AssistantProfile): AssistantProfile {
  if (!Number.isInteger(value.companyId) || value.companyId <= 0) {
    throw new AssistantProfileDomainError("Invalid Company identifier.");
  }
  const id = assistantProfileId(value.id);
  const name = requiredProfileText(value.name, "Name", 80);
  const normalizedName = normalizeAssistantProfileName(name);
  if (value.normalizedName !== normalizedName) throw new AssistantProfileDomainError("Invalid normalized name.");
  const status = assistantProfileStatus(value.status);
  const archivedAt = value.archivedAt;
  if ((status === "archived") !== (archivedAt !== null)) {
    throw new AssistantProfileDomainError("Archived timestamp does not match status.");
  }
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt) || (archivedAt !== null && !isIsoTimestamp(archivedAt))) {
    throw new AssistantProfileDomainError("Invalid Assistant Profile timestamp.");
  }
  return Object.freeze({
    ...value,
    id,
    name,
    normalizedName,
    description: nullableProfileText(value.description, "Description", 240),
    businessRole: nullableProfileText(value.businessRole, "Business role", 120),
    objective: nullableProfileText(value.objective, "Objective", 500),
    audience: nullableProfileText(value.audience, "Audience", 300),
    tone: assistantTone(value.tone),
    assistantLanguage: assistantLanguage(value.assistantLanguage),
    welcomeMessage: nullableProfileText(value.welcomeMessage, "Welcome message", 500),
    fallbackMessage: requiredProfileText(value.fallbackMessage, "Fallback message", 500),
    status,
    archivedAt,
  });
}

function isIsoTimestamp(value: string): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
