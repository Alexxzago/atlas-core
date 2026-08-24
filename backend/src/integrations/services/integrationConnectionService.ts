import { randomUUID } from "node:crypto";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { IntegrationConnectionRepositoryPort, IntegrationProviderValidationPort, IntegrationSecretCipherPort } from "../application/ports.js";
import { integrationConnectionId, integrationKind, integrationProvider, reconstructIntegrationConnection, reconstructIntegrationOperationalState, type IntegrationConnection, type IntegrationConnectionId, type IntegrationOperationalState } from "../domain/integrationConnection.js";

export class IntegrationConnectionNotFoundError extends Error {}
export class IntegrationConnectionConflictError extends Error {}
export class IntegrationConnectionValidationError extends Error {}

export class IntegrationConnectionService {
  public constructor(private readonly repository: IntegrationConnectionRepositoryPort, private readonly cipher: IntegrationSecretCipherPort, private readonly validator: IntegrationProviderValidationPort, private readonly clock: { now(): string }) {}
  /** Internal durable recovery projection; never exposes ciphertext or plaintext. */
  public async inspect(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<{ readonly connection: IntegrationConnection; readonly state: IntegrationOperationalState | null; readonly hasCurrentSecret: boolean } | null> { const connection = await this.repository.findById(context, companyId, id); if (!connection) return null; const [state, secret] = await Promise.all([this.repository.findState(context, companyId, id), this.repository.findSecret(context, companyId, id)]); return Object.freeze({ connection, state, hasCurrentSecret: secret !== null }); }
  public async create(context: WorkspaceContext, companyId: number, input: { readonly provider: string; readonly kind: string; readonly configuration?: Readonly<Record<string, unknown>> }): Promise<IntegrationConnection> {
    return this.createInternal(context, companyId, input, integrationConnectionId(`inc_${randomUUID().replaceAll("-", "")}`));
  }
  /** Internal reservation consumer. Callers must obtain the ID from a durable authority first. */
  public async createWithReservedId(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId, input: { readonly provider: "meta_whatsapp"; readonly kind: "cloud_api"; readonly configuration: Readonly<Record<string, unknown>>; readonly plaintextSecret: string }): Promise<{ readonly kind: "created" | "replayed"; readonly connection: IntegrationConnection }> {
    if (!input.plaintextSecret.trim() || input.plaintextSecret.length > 16_384) throw new IntegrationConnectionValidationError("Integration secret is invalid.");
    const reservedId = integrationConnectionId(id), now = this.clock.now(), connection = reconstructIntegrationConnection({ id: reservedId, workspaceId: context.workspaceId, companyId, provider: input.provider, kind: input.kind, configuration: input.configuration, status: "inactive", version: 1, createdAt: now, updatedAt: now }), encrypted = this.cipher.encrypt(input.plaintextSecret.trim());
    const existingBeforeCreate = await this.repository.findById(context, companyId, reservedId);
    if (existingBeforeCreate) return this.replayReserved(context, companyId, connection, existingBeforeCreate);
    const created = await this.repository.createWithSecret(context, connection, initialState(reservedId, now), encrypted);
    if (created) return Object.freeze({ kind: "created", connection: created });
    const existing = await this.repository.findById(context, companyId, reservedId);
    if (existing) return this.replayReserved(context, companyId, connection, existing);
    throw new IntegrationConnectionConflictError("Reserved Integration Connection conflicts with existing authority.");
  }
  private async replayReserved(context: WorkspaceContext, companyId: number, intended: IntegrationConnection, existing: IntegrationConnection): Promise<{ readonly kind: "replayed"; readonly connection: IntegrationConnection }> { const secret = await this.repository.findSecret(context, companyId, existing.id), state = await this.repository.findState(context, companyId, existing.id); if (secret && state && existing.workspaceId === context.workspaceId && existing.companyId === companyId && existing.provider === intended.provider && existing.kind === intended.kind && JSON.stringify(existing.configuration) === JSON.stringify(intended.configuration) && existing.status === "inactive" && state.validationState === "not_validated" && state.healthState === "inactive") return Object.freeze({ kind: "replayed", connection: existing }); throw new IntegrationConnectionConflictError("Reserved Integration Connection conflicts with existing authority."); }
  private async createInternal(context: WorkspaceContext, companyId: number, input: { readonly provider: string; readonly kind: string; readonly configuration?: Readonly<Record<string, unknown>> }, id: IntegrationConnectionId): Promise<IntegrationConnection> {
    const now = this.clock.now(), connection = reconstructIntegrationConnection({ id, workspaceId: context.workspaceId, companyId, provider: integrationProvider(input.provider), kind: integrationKind(input.kind), configuration: input.configuration ?? {}, status: "inactive", version: 1, createdAt: now, updatedAt: now });
    let created: IntegrationConnection | null;
    try { created = await this.repository.create(context, connection, initialState(id, now)); }
    catch (error: unknown) { if (error instanceof Error && /UNIQUE constraint failed: integration_connections\.workspace_id, integration_connections\.company_id, integration_connections\.provider, integration_connections\.kind/.test(error.message)) throw new IntegrationConnectionConflictError("Integration Connection already exists."); throw error; }
    if (!created) throw new IntegrationConnectionNotFoundError("Company was not found.");
    return created;
  }
  public async configureSecret(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId, secret: string): Promise<IntegrationConnection> {
    if (!secret.trim() || secret.length > 16_384) throw new IntegrationConnectionValidationError("Integration secret is invalid.");
    const current = await this.require(context, companyId, id), updatedAt = later(current.updatedAt, this.clock.now());
    const value = { ...current, status: "inactive" as const, version: current.version + 1, updatedAt };
    const state = initialState(id, updatedAt);
    const saved = await this.repository.compareAndSetWithSecret(context, companyId, id, current.version, value, state, this.cipher.encrypt(secret.trim()), "secret_configured");
    if (saved) return saved;
    if (!await this.repository.findById(context, companyId, id)) throw new IntegrationConnectionNotFoundError("Integration Connection was not found.");
    throw new IntegrationConnectionConflictError("Integration Connection changed. Try again.");
  }
  public async configure(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId, expectedVersion: number, configuration: Readonly<Record<string, unknown>>): Promise<IntegrationConnection> {
    const current = await this.require(context, companyId, id);
    if (current.version !== expectedVersion) throw new IntegrationConnectionConflictError("Integration Connection changed. Try again.");
    const updatedAt = later(current.updatedAt, this.clock.now());
    const value = reconstructIntegrationConnection({ ...current, configuration, status: "inactive", version: current.version + 1, updatedAt });
    const saved = await this.repository.compareAndSet(context, companyId, id, expectedVersion, value, initialState(id, updatedAt), "configured");
    if (saved) return saved;
    if (!await this.repository.findById(context, companyId, id)) throw new IntegrationConnectionNotFoundError("Integration Connection was not found.");
    throw new IntegrationConnectionConflictError("Integration Connection changed. Try again.");
  }
  public async validate(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationConnection> {
    const current = await this.require(context, companyId, id), encrypted = await this.repository.findSecret(context, companyId, id);
    if (!encrypted) throw new IntegrationConnectionValidationError("Integration secret is not configured.");
    const now = this.clock.now(), result = await this.validator.validate({ workspaceId: context.workspaceId, companyId: current.companyId, connectionId: current.id, provider: current.provider, kind: current.kind, configuration: current.configuration, plaintextSecret: this.cipher.decrypt(encrypted) });
    return this.save(context, current, { ...current, status: result.status === "valid" ? current.status : "inactive", version: current.version + 1, updatedAt: later(current.updatedAt, now) }, result.status === "valid" ? { connectionId: id, validationState: "valid", validatedAt: now, validationFailureCode: null, healthState: "healthy", healthFailureCode: null, lastProviderActivityAt: now, updatedAt: now } : { connectionId: id, validationState: "invalid", validatedAt: now, validationFailureCode: result.failureCode, healthState: "degraded", healthFailureCode: result.failureCode, lastProviderActivityAt: null, updatedAt: now }, result.status === "valid" ? "validated" : "validation_failed");
  }
  public async activate(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationConnection> {
    const current = await this.require(context, companyId, id), state = await this.repository.findState(context, companyId, id);
    if (state?.validationState !== "valid") throw new IntegrationConnectionConflictError("Integration Connection must be validated before activation.");
    const updatedAt = later(current.updatedAt, this.clock.now());
    return this.save(context, current, { ...current, status: "active", version: current.version + 1, updatedAt }, { ...state, healthState: "healthy", healthFailureCode: null, updatedAt }, "activated");
  }
  public async deactivate(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationConnection> {
    const current = await this.require(context, companyId, id), state = await this.repository.findState(context, companyId, id);
    if (!state) throw new IntegrationConnectionNotFoundError("Integration Connection was not found.");
    const updatedAt = later(current.updatedAt, this.clock.now());
    return this.save(context, current, { ...current, status: "inactive", version: current.version + 1, updatedAt }, { ...state, healthState: "inactive", healthFailureCode: null, updatedAt }, "deactivated");
  }
  private async require(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationConnection> { const connection = await this.repository.findById(context, companyId, id); if (!connection) throw new IntegrationConnectionNotFoundError("Integration Connection was not found."); return connection; }
  private async save(context: WorkspaceContext, current: IntegrationConnection, value: IntegrationConnection, state: IntegrationOperationalState, eventType: "validated" | "validation_failed" | "activated" | "deactivated"): Promise<IntegrationConnection> { const saved = await this.repository.compareAndSet(context, current.companyId, current.id, current.version, value, reconstructIntegrationOperationalState(state), eventType); if (saved) return saved; if (!await this.repository.findById(context, current.companyId, current.id)) throw new IntegrationConnectionNotFoundError("Integration Connection was not found."); throw new IntegrationConnectionConflictError("Integration Connection changed. Try again."); }
}
function initialState(id: IntegrationConnectionId, now: string): IntegrationOperationalState { return reconstructIntegrationOperationalState({ connectionId: id, validationState: "not_validated", validatedAt: null, validationFailureCode: null, healthState: "inactive", healthFailureCode: null, lastProviderActivityAt: null, updatedAt: now }); }
function later(previous: string, candidate: string): string { return new Date(Math.max(Date.parse(previous) + 1, Date.parse(candidate))).toISOString(); }
