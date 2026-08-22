import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ExternalBookingEventRepositoryPort } from "../application/externalCalendarPorts.js";
import type { BookingRepositoryPort } from "../application/bookingPorts.js";
import type { SchedulingRepositoryPort } from "../application/ports.js";
import type { SchedulingBooking } from "../domain/scheduling.js";
import { validateInstant } from "../domain/scheduling.js";
import { SchedulingConflictError, SchedulingIdempotencyError, SchedulingNotFoundError } from "./schedulingService.js";
import type { ExternalCalendarBindingService } from "./externalCalendarBindingService.js";

export type RoutedBookingWriteOutcome =
  | { readonly kind: "success"; readonly booking: SchedulingBooking }
  | { readonly kind: "replayed"; readonly booking: SchedulingBooking }
  | { readonly kind: "conflict" | "validation_error" | "unavailable" | "pending_recovery" };

export interface LocalBookingCommandPort {
  create(context: WorkspaceContext, companyId: number, input: { readonly serviceId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string }): Promise<SchedulingBooking>;
  reschedule(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly newStartAt: string; readonly reference: string; readonly idempotencyKey: string }): Promise<SchedulingBooking>;
  cancel(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly idempotencyKey: string }): Promise<SchedulingBooking>;
}

export interface ExternalBookingCreatePort { create(context: WorkspaceContext, companyId: number, input: { readonly resourceId: string; readonly serviceId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<ExternalCreateResult>; }
export interface ExternalBookingReschedulePort { reschedule(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<ExternalMutationResult>; }
export interface ExternalBookingCancelPort { cancel(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<ExternalMutationResult>; }

type ExternalCreateResult = { readonly kind: "created" | "replayed"; readonly booking: SchedulingBooking } | { readonly kind: "pending_recovery" | "conflict" | "unavailable" | "validation_error" };
type ExternalMutationResult = { readonly kind: "rescheduled" | "cancelled" | "already_cancelled" | "replayed"; readonly booking: SchedulingBooking } | { readonly kind: "pending_recovery" | "conflict" | "unavailable" | "validation_error" };

/** Routes new writes by resource binding and existing writes by durable booking-event mapping. */
export class SchedulingBookingRouter {
  public constructor(
    private readonly local: LocalBookingCommandPort,
    private readonly bindings: ExternalCalendarBindingService,
    private readonly externalCreate: ExternalBookingCreatePort,
    private readonly externalReschedule: ExternalBookingReschedulePort,
    private readonly externalCancel: ExternalBookingCancelPort,
    private readonly bookings: BookingRepositoryPort,
    private readonly mappings: ExternalBookingEventRepositoryPort,
    private readonly scheduling: SchedulingRepositoryPort,
  ) {}

  public async create(context: WorkspaceContext, companyId: number, input: { readonly serviceId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<RoutedBookingWriteOutcome> {
    const request = createInput(input);
    if (!request) return { kind: "validation_error" };
    const service = await this.scheduling.findService(context, companyId, request.serviceId);
    const resource = service ? await this.scheduling.findResource(context, companyId, service.resourceId) : null;
    if (!service || !resource || service.resourceId !== resource.id) return { kind: "validation_error" };
    const binding = await this.bindings.getBindingByResource(context, companyId, resource.id);
    if (binding.kind === "not_found") return this.localCreate(context, companyId, request);
    const ready = await this.bindings.resolveReadyBindingForResource(context, companyId, resource.id);
    if (ready.kind !== "ready") return { kind: "unavailable" };
    return normalizeCreate(await this.externalCreate.create(context, companyId, { ...request, resourceId: resource.id }));
  }

  public async reschedule(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<RoutedBookingWriteOutcome> {
    const request = rescheduleInput(input);
    if (!request) return { kind: "validation_error" };
    const booking = await this.bookings.findBooking(context, companyId, request.bookingId);
    if (!booking) return { kind: "validation_error" };
    const mapping = await this.mappings.findByBooking(context, companyId, booking.id);
    if (!mapping) return this.localReschedule(context, companyId, request);
    if (!await this.readyMappedResource(context, companyId, booking, mapping.bindingId)) return { kind: "unavailable" };
    return normalizeMutation(await this.externalReschedule.reschedule(context, companyId, request));
  }

  public async cancel(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<RoutedBookingWriteOutcome> {
    const request = cancelInput(input);
    if (!request) return { kind: "validation_error" };
    const booking = await this.bookings.findBooking(context, companyId, request.bookingId);
    if (!booking) return { kind: "validation_error" };
    const mapping = await this.mappings.findByBooking(context, companyId, booking.id);
    if (!mapping) return this.localCancel(context, companyId, request);
    if (!await this.readyMappedResource(context, companyId, booking, mapping.bindingId)) return { kind: "unavailable" };
    return normalizeMutation(await this.externalCancel.cancel(context, companyId, request));
  }

  private async readyMappedResource(context: WorkspaceContext, companyId: number, booking: SchedulingBooking, bindingId: string): Promise<boolean> {
    const service = await this.scheduling.findService(context, companyId, booking.serviceId);
    if (!service) return false;
    const ready = await this.bindings.resolveReadyBindingForResource(context, companyId, service.resourceId);
    return ready.kind === "ready" && ready.binding.bindingId === bindingId;
  }

  private async localCreate(context: WorkspaceContext, companyId: number, input: { readonly serviceId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<RoutedBookingWriteOutcome> { return local(() => this.local.create(context, companyId, input)); }
  private async localReschedule(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<RoutedBookingWriteOutcome> { return local(() => this.local.reschedule(context, companyId, { bookingId: input.bookingId, newStartAt: input.startAt, reference: input.reference, idempotencyKey: input.idempotencyKey })); }
  private async localCancel(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly idempotencyKey: string; readonly workerId: string }): Promise<RoutedBookingWriteOutcome> { return local(() => this.local.cancel(context, companyId, input)); }
}

function createInput(input: { readonly serviceId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }) { return valid(input.serviceId, input.reference, input.idempotencyKey, input.workerId) && instant(input.startAt) ? { ...input, serviceId: input.serviceId.trim(), startAt: input.startAt, reference: input.reference.trim(), idempotencyKey: input.idempotencyKey.trim(), workerId: input.workerId.trim() } : null; }
function rescheduleInput(input: { readonly bookingId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string; readonly workerId: string }) { return valid(input.bookingId, input.reference, input.idempotencyKey, input.workerId) && instant(input.startAt) ? { ...input, bookingId: input.bookingId.trim(), startAt: input.startAt, reference: input.reference.trim(), idempotencyKey: input.idempotencyKey.trim(), workerId: input.workerId.trim() } : null; }
function cancelInput(input: { readonly bookingId: string; readonly idempotencyKey: string; readonly workerId: string }) { return valid(input.bookingId, input.idempotencyKey, input.workerId) ? { ...input, bookingId: input.bookingId.trim(), idempotencyKey: input.idempotencyKey.trim(), workerId: input.workerId.trim() } : null; }
function valid(...values: readonly string[]): boolean { return values.every(value => typeof value === "string" && !!value.trim() && value.length <= 200); }
function instant(value: string): boolean { try { validateInstant(value); return true; } catch { return false; } }
async function local(run: () => Promise<SchedulingBooking>): Promise<RoutedBookingWriteOutcome> { try { return { kind: "success", booking: await run() }; } catch (error: unknown) { return error instanceof SchedulingNotFoundError ? { kind: "validation_error" } : error instanceof SchedulingConflictError || error instanceof SchedulingIdempotencyError ? { kind: "conflict" } : { kind: "unavailable" }; } }
function normalizeCreate(result: ExternalCreateResult): RoutedBookingWriteOutcome { if (result.kind === "created") return { kind: "success", booking: result.booking }; if (result.kind === "replayed") return { kind: "replayed", booking: result.booking }; return { kind: result.kind }; }
function normalizeMutation(result: ExternalMutationResult): RoutedBookingWriteOutcome { if (result.kind === "rescheduled" || result.kind === "cancelled" || result.kind === "already_cancelled") return { kind: "success", booking: result.booking }; if (result.kind === "replayed") return { kind: "replayed", booking: result.booking }; return { kind: result.kind }; }
