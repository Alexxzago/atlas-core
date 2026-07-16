import { randomUUID } from "node:crypto";
import type { Clock } from "../../identity/application/ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import {
  assistantLanguage,
  assistantProfileId,
  assistantProfileStatus,
  assistantTone,
  normalizeAssistantProfileName,
  nullableProfileText,
  reconstructAssistantProfile,
  requiredProfileText,
  type AssistantLanguage,
  type AssistantProfile,
  type AssistantProfileStatus,
  type AssistantTone,
} from "../domain/assistantProfile.js";
import { AssistantProfileLifecyclePolicy, AssistantProfilePolicyError, AssistantProfileReadyPolicy, nextUpdatedAt } from "../domain/assistantProfilePolicies.js";

export class AssistantProfileValidationError extends Error {}
export class AssistantProfileNotFoundError extends Error {}
export class AssistantProfileConflictError extends Error {}

interface AssistantProfileChanges {
  name?: string;
  description?: string | null;
  businessRole?: string | null;
  objective?: string | null;
  audience?: string | null;
  tone?: AssistantTone;
  assistantLanguage?: AssistantLanguage;
  welcomeMessage?: string | null;
  fallbackMessage?: string;
}

export class AssistantProfileService {
  private readonly readyPolicy = new AssistantProfileReadyPolicy();
  private readonly lifecyclePolicy = new AssistantProfileLifecyclePolicy();

  public constructor(private readonly profiles: AssistantProfileRepositoryPort, private readonly clock: Clock) {}

  public list(context: WorkspaceContext, companyIdValue: unknown): AssistantProfile[] {
    const result = this.profiles.listActive(context, parseCompanyId(companyIdValue));
    if (result.status === "company_not_found") throw new AssistantProfileNotFoundError("Company was not found.");
    return [...result.profiles];
  }

  public get(context: WorkspaceContext, companyIdValue: unknown, profileIdValue: unknown): AssistantProfile {
    const companyId = parseCompanyId(companyIdValue);
    const profileId = parseProfileId(profileIdValue);
    const profile = this.profiles.findById(context, companyId, profileId);
    if (!profile) throw new AssistantProfileNotFoundError("Assistant Profile was not found.");
    return profile;
  }

  public create(context: WorkspaceContext, companyIdValue: unknown, value: unknown): AssistantProfile {
    const companyId = parseCompanyId(companyIdValue);
    const input = createInput(value);
    const now = this.clock.now();
    const profile = reconstructAssistantProfile({
      id: assistantProfileId(`asp_${randomUUID().replaceAll("-", "")}`),
      companyId,
      name: input.name,
      normalizedName: normalizeAssistantProfileName(input.name),
      description: input.description ?? null,
      businessRole: input.businessRole ?? null,
      objective: input.objective ?? null,
      audience: input.audience ?? null,
      tone: input.tone ?? "professional",
      assistantLanguage: input.assistantLanguage,
      welcomeMessage: input.welcomeMessage ?? null,
      fallbackMessage: input.fallbackMessage ?? fallbackFor(input.assistantLanguage),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    const result = this.profiles.create(context, companyId, profile);
    if (result.status === "company_not_found") throw new AssistantProfileNotFoundError("Company was not found.");
    if (result.status === "name_conflict") throw new AssistantProfileConflictError("An Assistant Profile already uses this name.");
    return result.profile;
  }

  public update(context: WorkspaceContext, companyIdValue: unknown, profileIdValue: unknown, value: unknown): AssistantProfile {
    const current = this.get(context, companyIdValue, profileIdValue);
    if (current.status === "archived") throw new AssistantProfileConflictError("Archived Assistant Profiles cannot be edited.");
    const changes = updateInput(value);
    const updated = reconstructAssistantProfile({
      ...current,
      ...changes,
      normalizedName: changes.name === undefined ? current.normalizedName : normalizeAssistantProfileName(changes.name),
      updatedAt: nextUpdatedAt(current.updatedAt, this.clock.now()),
    });
    if (updated.status === "ready") {
      try { this.readyPolicy.assert(updated); }
      catch (error: unknown) { if (error instanceof AssistantProfilePolicyError) throw new AssistantProfileConflictError(error.message); throw error; }
    }
    return this.persist(context, current.companyId, updated);
  }

  public transition(context: WorkspaceContext, companyIdValue: unknown, profileIdValue: unknown, targetValue: unknown): AssistantProfile {
    const current = this.get(context, companyIdValue, profileIdValue);
    let target: AssistantProfileStatus;
    try { target = assistantProfileStatus(requiredString(targetValue, "Target status")); }
    catch { throw new AssistantProfileValidationError("Target status is invalid."); }
    try {
      return this.persist(context, current.companyId, this.lifecyclePolicy.transition(current, target, this.clock.now()));
    } catch (error: unknown) {
      if (error instanceof AssistantProfilePolicyError) throw new AssistantProfileConflictError(error.message);
      throw error;
    }
  }

  private persist(context: WorkspaceContext, companyId: number, profile: AssistantProfile): AssistantProfile {
    const result = this.profiles.update(context, companyId, profile);
    if (result.status === "not_found") throw new AssistantProfileNotFoundError("Assistant Profile was not found.");
    if (result.status === "name_conflict") throw new AssistantProfileConflictError("An Assistant Profile already uses this name.");
    return result.profile;
  }
}

function parseCompanyId(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AssistantProfileValidationError("Company ID must be a positive integer.");
  return parsed;
}

function parseProfileId(value: unknown): ReturnType<typeof assistantProfileId> {
  if (typeof value !== "string") throw new AssistantProfileValidationError("Assistant Profile ID is invalid.");
  try { return assistantProfileId(value); }
  catch { throw new AssistantProfileValidationError("Assistant Profile ID is invalid."); }
}

function createInput(value: unknown): Required<Pick<AssistantProfileChanges, "name" | "assistantLanguage">> & AssistantProfileChanges {
  const record = inputRecord(value);
  const allowed = new Set(["name", "assistantLanguage", "description", "businessRole", "objective", "audience", "tone", "welcomeMessage", "fallbackMessage"]);
  rejectUnknown(record, allowed);
  const result: Required<Pick<AssistantProfileChanges, "name" | "assistantLanguage">> & AssistantProfileChanges = {
    name: profileText(record.name, "Name", 80),
    assistantLanguage: languageValue(record.assistantLanguage),
  };
  assignOptionalFields(record, result);
  return result;
}

function updateInput(value: unknown): AssistantProfileChanges {
  const record = inputRecord(value);
  const allowed = new Set(["name", "description", "businessRole", "objective", "audience", "tone", "assistantLanguage", "welcomeMessage", "fallbackMessage"]);
  if (Object.keys(record).length === 0) throw new AssistantProfileValidationError("At least one field is required.");
  rejectUnknown(record, allowed);
  const result: AssistantProfileChanges = {};
  assignOptionalFields(record, result);
  return result;
}

function assignOptionalFields(record: Record<string, unknown>, result: AssistantProfileChanges): void {
  if (record.name !== undefined) result.name = profileText(record.name, "Name", 80);
  if (record.description !== undefined) result.description = nullableText(record.description, "Description", 240);
  if (record.businessRole !== undefined) result.businessRole = nullableText(record.businessRole, "Business role", 120);
  if (record.objective !== undefined) result.objective = nullableText(record.objective, "Objective", 500);
  if (record.audience !== undefined) result.audience = nullableText(record.audience, "Audience", 300);
  if (record.tone !== undefined) result.tone = toneValue(record.tone);
  if (record.assistantLanguage !== undefined) result.assistantLanguage = languageValue(record.assistantLanguage);
  if (record.welcomeMessage !== undefined) result.welcomeMessage = nullableText(record.welcomeMessage, "Welcome message", 500);
  if (record.fallbackMessage !== undefined) result.fallbackMessage = profileText(record.fallbackMessage, "Fallback message", 500);
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AssistantProfileValidationError("Request body must be an object.");
  return value as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new AssistantProfileValidationError("Request contains unsupported fields.");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new AssistantProfileValidationError(`${field} must be a string.`);
  return value;
}

function profileText(value: unknown, field: string, maximum: number): string {
  try { return requiredProfileText(requiredString(value, field), field, maximum); }
  catch { throw new AssistantProfileValidationError(`${field} is invalid.`); }
}

function nullableText(value: unknown, field: string, maximum: number): string | null {
  if (value === null) return null;
  try { return nullableProfileText(requiredString(value, field), field, maximum); }
  catch { throw new AssistantProfileValidationError(`${field} is invalid.`); }
}

function languageValue(value: unknown): AssistantLanguage {
  try { return assistantLanguage(requiredString(value, "Assistant language")); }
  catch { throw new AssistantProfileValidationError("Assistant language is invalid."); }
}

function toneValue(value: unknown): AssistantTone {
  try { return assistantTone(requiredString(value, "Tone")); }
  catch { throw new AssistantProfileValidationError("Tone is invalid."); }
}

function fallbackFor(language: AssistantLanguage): string {
  return language === "es"
    ? "No tengo información suficiente para responder con seguridad."
    : "I do not have enough information to answer safely.";
}
