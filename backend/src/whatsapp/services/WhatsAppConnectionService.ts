import { randomUUID } from "node:crypto";
import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { AssistantProfileRepositoryPort } from "../../assistant/application/ports.js";
import { assistantProfileId } from "../../assistant/domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../../assistant/domain/assistantProfilePolicies.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnectionRepositoryPort } from "../application/ports.js";
import type { WhatsAppConnectionCredentialRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionProviderValidationPort, WhatsAppCredentialCipherPort, WhatsAppCredentialResolverPort } from "../application/ports.js";
import type { KnowledgeRepositoryPort } from "../../knowledge/application/ports.js";
import { reconstructWhatsAppConnection, whatsAppConnectionId, whatsAppConnectionStatus, type WhatsAppConnection, type WhatsAppConnectionId, type WhatsAppConnectionStatus } from "../domain/whatsappConnection.js";
import { reconstructEncryptedWhatsAppConnectionCredentials, reconstructWhatsAppConnectionOperationalState, type WhatsAppConnectionOperationalState } from "../domain/whatsappConnectionOnboarding.js";
import type { AssistantReadinessService } from "../../assistant/services/assistantReadinessService.js";

export class WhatsAppConnectionValidationError extends Error {}
export class WhatsAppConnectionNotFoundError extends Error {}
export class WhatsAppConnectionConflictError extends Error {}
export class WhatsAppConnectionProfileNotExecutableError extends Error {}
export class WhatsAppConnectionCredentialsNotConfiguredError extends Error {}
export class WhatsAppConnectionNotValidatedError extends Error {}
export class WhatsAppConnectionKnowledgeUnavailableError extends Error {}
export interface WhatsAppConnectionClock { now(): string; }

export class WhatsAppConnectionService {
  private readonly executionPolicy = new AssistantProfileExecutionPolicy();
  public constructor(private readonly companies: CompanyRepositoryPort, private readonly profiles: AssistantProfileRepositoryPort, private readonly connections: WhatsAppConnectionRepositoryPort, private readonly clock: WhatsAppConnectionClock, private readonly onboarding?: { credentials: WhatsAppConnectionCredentialRepositoryPort; states: WhatsAppConnectionOperationalStateRepositoryPort; cipher: WhatsAppCredentialCipherPort; resolver: WhatsAppCredentialResolverPort; validator: WhatsAppConnectionProviderValidationPort; knowledge: KnowledgeRepositoryPort }, private readonly readiness?: AssistantReadinessService) {}
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
  public resolveActiveByPhoneNumberId(phoneNumberId: unknown): WhatsAppConnection | null { if (typeof phoneNumberId !== "string") return null; const connection = this.connections.findByPhoneNumberId(phoneNumberId); return connection?.status === "active" ? connection : null; }
  public resolveForRecovery(connectionId: WhatsAppConnectionId): WhatsAppConnection | null { const connection = this.connections.findByIdForRecovery(connectionId); return connection?.status === "active" ? connection : null; }
  public get(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): WhatsAppConnection { const id = parseCompanyId(companyIdValue), connection = this.connections.findById(context, id, connectionId(connectionIdValue)); if (!connection) throw new WhatsAppConnectionNotFoundError("WhatsApp Connection was not found."); return connection; }
  public update(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown, value: unknown): WhatsAppConnection {
    const current = this.get(context, companyIdValue, connectionIdValue), input = updateInput(value);
    if (input.kind === "status") {
      if (input.status === "active") {
        const profile = this.profiles.findById(context, current.companyId, current.assistantProfileId);
        try { if (!profile) throw new AssistantProfilePolicyError(); this.executionPolicy.assert(profile); } catch { throw new WhatsAppConnectionProfileNotExecutableError("Assistant Profile is not executable."); }
        // Connections created before onboarding gates existed are only exercised by legacy local callers.
        if (!this.onboarding) return this.updateStoredStatus(context, current, input.status);
        throw new WhatsAppConnectionConflictError("Use the activation endpoint to activate a WhatsApp Connection.");
      }
      return this.updateStoredStatus(context, current, input.status);
    }
    if (current.status !== "inactive") throw new WhatsAppConnectionConflictError("Deactivate the WhatsApp Connection before changing its Assistant Profile.");
    const profile = this.profiles.findById(context, current.companyId, input.assistantProfileId);
    if (!profile || profile.status === "archived") throw new WhatsAppConnectionNotFoundError("Assistant Profile was not found.");
    if (profile.id === current.assistantProfileId) return current;
    const updated = this.connections.updateAssistantProfile(context, current.companyId, current.id, current.updatedAt, profile.id, next(current.updatedAt, this.clock.now()));
    return updated ?? this.changed(context, current);
  }
  public status(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): WhatsAppConnectionOperationalStatus {
    const connection = this.get(context, companyIdValue, connectionIdValue), state = this.onboarding?.states.findOperationalState(context, connection.companyId, connection.id);
    return { connection: redacted(connection), credentialsConfigured: this.onboarding ? this.onboarding.credentials.findCredentials(context, connection.companyId, connection.id) !== null : false, validationState: state?.validationState ?? "not_validated", validatedAt: state?.validatedAt ?? null, validationFailureCode: state?.validationFailureCode ?? null, healthState: state?.healthState ?? "inactive", lastProviderActivityAt: state?.lastProviderActivityAt ?? null, lastWebhookActivityAt: state?.lastWebhookActivityAt ?? null, healthFailureCode: state?.healthFailureCode ?? null, updatedAt: state?.updatedAt ?? connection.updatedAt };
  }
  public configureCredentials(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown, value: unknown): WhatsAppConnectionOperationalStatus {
    const connection = this.get(context, companyIdValue, connectionIdValue), dependencies = this.requiredOnboarding(), token = credentialToken(value), now = this.clock.now();
    const saved = dependencies.credentials.replaceCredentials(context, connection.companyId, reconstructEncryptedWhatsAppConnectionCredentials({ whatsAppConnectionId: connection.id, encryptedAccessToken: dependencies.cipher.encrypt(token), createdAt: now, updatedAt: now }));
    if (!saved) throw new WhatsAppConnectionNotFoundError("WhatsApp Connection was not found.");
    this.saveState(context, connection, { validationState: "not_validated", validatedAt: null, validationFailureCode: null, healthState: "inactive", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: now });
    return this.status(context, connection.companyId, connection.id);
  }
  public async validate(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): Promise<WhatsAppConnectionOperationalStatus> {
    const connection = this.get(context, companyIdValue, connectionIdValue), dependencies = this.requiredOnboarding(), token = dependencies.resolver.resolve(context, connection.companyId, connection.id);
    if (!token) throw new WhatsAppConnectionCredentialsNotConfiguredError("WhatsApp credentials are not configured.");
    const now = this.clock.now(), result = await dependencies.validator.validateConnection({ accessToken: token, phoneNumberId: connection.phoneNumberId, whatsappBusinessAccountId: connection.whatsappBusinessAccountId });
    this.saveState(context, connection, result.status === "valid" ? { validationState: "valid", validatedAt: now, validationFailureCode: null, healthState: "healthy", lastProviderActivityAt: now, lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: now } : { validationState: "invalid", validatedAt: now, validationFailureCode: result.failureCode, healthState: "degraded", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: result.failureCode, updatedAt: now });
    return this.status(context, connection.companyId, connection.id);
  }
  public async activate(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): Promise<WhatsAppConnectionOperationalStatus> {
    const connection = this.get(context, companyIdValue, connectionIdValue);
    if (this.readiness) {
      if (this.readiness.refresh(context, connection.companyId, connection.id).status !== "ready") throw new WhatsAppConnectionConflictError("Assistant readiness is blocked.");
    } else {
      const dependencies = this.requiredOnboarding(), company = this.companies.findById(context, connection.companyId);
      if (!dependencies.credentials.findCredentials(context, connection.companyId, connection.id) && !dependencies.resolver.resolve(context, connection.companyId, connection.id)) throw new WhatsAppConnectionCredentialsNotConfiguredError("WhatsApp credentials are not configured.");
      if (dependencies.states.findOperationalState(context, connection.companyId, connection.id)?.validationState !== "valid") throw new WhatsAppConnectionNotValidatedError("WhatsApp credentials must be validated before activation.");
      if (!company || company.status !== "ready" || !dependencies.knowledge.loadPublished(context, connection.companyId)) throw new WhatsAppConnectionKnowledgeUnavailableError("Company requires published Knowledge before WhatsApp activation.");
      const profile = this.profiles.findById(context, connection.companyId, connection.assistantProfileId);
      try { if (!profile) throw new AssistantProfilePolicyError(); this.executionPolicy.assert(profile); } catch { throw new WhatsAppConnectionProfileNotExecutableError("Assistant Profile is not executable."); }
    }
    if (connection.status === "inactive") { try { const updated = this.connections.updateStatus(context, connection.companyId, connection.id, connection.updatedAt, "active", next(connection.updatedAt, this.clock.now())); if (!updated) this.changed(context, connection); } catch (error: unknown) { if (unique(error)) throw new WhatsAppConnectionConflictError("Company already has an active WhatsApp Connection."); throw error; } }
    return this.status(context, connection.companyId, connection.id);
  }
  public deactivate(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): WhatsAppConnectionOperationalStatus {
    const connection = this.get(context, companyIdValue, connectionIdValue);
    if (connection.status === "active") { const updated = this.connections.updateStatus(context, connection.companyId, connection.id, connection.updatedAt, "inactive", next(connection.updatedAt, this.clock.now())); if (!updated) this.changed(context, connection); }
    return this.status(context, connection.companyId, connection.id);
  }
  public recordWebhookActivity(phoneNumberId: string): void {
    const connection = this.resolveActiveByPhoneNumberId(phoneNumberId);
    if (!connection || !this.onboarding) return;
    const context = { workspaceId: connection.workspaceId, workspaceKey: "whatsapp" };
    const state = this.onboarding.states.findOperationalState(context, connection.companyId, connection.id);
    if (!state) return;
    const now = this.clock.now();
    this.saveState(context, connection, { ...state, healthState: "healthy", healthFailureCode: null, lastWebhookActivityAt: now, updatedAt: now });
  }
  public recordProviderActivity(context: WorkspaceContext, companyId: number, connectionIdValue: WhatsAppConnectionId): void {
    if (!this.onboarding) return;
    const connection = this.connections.findById(context, companyId, connectionIdValue);
    if (!connection) return;
    const state = this.onboarding.states.findOperationalState(context, companyId, connection.id);
    if (!state) return;
    const now = this.clock.now();
    this.saveState(context, connection, { ...state, healthState: "healthy", healthFailureCode: null, lastProviderActivityAt: now, updatedAt: now });
  }
  public recordProviderFailure(context: WorkspaceContext, companyId: number, connectionIdValue: WhatsAppConnectionId): void {
    if (!this.onboarding) return;
    const connection = this.connections.findById(context, companyId, connectionIdValue);
    if (!connection) return;
    const state = this.onboarding.states.findOperationalState(context, companyId, connection.id);
    if (!state) return;
    const now = this.clock.now();
    this.saveState(context, connection, { ...state, healthState: "degraded", healthFailureCode: "provider_unavailable", updatedAt: now });
  }
  private updateStoredStatus(context: WorkspaceContext, current: WhatsAppConnection, status: WhatsAppConnectionStatus): WhatsAppConnection {
    if (current.status === status) return current;
    const updated = this.connections.updateStatus(context, current.companyId, current.id, current.updatedAt, status, next(current.updatedAt, this.clock.now()));
    return updated ?? this.changed(context, current);
  }
  private changed(context: WorkspaceContext, current: WhatsAppConnection): never { if (!this.connections.findById(context, current.companyId, current.id)) throw new WhatsAppConnectionNotFoundError("WhatsApp Connection was not found."); throw new WhatsAppConnectionConflictError("WhatsApp Connection changed. Try again."); }
  private company(context: WorkspaceContext, id: number): void { if (!this.companies.findById(context, id)) throw new WhatsAppConnectionNotFoundError("Company was not found."); }
  private requiredOnboarding() { if (!this.onboarding) throw new WhatsAppConnectionCredentialsNotConfiguredError("WhatsApp credential configuration is unavailable."); return this.onboarding; }
  private saveState(context: WorkspaceContext, connection: WhatsAppConnection, value: Omit<WhatsAppConnectionOperationalState, "whatsAppConnectionId">): void { const saved = this.requiredOnboarding().states.replaceOperationalState(context, connection.companyId, reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: connection.id, ...value })); if (!saved) throw new WhatsAppConnectionNotFoundError("WhatsApp Connection was not found."); }
}
export interface WhatsAppConnectionOperationalStatus { readonly connection: ReturnType<typeof redacted>; readonly credentialsConfigured: boolean; readonly validationState: "not_validated" | "valid" | "invalid"; readonly validatedAt: string | null; readonly validationFailureCode: string | null; readonly healthState: "inactive" | "healthy" | "degraded"; readonly lastProviderActivityAt: string | null; readonly lastWebhookActivityAt: string | null; readonly healthFailureCode: string | null; readonly updatedAt: string; }
function redacted(value: WhatsAppConnection) { return { id: value.id, assistantProfileId: value.assistantProfileId, phoneNumberId: value.phoneNumberId, whatsappBusinessAccountId: value.whatsappBusinessAccountId, status: value.status, createdAt: value.createdAt, updatedAt: value.updatedAt }; }
function parseCompanyId(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new WhatsAppConnectionValidationError("Company ID is invalid."); return parsed; }
function connectionId(value: unknown): WhatsAppConnectionId { if (typeof value !== "string") throw new WhatsAppConnectionValidationError("WhatsApp Connection ID is invalid."); try { return whatsAppConnectionId(value); } catch { throw new WhatsAppConnectionValidationError("WhatsApp Connection ID is invalid."); } }
function profileId(value: unknown) { if (typeof value !== "string") throw new WhatsAppConnectionValidationError("Assistant Profile ID is invalid."); try { return assistantProfileId(value); } catch { throw new WhatsAppConnectionValidationError("Assistant Profile ID is invalid."); } }
function providerIdentifier(value: unknown, label: string): string { if (typeof value !== "string") throw new WhatsAppConnectionValidationError(`${label} is invalid.`); const normalized = value.normalize("NFKC").trim(); if (!normalized || Array.from(normalized).length > 256) throw new WhatsAppConnectionValidationError(`${label} is invalid.`); return normalized; }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new WhatsAppConnectionValidationError("WhatsApp Connection input is invalid."); return value as Record<string, unknown>; }
function credentialToken(value: unknown): string { const input = record(value); if (Object.keys(input).length !== 1 || typeof input.accessToken !== "string") throw new WhatsAppConnectionValidationError("WhatsApp credentials are invalid."); const token = input.accessToken.trim(); if (!token || token.length > 16_384) throw new WhatsAppConnectionValidationError("WhatsApp credentials are invalid."); return token; }
function createInput(value: unknown): { assistantProfileId: ReturnType<typeof assistantProfileId>; phoneNumberId: string; whatsappBusinessAccountId: string } { const input = record(value), keys = Object.keys(input); if (keys.length !== 3 || !keys.every((key) => key === "assistantProfileId" || key === "phoneNumberId" || key === "whatsappBusinessAccountId")) throw new WhatsAppConnectionValidationError("WhatsApp Connection input is invalid."); return { assistantProfileId: profileId(input.assistantProfileId), phoneNumberId: providerIdentifier(input.phoneNumberId, "Phone Number ID"), whatsappBusinessAccountId: providerIdentifier(input.whatsappBusinessAccountId, "WhatsApp Business Account ID") }; }
function updateInput(value: unknown): { kind: "status"; status: WhatsAppConnectionStatus } | { kind: "profile"; assistantProfileId: ReturnType<typeof assistantProfileId> } { const input = record(value), keys = Object.keys(input); if (keys.length !== 1) throw new WhatsAppConnectionValidationError("WhatsApp Connection update is invalid."); if (keys[0] === "status") { if (typeof input.status !== "string") throw new WhatsAppConnectionValidationError("WhatsApp Connection status is invalid."); try { return { kind: "status", status: whatsAppConnectionStatus(input.status) }; } catch { throw new WhatsAppConnectionValidationError("WhatsApp Connection status is invalid."); } } if (keys[0] === "assistantProfileId") return { kind: "profile", assistantProfileId: profileId(input.assistantProfileId) }; throw new WhatsAppConnectionValidationError("WhatsApp Connection update is invalid."); }
function next(current: string, clock: string): string { const value = Math.max(Date.parse(current) + 1, Date.parse(clock)); return new Date(value).toISOString(); }
function unique(error: unknown): boolean { return error instanceof Error && "errcode" in error && (error as Error & { errcode?: unknown }).errcode === 2067; }
