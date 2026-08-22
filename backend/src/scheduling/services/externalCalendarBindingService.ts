import { randomUUID } from "node:crypto";
import type { IntegrationConnectionRepositoryPort } from "../../integrations/application/ports.js";
import type { ExternalCalendarBindingRepositoryPort } from "../application/externalCalendarPorts.js";
import type { SchedulingRepositoryPort } from "../application/ports.js";
import { externalCalendarBindingId, reconstructExternalCalendarBinding, type ExternalCalendarBinding, type ExternalCalendarBindingId } from "../domain/externalCalendar.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type ExternalCalendarBindingResolution = { readonly kind: "found"; readonly binding: ExternalCalendarBinding } | { readonly kind: "not_found" | "unavailable" | "invalid_connection" };
export type ReadyExternalCalendarBinding = { readonly bindingId: ExternalCalendarBindingId; readonly connectionId: string; readonly resourceId: string; readonly externalCalendarId: string; readonly provider: string; readonly kind: string; };
export type ReadyExternalCalendarBindingResolution = { readonly kind: "ready"; readonly binding: ReadyExternalCalendarBinding } | { readonly kind: "not_found" | "unavailable" | "invalid_connection" };
export class ExternalCalendarBindingConflictError extends Error {}
export class ExternalCalendarBindingValidationError extends Error {}

export class ExternalCalendarBindingService {
  public constructor(private readonly bindings: ExternalCalendarBindingRepositoryPort, private readonly scheduling: SchedulingRepositoryPort, private readonly connections: IntegrationConnectionRepositoryPort, private readonly clock: { now(): string }) {}
  public async createBinding(context: WorkspaceContext, companyId: number, input: { readonly resourceId: string; readonly connectionId: string; readonly externalCalendarId: string }): Promise<ExternalCalendarBinding> {
    const resource = await this.scheduling.findResource(context, companyId, input.resourceId); if (!resource) throw new ExternalCalendarBindingValidationError("External calendar binding is invalid.");
    const connection = await this.connections.findById(context, companyId, input.connectionId as never); if (!connection || connection.kind !== "calendar") throw new ExternalCalendarBindingValidationError("External calendar binding is invalid.");
    const now = this.clock.now(), value = reconstructExternalCalendarBinding({ id: externalCalendarBindingId(`ecb_${randomUUID().replaceAll("-", "")}`), workspaceId: context.workspaceId, companyId, resourceId: resource.id, integrationConnectionId: connection.id, externalCalendarId: input.externalCalendarId, createdAt: now, updatedAt: now });
    try { const created = await this.bindings.create(context, value); if (created) return created; throw new ExternalCalendarBindingConflictError("External calendar binding already exists."); }
    catch (error: unknown) { if (error instanceof ExternalCalendarBindingConflictError) throw error; throw new ExternalCalendarBindingConflictError("External calendar binding already exists."); }
  }
  public async getBindingByResource(context: WorkspaceContext, companyId: number, resourceId: string): Promise<ExternalCalendarBindingResolution> { const binding = await this.bindings.findByResource(context, companyId, resourceId); return binding ? { kind: "found", binding } : { kind: "not_found" }; }
  public async getBindingById(context: WorkspaceContext, companyId: number, id: ExternalCalendarBindingId): Promise<ExternalCalendarBindingResolution> { const binding = await this.bindings.findById(context, companyId, id); return binding ? { kind: "found", binding } : { kind: "not_found" }; }
  public async resolveReadyBindingForResource(context: WorkspaceContext, companyId: number, resourceId: string): Promise<ReadyExternalCalendarBindingResolution> {
    const found = await this.getBindingByResource(context, companyId, resourceId); if (found.kind !== "found") return found;
    const connection = await this.connections.findById(context, companyId, found.binding.integrationConnectionId); if (!connection || connection.kind !== "calendar") return { kind: "invalid_connection" };
    const state = await this.connections.findState(context, companyId, connection.id);
    if (connection.status !== "active" || state?.validationState !== "valid" || state.healthState !== "healthy" || !await this.connections.isReadyForTool(context, companyId, connection.provider, connection.kind)) return { kind: "unavailable" };
    return { kind: "ready", binding: Object.freeze({ bindingId: found.binding.id, connectionId: connection.id, resourceId: found.binding.resourceId, externalCalendarId: found.binding.externalCalendarId, provider: connection.provider, kind: connection.kind }) };
  }
}
