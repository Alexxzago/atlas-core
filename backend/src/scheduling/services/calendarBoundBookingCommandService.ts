import { createHash, randomUUID } from "node:crypto";
import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type { ProviderAdapterRegistryPort } from "../../integrations/application/providerAdapterRegistry.js";
import { CalendarSyncRepository, type CalendarSyncOperation } from "../../repositories/calendarSyncRepository.js";
import { BookingRepository } from "../../repositories/bookingRepository.js";
import type { ExternalBookingEventRepositoryPort } from "../application/externalCalendarPorts.js";
import type { SchedulingRepositoryPort } from "../application/ports.js";
import type { ExternalCalendarBinding } from "../domain/externalCalendar.js";
import type { SchedulingBooking, SchedulingService } from "../domain/scheduling.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { BookingCommandService } from "./bookingCommandService.js";
import { CalendarAvailabilityPreflightService, type Interval } from "./calendarAvailabilityPreflightService.js";
import type { ReadyExternalCalendarBinding, ReadyExternalCalendarBindingResolution } from "./externalCalendarBindingService.js";

export type CalendarBoundBookingCommandOutcome = { readonly kind: "pending"; readonly booking: SchedulingBooking } | { readonly kind: "availability_unverified" | "conflict" | "validation_error" };
export interface ReadyCalendarBindingPort { resolveReadyBindingForResource(context: WorkspaceContext, companyId: number, resourceId: string): Promise<ReadyExternalCalendarBindingResolution>; }

/** Local-first command facade for calendar-bound resources. It deliberately performs no provider writes. */
export class CalendarBoundBookingCommandService {
  public constructor(private readonly database: SqlDatabase, private readonly scheduling: SchedulingRepositoryPort, private readonly bindings: ReadyCalendarBindingPort, private readonly mappings: ExternalBookingEventRepositoryPort, private readonly registry: ProviderAdapterRegistryPort, private readonly sync: CalendarSyncRepository, private readonly clock: { now(): string }) {}

  public async create(context: WorkspaceContext, companyId: number, input: { readonly serviceId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string }, database: SqlDatabase = this.database): Promise<CalendarBoundBookingCommandOutcome> {
    const service = await this.scheduling.findService(context, companyId, input.serviceId); if (!service) return { kind: "validation_error" };
    const ready = await this.bindings.resolveReadyBindingForResource(context, companyId, service.resourceId); if (ready.kind !== "ready") return { kind: "availability_unverified" };
    if (!google(ready.binding)) return { kind: "availability_unverified" };
    const preflight = this.preflight(ready.binding); if (!preflight || (await preflight.create(context, companyId, ready.binding.connectionId, binding(context, companyId, ready.binding), occupied(service, input.startAt))).kind !== "available") return { kind: "availability_unverified" };
    return this.commit(database, context, companyId, ready.binding, "create", input, async commands => commands.create(context, companyId, input));
  }

  public async reschedule(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string }, database: SqlDatabase = this.database): Promise<CalendarBoundBookingCommandOutcome> {
    const source = await new BookingRepository(database).findBooking(context, companyId, input.bookingId); if (!source) return { kind: "validation_error" };
    const service = await this.scheduling.findService(context, companyId, source.serviceId), mapping = await this.mappings.findByBooking(context, companyId, source.id); if (!service || !mapping) return { kind: "validation_error" };
    const ready = await this.bindings.resolveReadyBindingForResource(context, companyId, service.resourceId); if (ready.kind !== "ready" || !google(ready.binding) || ready.binding.bindingId !== mapping.bindingId) return { kind: "availability_unverified" };
    const preflight = this.preflight(ready.binding); if (!preflight || (await preflight.reschedule(context, companyId, ready.binding.connectionId, binding(context, companyId, ready.binding), source, mapping, occupied(service, input.startAt))).kind !== "available") return { kind: "availability_unverified" };
    return this.commit(database, context, companyId, ready.binding, "reschedule", input, async commands => commands.reschedule(context, companyId, { bookingId: input.bookingId, newStartAt: input.startAt, reference: input.reference, idempotencyKey: input.idempotencyKey }));
  }

  public async cancel(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly idempotencyKey: string }, database: SqlDatabase = this.database): Promise<CalendarBoundBookingCommandOutcome> {
    const source = await new BookingRepository(database).findBooking(context, companyId, input.bookingId), mapping = source ? await this.mappings.findByBooking(context, companyId, source.id) : null; if (!source || !mapping) return { kind: "validation_error" };
    const service = await this.scheduling.findService(context, companyId, source.serviceId); if (!service) return { kind: "validation_error" }; const ready = await this.bindings.resolveReadyBindingForResource(context, companyId, service.resourceId); if (ready.kind !== "ready" || !google(ready.binding) || ready.binding.bindingId !== mapping.bindingId) return { kind: "availability_unverified" };
    return this.commit(database, context, companyId, ready.binding, "cancel", input, async commands => commands.cancel(context, companyId, input));
  }

  private preflight(ready: ReadyExternalCalendarBinding): CalendarAvailabilityPreflightService | null { const busy = this.registry.resolveCalendarBusy(ready.provider, ready.kind), events = this.registry.resolveCalendarEvents(ready.provider, ready.kind); return busy && events ? new CalendarAvailabilityPreflightService(busy, events) : null; }
  private async commit(database: SqlDatabase, context: WorkspaceContext, companyId: number, ready: ReadyExternalCalendarBinding, operation: CalendarSyncOperation, input: { readonly idempotencyKey: string }, run: (commands: BookingCommandService) => Promise<SchedulingBooking>): Promise<CalendarBoundBookingCommandOutcome> {
    try { return await database.transaction(async transaction => { const booking = await run(new BookingCommandService(new BookingRepository(transaction), this.clock)); await this.sync.enqueue(transaction, context, companyId, { id: `cso_${randomUUID().replaceAll("-", "")}`, bookingId: booking.id, bindingId: ready.bindingId, operation, idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint(operation, ready.bindingId, input), at: this.clock.now() }); return { kind: "pending", booking } as const; }); }
    catch { return { kind: "conflict" }; }
  }
}
function binding(context: WorkspaceContext, companyId: number, ready: ReadyExternalCalendarBinding): ExternalCalendarBinding { const now = "2026-01-01T00:00:00.000Z"; return { id: ready.bindingId, workspaceId: context.workspaceId, companyId, resourceId: ready.resourceId as never, integrationConnectionId: ready.connectionId as never, externalCalendarId: ready.externalCalendarId, createdAt: now, updatedAt: now }; }
function google(ready: ReadyExternalCalendarBinding): boolean { return ready.provider === "google_calendar" && ready.kind === "calendar"; }
function occupied(service: SchedulingService, startAt: string): Interval { const start = new Date(Date.parse(startAt)); if (Number.isNaN(start.valueOf())) return { startAt, endAt: startAt }; const end = new Date(start.valueOf() + service.durationMinutes * 60_000); return { startAt: new Date(start.valueOf() - service.bufferBeforeMinutes * 60_000).toISOString(), endAt: new Date(end.valueOf() + service.bufferAfterMinutes * 60_000).toISOString() }; }
function fingerprint(operation: CalendarSyncOperation, bindingId: string, input: { readonly idempotencyKey: string }): string { return createHash("sha256").update(JSON.stringify({ operation, bindingId, idempotencyKey: input.idempotencyKey })).digest("hex"); }
