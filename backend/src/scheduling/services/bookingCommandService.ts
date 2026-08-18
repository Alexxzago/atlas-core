import { randomUUID } from "node:crypto";
import type { Clock } from "../../identity/application/ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { BookingRepositoryPort } from "../application/bookingPorts.js";
import { validateInstant, type SchedulingBooking } from "../domain/scheduling.js";
import { SchedulingConflictError, SchedulingIdempotencyError, SchedulingNotFoundError } from "./schedulingService.js";

export class BookingCommandService {
  public constructor(private readonly repository: BookingRepositoryPort, private readonly clock: Clock) {}
  public async create(context: WorkspaceContext, companyId: number, input: { readonly serviceId: string; readonly startAt: string; readonly reference: string; readonly idempotencyKey: string }): Promise<SchedulingBooking> { return this.mutate(context, companyId, "create", input.idempotencyKey, { serviceId: required(input.serviceId), startAt: validateInstant(input.startAt), reference: required(input.reference) }); }
  public async reschedule(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly newStartAt: string; readonly reference: string; readonly idempotencyKey: string }): Promise<SchedulingBooking> { return this.mutate(context, companyId, "reschedule", input.idempotencyKey, { bookingId: required(input.bookingId), startAt: validateInstant(input.newStartAt), reference: required(input.reference) }); }
  public async cancel(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly idempotencyKey: string }): Promise<SchedulingBooking> { return this.mutate(context, companyId, "cancel", input.idempotencyKey, { bookingId: required(input.bookingId) }); }
  public async cancelWithOutcome(context: WorkspaceContext, companyId: number, input: { readonly bookingId: string; readonly idempotencyKey: string }): Promise<{ readonly booking: SchedulingBooking; readonly status: "cancelled" | "already_cancelled" }> {
    const result = await this.repository.mutate(context, companyId, { operation: "cancel", idempotencyKey: required(input.idempotencyKey), fingerprint: JSON.stringify({ operation: "cancel", bookingId: required(input.bookingId) }), bookingId: `sbk_${randomUUID().replaceAll("-", "")}`, sourceBookingId: required(input.bookingId), at: this.clock.now() });
    if (result.kind === "created" || result.kind === "same") return { booking: result.booking!, status: "cancelled" };
    if (result.kind === "already_cancelled") return { booking: result.booking!, status: "already_cancelled" };
    if (result.kind === "divergent") throw new SchedulingIdempotencyError("Scheduling idempotency key has a different payload.");
    if (result.kind === "not_found") throw new SchedulingNotFoundError("Scheduling booking was not found.");
    throw new SchedulingConflictError("Scheduling booking cannot be changed.");
  }
  private async mutate(context: WorkspaceContext, companyId: number, operation: "create" | "reschedule" | "cancel", idempotencyKey: string, value: { readonly bookingId?: string; readonly serviceId?: string; readonly startAt?: string; readonly reference?: string }): Promise<SchedulingBooking> {
    const key = required(idempotencyKey), fingerprint = JSON.stringify({ operation, ...value });
    const result = await this.repository.mutate(context, companyId, { operation, idempotencyKey: key, fingerprint, bookingId: `sbk_${randomUUID().replaceAll("-", "")}`, ...(value.bookingId ? { sourceBookingId: value.bookingId } : {}), ...(value.serviceId ? { serviceId: value.serviceId } : {}), ...(value.startAt ? { startAt: value.startAt } : {}), ...(value.reference ? { reference: value.reference } : {}), at: this.clock.now() });
    if (result.kind === "created" || result.kind === "same" || result.kind === "already_cancelled") return result.booking!;
    if (result.kind === "divergent") throw new SchedulingIdempotencyError("Scheduling idempotency key has a different payload.");
    if (result.kind === "not_found") throw new SchedulingNotFoundError("Scheduling booking was not found.");
    throw new SchedulingConflictError("Scheduling booking cannot be changed.");
  }
}
function required(value: string): string { if (typeof value !== "string" || !value.trim() || value.length > 200) throw new SchedulingConflictError("Scheduling booking input is invalid."); return value.trim(); }
