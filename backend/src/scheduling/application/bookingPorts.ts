import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { SchedulingBooking } from "../domain/scheduling.js";

export type BookingMutationOperation = "create" | "reschedule" | "cancel";
export interface BookingMutation { readonly operation: BookingMutationOperation; readonly idempotencyKey: string; readonly fingerprint: string; readonly bookingId: string; readonly sourceBookingId?: string; readonly serviceId?: string; readonly startAt?: string; readonly reference?: string; readonly at: string; }
export interface BookingRepositoryPort {
  mutate(context: WorkspaceContext, companyId: number, mutation: BookingMutation): Promise<{ readonly kind: "created" | "already_cancelled" | "same" | "divergent" | "not_found" | "conflict"; readonly booking: SchedulingBooking | null }>;
  findBooking(context: WorkspaceContext, companyId: number, bookingId: string): Promise<SchedulingBooking | null>;
}
