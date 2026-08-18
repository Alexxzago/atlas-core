import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { BookingRepositoryPort } from "../application/bookingPorts.js";
import type { SchedulingBooking } from "../domain/scheduling.js";
import { SchedulingNotFoundError } from "./schedulingService.js";
export class BookingQueryService { public constructor(private readonly repository: BookingRepositoryPort) {} public async get(context: WorkspaceContext, companyId: number, bookingId: string): Promise<SchedulingBooking> { const booking = await this.repository.findBooking(context, companyId, bookingId); if (!booking) throw new SchedulingNotFoundError("Scheduling booking was not found."); return booking; } }
