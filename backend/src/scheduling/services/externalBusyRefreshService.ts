import { createHash } from "node:crypto";
import type { ProviderAdapterRegistryPort } from "../../integrations/application/providerAdapterRegistry.js";
import type { SchedulingRepositoryPort } from "../application/ports.js";
import { externalBusyObservationKey } from "../domain/externalCalendar.js";
import type { ExternalCalendarBindingService } from "./externalCalendarBindingService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type ExternalBusyRefreshResult = { readonly kind: "success"; readonly observations: number } | { readonly kind: "not_found" | "unavailable" | "invalid_connection" | "unauthorized" | "forbidden" | "rate_limited" | "timeout" | "invalid_response" | "validation_error" };
export class ExternalBusyRefreshService {
  public constructor(private readonly bindings: ExternalCalendarBindingService, private readonly registry: ProviderAdapterRegistryPort, private readonly scheduling: SchedulingRepositoryPort, private readonly clock: { now(): string }) {}
  public async refresh(context: WorkspaceContext, companyId: number, resourceId: string, startAt: string, endAt: string, signal: AbortSignal): Promise<ExternalBusyRefreshResult> {
    const resolved = await this.bindings.resolveReadyBindingForResource(context, companyId, resourceId); if (resolved.kind !== "ready") return resolved;
    const provider = this.registry.resolveCalendarBusy(resolved.binding.provider, resolved.binding.kind); if (!provider) return { kind: "unavailable" };
    const binding = await this.bindings.getBindingById(context, companyId, resolved.binding.bindingId); if (binding.kind !== "found" || binding.binding.resourceId !== resourceId || binding.binding.integrationConnectionId !== resolved.binding.connectionId) return { kind: "validation_error" };
    const result = await provider.listBusyIntervals({ context, companyId, connectionId: resolved.binding.connectionId as never, binding: binding.binding, startAt, endAt, signal }); if (result.kind !== "success") return result;
    const prefix = `gfb:${binding.binding.id}:`, now = this.clock.now();
    await this.scheduling.replaceExternalBusyIntervals(context, companyId, resourceId, prefix, result.intervals.map((interval) => ({ id: createHash("sha256").update(interval.observationKey).digest("hex").slice(0, 32), workspaceId: context.workspaceId, companyId, resourceId: resourceId as never, startAt: interval.startAt, endAt: interval.endAt, units: 1, source: "external_observed" as const, externalReference: externalBusyObservationKey(binding.binding.id, interval.startAt, interval.endAt), createdAt: now })));
    return { kind: "success", observations: result.intervals.length };
  }
}
