import { randomUUID } from "node:crypto";
import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { AssistantProfileRepositoryPort } from "../../assistant/application/ports.js";
import { assistantProfileId } from "../../assistant/domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../../assistant/domain/assistantProfilePolicies.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnectionRepositoryPort } from "../application/ports.js";
import { reconstructWhatsAppConnection, whatsAppConnectionId, whatsAppConnectionStatus, type WhatsAppConnection, type WhatsAppConnectionId, type WhatsAppConnectionStatus } from "../domain/whatsappConnection.js";

export class WhatsAppConnectionValidationError extends Error {}
export class WhatsAppConnectionNotFoundError extends Error {}
export class WhatsAppConnectionConflictError extends Error {}
export class WhatsAppConnectionProfileNotExecutableError extends Error {}
export interface WhatsAppConnectionClock { now(): string; }

export class WhatsAppConnectionService {
  private readonly executionPolicy = new AssistantProfileExecutionPolicy();
  public constructor(private readonly companies: CompanyRepositoryPort, private readonly profiles: AssistantProfileRepositoryPort, private readonly connections: WhatsAppConnectionRepositoryPort, private readonly clock: WhatsAppConnectionClock) {}
  public create(context: WorkspaceContext, companyIdValue: unknown, value: unknown): WhatsAppConnection {
    const companyId = parseCompanyId(companyIdValue), input = createInput(value); this.company(context, companyId);
    const profile = this.profiles.findById(context, companyId, input.assistantProfileId);
    if (!profile || profile.status === "archived") throw new WhatsAppConnectionNotFoundError("Assistant Profile was not found.");
    const now = this.clock.now();
    try {
      const created = this.connections.create(context, reconstructWhatsAppConnection({ id: whatsAppConnectionId(`wac_${randomUUID().replaceAll("-", "")}`), workspaceId: context.workspaceId, companyId, assistantProfileId: profile.id, phoneNumberId: input.phoneNumberId, whatsappBusinessAccountId: input.whatsappBusinessAccountId, status: "inactive", createdAt: now, updatedAt: now }));
      if (!created) throw new WhatsAppConnectionNotFoundError("WhatsApp Connection could not be created."); return created;
    } catch (error: unknown) { if (unique(error)) throw new WhatsAppConnectionConflictError("WhatsApp Connection configuration conflicts with an existing connection."); throw error; }
  }
  public list(context: WorkspaceContext, companyIdValue: unknown): WhatsAppConnection[] { const id = parseCompanyId(companyIdValue); this.company(context, id); return this.connections.listByCompany(context, id); }
  public get(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): WhatsAppConnection { const id = parseCompanyId(companyIdValue), connection = this.connections.findById(context, id, connectionId(connectionIdValue)); if (!connection) throw new WhatsAppConnectionNotFoundError("WhatsApp Connection was not found."); return connection; }
  public update(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown, value: unknown): WhatsAppConnection {
    const current = this.get(context, companyIdValue, connectionIdValue), input = updateInput(value);
    if (input.kind === "status") return this.status(context, current, input.status);
    if (current.status !== "inactive") throw new WhatsAppConnectionConflictError("Deactivate the WhatsApp Connection before changing its Assistant Profile.");
    const profile = this.profiles.findById(context, current.companyId, input.assistantProfileId);
    if (!profile || profile.status === "archived") throw new WhatsAppConnectionNotFoundError("Assistant Profile was not found.");
    if (profile.id === current.assistantProfileId) return current;
    const updated = this.connections.updateAssistantProfile(context, current.companyId, current.id, current.updatedAt, profile.id, next(current.updatedAt, this.clock.now()));
    return updated ?? this.changed(context, current);
  }
  private status(context: WorkspaceContext, current: WhatsAppConnection, status: WhatsAppConnectionStatus): WhatsAppConnection {
    if (current.status === status) return current;
    if (status === "active") { const profile = this.profiles.findById(context, current.companyId, current.assistantProfileId); if (!profile) throw new WhatsAppConnectionNotFoundError("Assistant Profile was not found."); try { this.executionPolicy.assert(profile); } catch (error: unknown) { if (error instanceof AssistantProfilePolicyError) throw new WhatsAppConnectionProfileNotExecutableError("Assistant Profile is not executable."); throw error; } }
    const updated = this.connections.updateStatus(context, current.companyId, current.id, current.updatedAt, status, next(current.updatedAt, this.clock.now()));
    return updated ?? this.changed(context, current);
  }
  private changed(context: WorkspaceContext, current: WhatsAppConnection): never { if (!this.connections.findById(context, current.companyId, current.id)) throw new WhatsAppConnectionNotFoundError("WhatsApp Connection was not found."); throw new WhatsAppConnectionConflictError("WhatsApp Connection changed. Try again."); }
  private company(context: WorkspaceContext, id: number): void { if (!this.companies.findById(context, id)) throw new WhatsAppConnectionNotFoundError("Company was not found."); }
}
function parseCompanyId(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new WhatsAppConnectionValidationError("Company ID is invalid."); return parsed; }
function connectionId(value: unknown): WhatsAppConnectionId { if (typeof value !== "string") throw new WhatsAppConnectionValidationError("WhatsApp Connection ID is invalid."); try { return whatsAppConnectionId(value); } catch { throw new WhatsAppConnectionValidationError("WhatsApp Connection ID is invalid."); } }
function profileId(value: unknown) { if (typeof value !== "string") throw new WhatsAppConnectionValidationError("Assistant Profile ID is invalid."); try { return assistantProfileId(value); } catch { throw new WhatsAppConnectionValidationError("Assistant Profile ID is invalid."); } }
function providerIdentifier(value: unknown, label: string): string { if (typeof value !== "string") throw new WhatsAppConnectionValidationError(`${label} is invalid.`); const normalized = value.normalize("NFKC").trim(); if (!normalized || Array.from(normalized).length > 256) throw new WhatsAppConnectionValidationError(`${label} is invalid.`); return normalized; }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new WhatsAppConnectionValidationError("WhatsApp Connection input is invalid."); return value as Record<string, unknown>; }
function createInput(value: unknown): { assistantProfileId: ReturnType<typeof assistantProfileId>; phoneNumberId: string; whatsappBusinessAccountId: string } { const input = record(value), keys = Object.keys(input); if (keys.length !== 3 || !keys.every((key) => key === "assistantProfileId" || key === "phoneNumberId" || key === "whatsappBusinessAccountId")) throw new WhatsAppConnectionValidationError("WhatsApp Connection input is invalid."); return { assistantProfileId: profileId(input.assistantProfileId), phoneNumberId: providerIdentifier(input.phoneNumberId, "Phone Number ID"), whatsappBusinessAccountId: providerIdentifier(input.whatsappBusinessAccountId, "WhatsApp Business Account ID") }; }
function updateInput(value: unknown): { kind: "status"; status: WhatsAppConnectionStatus } | { kind: "profile"; assistantProfileId: ReturnType<typeof assistantProfileId> } { const input = record(value), keys = Object.keys(input); if (keys.length !== 1) throw new WhatsAppConnectionValidationError("WhatsApp Connection update is invalid."); if (keys[0] === "status") { if (typeof input.status !== "string") throw new WhatsAppConnectionValidationError("WhatsApp Connection status is invalid."); try { return { kind: "status", status: whatsAppConnectionStatus(input.status) }; } catch { throw new WhatsAppConnectionValidationError("WhatsApp Connection status is invalid."); } } if (keys[0] === "assistantProfileId") return { kind: "profile", assistantProfileId: profileId(input.assistantProfileId) }; throw new WhatsAppConnectionValidationError("WhatsApp Connection update is invalid."); }
function next(current: string, clock: string): string { const value = Math.max(Date.parse(current) + 1, Date.parse(clock)); return new Date(value).toISOString(); }
function unique(error: unknown): boolean { return error instanceof Error && "errcode" in error && (error as Error & { errcode?: unknown }).errcode === 2067; }
