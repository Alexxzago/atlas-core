import type { SqlDatabase } from "../config/sqlDatabase.js";
import type { BookingMutation, BookingRepositoryPort } from "../scheduling/application/bookingPorts.js";
import { reconstructBooking, schedulingBookingId, schedulingHoldId, schedulingServiceId, type SchedulingBooking } from "../scheduling/domain/scheduling.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface Row extends Record<string, unknown> { id: string; workspace_id: number; company_id: number; service_id: string; hold_id: string | null; rescheduled_from_booking_id: string | null; reference: string; start_at: string; end_at: string; occupied_start_at: string; occupied_end_at: string; state: "active" | "confirmed" | "cancelled"; created_at: string; cancelled_at: string | null; resource_id: string; timezone: string; capacity: number; duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number; minimum_lead_minutes: number; maximum_horizon_days: number; active: number; start_time: string | null; end_time: string | null; kind: "closed" | "open"; }
type MutationResult = { readonly kind: "created" | "already_cancelled" | "same" | "divergent" | "not_found" | "conflict"; readonly booking: SchedulingBooking | null };

/** Persists externally visible booking commands as fully validated atomic scheduling changes. */
export class BookingRepository implements BookingRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}
  public async findBooking(context: WorkspaceContext, companyId: number, bookingId: string): Promise<SchedulingBooking | null> { return find(this.database, context, companyId, bookingId); }
  public async mutate(context: WorkspaceContext, companyId: number, mutation: BookingMutation): Promise<MutationResult> {
    return this.database.transaction(async database => {
      const existing = await database.query<{ request_fingerprint: string; booking_id: string; outcome: "created" | "already_cancelled" }>("SELECT request_fingerprint,booking_id,outcome FROM scheduling_booking_mutations WHERE workspace_id=? AND company_id=? AND operation=? AND idempotency_key=?", [context.workspaceId, companyId, mutation.operation, mutation.idempotencyKey]);
      if (existing[0]) return existing[0].request_fingerprint === mutation.fingerprint ? { kind: existing[0].outcome === "already_cancelled" ? "already_cancelled" as const : "same" as const, booking: await find(database, context, companyId, existing[0].booking_id) } : { kind: "divergent" as const, booking: null };
      if (mutation.operation === "cancel") return this.cancel(database, context, companyId, mutation);
      return this.confirm(database, context, companyId, mutation);
    });
  }
  private async confirm(database: SqlDatabase, context: WorkspaceContext, companyId: number, mutation: BookingMutation): Promise<MutationResult> {
    let source: SchedulingBooking | null = null;
    if (mutation.operation === "reschedule") {
      source = await find(database, context, companyId, mutation.sourceBookingId!);
      if (!source) return { kind: "not_found", booking: null };
      if (source.state !== "confirmed") return { kind: "conflict", booking: null };
    }
    const serviceId = mutation.operation === "create" ? mutation.serviceId! : source!.serviceId;
    const serviceRows = await database.query<Row>("SELECT s.*,r.timezone,r.capacity,r.active AS resource_active FROM scheduling_services s JOIN scheduling_resources r ON r.id=s.resource_id WHERE s.id=? AND s.workspace_id=? AND s.company_id=? AND s.active=1 AND r.workspace_id=? AND r.company_id=? AND r.active=1", [serviceId, context.workspaceId, companyId, context.workspaceId, companyId]);
    const service = serviceRows[0];
    if (!service) return { kind: "not_found", booking: null };
    const startAt = mutation.startAt!, endAt = new Date(Date.parse(startAt) + Number(service.duration_minutes) * 60_000).toISOString(), occupiedStartAt = shift(startAt, -Number(service.buffer_before_minutes)), occupiedEndAt = shift(endAt, Number(service.buffer_after_minutes));
    if (!await validSlot(database, context, companyId, service, startAt, endAt, occupiedStartAt, occupiedEndAt, mutation.at, source?.id ?? null)) return { kind: "conflict", booking: null };
    const holdId = `shd_${mutation.bookingId.slice(4)}`;
    const held = await database.execute("INSERT INTO scheduling_holds(id,workspace_id,company_id,service_id,idempotency_key,start_at,end_at,occupied_start_at,occupied_end_at,expires_at,state,created_at,released_at) VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,NULL)", [holdId, context.workspaceId, companyId, serviceId, `booking:${mutation.idempotencyKey}`, startAt, endAt, occupiedStartAt, occupiedEndAt, mutation.at, mutation.at]);
    if (Number(held.rowsAffected) !== 1) return { kind: "conflict", booking: null };
    const inserted = await database.execute("INSERT INTO scheduling_bookings(id,workspace_id,company_id,service_id,hold_id,rescheduled_from_booking_id,reference,start_at,end_at,occupied_start_at,occupied_end_at,state,created_at,cancelled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'confirmed',?,NULL)", [mutation.bookingId, context.workspaceId, companyId, serviceId, holdId, source?.id ?? null, mutation.reference!, startAt, endAt, occupiedStartAt, occupiedEndAt, mutation.at]);
    if (Number(inserted.rowsAffected) !== 1) return { kind: "conflict", booking: null };
    if (source) {
      const cancelled = await database.execute("UPDATE scheduling_bookings SET state='cancelled',cancelled_at=? WHERE id=? AND workspace_id=? AND company_id=? AND state='confirmed'", [mutation.at, source.id, context.workspaceId, companyId]);
      if (Number(cancelled.rowsAffected) !== 1) return { kind: "conflict", booking: null };
    }
    const consumed = await database.execute("UPDATE scheduling_holds SET state='released',released_at=? WHERE id=? AND workspace_id=? AND company_id=? AND state='active'", [mutation.at, holdId, context.workspaceId, companyId]);
    if (Number(consumed.rowsAffected) !== 1) return { kind: "conflict", booking: null };
    await this.audit(database, context, companyId, mutation, mutation.operation === "create" ? "created" : "rescheduled", mutation.bookingId);
    return { kind: "created", booking: await find(database, context, companyId, mutation.bookingId) };
  }
  private async cancel(database: SqlDatabase, context: WorkspaceContext, companyId: number, mutation: BookingMutation): Promise<MutationResult> {
    const current = await find(database, context, companyId, mutation.sourceBookingId!); if (!current) return { kind: "not_found", booking: null };
    if (current.state === "cancelled") { await this.audit(database, context, companyId, mutation, null, current.id, "already_cancelled"); return { kind: "already_cancelled", booking: current }; }
    if (current.state !== "confirmed") return { kind: "conflict", booking: null };
    const updated = await database.execute("UPDATE scheduling_bookings SET state='cancelled',cancelled_at=? WHERE id=? AND workspace_id=? AND company_id=? AND state='confirmed'", [mutation.at, current.id, context.workspaceId, companyId]); if (Number(updated.rowsAffected) !== 1) return { kind: "conflict", booking: null };
    await this.audit(database, context, companyId, mutation, "cancelled", current.id);
    return { kind: "created", booking: await find(database, context, companyId, current.id) };
  }
  private async audit(database: SqlDatabase, context: WorkspaceContext, companyId: number, mutation: BookingMutation, event: "created" | "rescheduled" | "cancelled" | null, bookingId: string, outcome: "created" | "already_cancelled" = "created"): Promise<void> {
    const mutationId = `sbm_${mutation.bookingId.slice(4)}`;
    await database.execute("INSERT INTO scheduling_booking_mutations(id,workspace_id,company_id,idempotency_key,operation,request_fingerprint,booking_id,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?)", [mutationId, context.workspaceId, companyId, mutation.idempotencyKey, mutation.operation, mutation.fingerprint, bookingId, outcome, mutation.at]);
    if (event) await database.execute("INSERT INTO scheduling_booking_audit_events(id,workspace_id,company_id,booking_id,mutation_id,event_type,occurred_at) VALUES(?,?,?,?,?,?,?)", [`sba_${mutation.bookingId.slice(4)}`, context.workspaceId, companyId, bookingId, mutationId, event, mutation.at]);
  }
}
async function validSlot(database: SqlDatabase, context: WorkspaceContext, companyId: number, service: Row, startAt: string, endAt: string, occupiedStartAt: string, occupiedEndAt: string, now: string, excludedBookingId: string | null): Promise<boolean> {
  const local = localParts(startAt, service.timezone), endLocal = localParts(endAt, service.timezone), occupiedStartLocal = localParts(occupiedStartAt, service.timezone), occupiedEndLocal = localParts(occupiedEndAt, service.timezone);
  if (Date.parse(startAt) < Date.parse(now) + Number(service.minimum_lead_minutes) * 60_000 || Date.parse(startAt) > Date.parse(now) + Number(service.maximum_horizon_days) * 86_400_000 || local.date !== endLocal.date || local.time !== time(minutes(local.time)) || occupiedStartLocal.date !== occupiedEndLocal.date) return false;
  const windows = await effectiveWindows(database, context, companyId, service.resource_id, occupiedStartLocal.weekday, occupiedStartLocal.date);
  if (!windows.some(window => window.startTime <= occupiedStartLocal.time && window.endTime >= occupiedEndLocal.time)) return false;
  const occupancy = await database.query<Row>("SELECT h.occupied_start_at AS start_at,h.occupied_end_at AS end_at,1 AS units FROM scheduling_holds h JOIN scheduling_services s ON s.id=h.service_id WHERE h.workspace_id=? AND h.company_id=? AND s.resource_id=? AND h.state='active' AND h.expires_at>? AND h.occupied_start_at<? AND h.occupied_end_at>? UNION ALL SELECT b.occupied_start_at,b.occupied_end_at,1 FROM scheduling_bookings b JOIN scheduling_services s ON s.id=b.service_id WHERE b.workspace_id=? AND b.company_id=? AND s.resource_id=? AND b.state='confirmed' AND b.id!=? AND b.occupied_start_at<? AND b.occupied_end_at>? UNION ALL SELECT start_at,end_at,units FROM scheduling_busy_intervals WHERE workspace_id=? AND company_id=? AND resource_id=? AND start_at<? AND end_at>?", [context.workspaceId, companyId, service.resource_id, now, occupiedEndAt, occupiedStartAt, context.workspaceId, companyId, service.resource_id, excludedBookingId ?? "", occupiedEndAt, occupiedStartAt, context.workspaceId, companyId, service.resource_id, occupiedEndAt, occupiedStartAt]);
  const events = [{ at: occupiedStartAt, delta: 0 }, { at: occupiedEndAt, delta: 0 }, ...occupancy.flatMap(row => [{ at: String(row.start_at), delta: Number(row.units) }, { at: String(row.end_at), delta: -Number(row.units) }])].sort((left, right) => left.at.localeCompare(right.at) || left.delta - right.delta);
  let used = 0; for (const event of events) { used += event.delta; if (event.at >= occupiedStartAt && event.at < occupiedEndAt && used >= Number(service.capacity)) return false; }
  return true;
}
async function effectiveWindows(database: SqlDatabase, context: WorkspaceContext, companyId: number, resourceId: string, weekday: number, localDate: string): Promise<readonly { readonly startTime: string; readonly endTime: string }[]> {
  const exceptions = await database.query<Row>("SELECT kind,start_time,end_time FROM scheduling_availability_exceptions WHERE workspace_id=? AND company_id=? AND resource_id=? AND local_date=?", [context.workspaceId, companyId, resourceId, localDate]);
  const closed = exceptions.filter(row => row.kind === "closed"), opened = exceptions.filter(row => row.kind === "open" && row.start_time !== null).map(row => ({ startTime: row.start_time, endTime: row.end_time }));
  if (closed.some(row => row.start_time === null)) return opened as readonly { readonly startTime: string; readonly endTime: string }[];
  const base = await database.query<Row>("SELECT start_time,end_time FROM scheduling_working_windows WHERE workspace_id=? AND company_id=? AND resource_id=? AND weekday=?", [context.workspaceId, companyId, resourceId, weekday]);
  let result: { startTime: string; endTime: string }[] = base.filter(row => row.start_time !== null && row.end_time !== null).map(row => ({ startTime: row.start_time!, endTime: row.end_time! }));
  for (const exception of closed) { const start = exception.start_time!, end = exception.end_time!; result = result.flatMap(window => end <= window.startTime || start >= window.endTime ? [window] : [...(start > window.startTime ? [{ startTime: window.startTime, endTime: start }] : []), ...(end < window.endTime ? [{ startTime: end, endTime: window.endTime }] : [])]); }
  return [...result, ...opened] as readonly { readonly startTime: string; readonly endTime: string }[];
}
async function find(database: SqlDatabase, context: WorkspaceContext, companyId: number, id: string): Promise<SchedulingBooking | null> { const rows = await database.query<Row>("SELECT * FROM scheduling_bookings WHERE id=? AND workspace_id=? AND company_id=?", [id, context.workspaceId, companyId]); return rows[0] ? booking(rows[0]) : null; }
function booking(row: Row): SchedulingBooking { return reconstructBooking({ id: schedulingBookingId(row.id), workspaceId: row.workspace_id, companyId: row.company_id, serviceId: schedulingServiceId(row.service_id), holdId: row.hold_id === null ? null : schedulingHoldId(row.hold_id), rescheduledFromBookingId: row.rescheduled_from_booking_id === null ? null : schedulingBookingId(row.rescheduled_from_booking_id), reference: row.reference, startAt: row.start_at, endAt: row.end_at, occupiedStartAt: row.occupied_start_at, occupiedEndAt: row.occupied_end_at, state: row.state as SchedulingBooking["state"], createdAt: row.created_at, cancelledAt: row.cancelled_at }); }
function shift(value: string, minutes: number): string { return new Date(Date.parse(value) + minutes * 60_000).toISOString(); }
function minutes(value: string): number { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); }
function time(value: number): string { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function localParts(value: string, timezone: string): { readonly date: string; readonly weekday: number; readonly time: string } { const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)); const get = (part: Intl.DateTimeFormatPartTypes): string => parts.find(item => item.type === part)?.value ?? ""; const day: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }; return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: day[get("weekday")] ?? -1, time: `${get("hour")}:${get("minute")}` }; }
