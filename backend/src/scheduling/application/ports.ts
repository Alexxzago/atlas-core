import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { SchedulingAvailabilityException, SchedulingBooking, SchedulingBusyInterval, SchedulingHold, SchedulingLocation, SchedulingOccupancy, SchedulingResource, SchedulingService, SchedulingWorkingWindow } from "../domain/scheduling.js";

export interface SchedulingRepositoryPort {
  createLocation(context: WorkspaceContext, value: SchedulingLocation): Promise<SchedulingLocation | null>;
  createResource(context: WorkspaceContext, value: SchedulingResource): Promise<SchedulingResource | null>;
  createService(context: WorkspaceContext, value: SchedulingService): Promise<SchedulingService | null>;
  addWorkingWindow(context: WorkspaceContext, value: SchedulingWorkingWindow): Promise<SchedulingWorkingWindow | null>;
  addException(context: WorkspaceContext, value: SchedulingAvailabilityException): Promise<SchedulingAvailabilityException | null>;
  upsertBusyInterval(context: WorkspaceContext, value: SchedulingBusyInterval): Promise<void>;
  findService(context: WorkspaceContext, companyId: number, id: string): Promise<SchedulingService | null>;
  findResource(context: WorkspaceContext, companyId: number, id: string): Promise<SchedulingResource | null>;
  findHold(context: WorkspaceContext, companyId: number, id: string): Promise<SchedulingHold | null>;
  listWorkingWindows(context: WorkspaceContext, companyId: number, resourceId: string, weekday: number): Promise<readonly SchedulingWorkingWindow[]>;
  listExceptions(context: WorkspaceContext, companyId: number, resourceId: string, localDate: string): Promise<readonly SchedulingAvailabilityException[]>;
  listOccupancy(context: WorkspaceContext, companyId: number, resourceId: string, startAt: string, endAt: string, now: string): Promise<readonly SchedulingOccupancy[]>;
  createHold(context: WorkspaceContext, value: SchedulingHold, capacity: number, now: string): Promise<{ readonly kind: "created" | "same" | "divergent" | "conflict"; readonly hold?: SchedulingHold }>;
  confirmHold(context: WorkspaceContext, companyId: number, holdId: string, booking: SchedulingBooking, capacity: number, now: string): Promise<SchedulingBooking | null>;
  releaseHold(context: WorkspaceContext, companyId: number, holdId: string, now: string): Promise<boolean>;
  cancelBooking(context: WorkspaceContext, companyId: number, bookingId: string, now: string): Promise<SchedulingBooking | null>;
}

export interface ExternalBusySourcePort { isReady(): Promise<boolean>; listBusyIntervals(input: { readonly resourceId: string; readonly startAt: string; readonly endAt: string }): Promise<readonly Omit<SchedulingBusyInterval, "id" | "workspaceId" | "companyId" | "createdAt">[]>; }
