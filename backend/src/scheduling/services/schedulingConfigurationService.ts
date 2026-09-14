import { createHash, randomUUID } from "node:crypto";
import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { SchedulingConfigurationRepository } from "../../repositories/schedulingConfigurationRepository.js";
import { reconstructException, reconstructLocation, reconstructResource, reconstructService, reconstructWorkingWindow, SchedulingError } from "../domain/scheduling.js";

export class SchedulingConfigurationConflictError extends Error {}
export class SchedulingConfigurationNotFoundError extends Error {}

export class SchedulingConfigurationService {
  public constructor(private readonly repository: SchedulingConfigurationRepository, private readonly clock: { now(): string }) {}
  public async read(context: WorkspaceContext, companyId: number): Promise<Record<string, unknown>> {
    const value = await this.repository.read(context, companyId);
    if (!value) throw new SchedulingConfigurationNotFoundError();
    const resources = value.resources as Array<Record<string, unknown>>, services = value.services as Array<Record<string, unknown>>, windows = value.weeklyWorkingWindows as unknown[];
    return { ...value, readiness: { state: services.some(item => item.active) && windows.length ? "locally_configured" : resources.length || services.length ? "minimal" : "not_configured", hasLocations: (value.locations as unknown[]).length > 0, hasResources: resources.length > 0, hasServices: services.length > 0, hasWeeklyAvailability: windows.length > 0 } };
  }
  public async command(context: WorkspaceContext, companyId: number, actorId: string, input: unknown): Promise<Record<string, unknown>> {
    const body = object(input), operationId = text(body.operationId, 200), expectedVersion = positive(body.expectedVersion), operation = text(body.operation, 100), payload = object(body.payload), fingerprint = createHash("sha256").update(canonical({ operation, expectedVersion, payload })).digest("hex"), at = this.clock.now();
    const result = await this.repository.mutate(context, companyId, { operationId, operation, fingerprint, expectedVersion, actorId, at, apply: db => this.apply(db, context, companyId, operation, payload, at) });
    if (result.kind === "divergent") throw new SchedulingConfigurationConflictError("Operation ID has a different request.");
    if (result.kind === "stale") throw new SchedulingConfigurationConflictError("Scheduling configuration has changed.");
    return result.result;
  }
  private async apply(db: SqlDatabase, context: WorkspaceContext, companyId: number, operation: string, payload: Record<string, unknown>, at: string): Promise<{ entityType: string; entityId: string; action: string }> {
    if (operation === "create_location") {
      const id = `slc_${randomUUID().replaceAll("-", "")}`, value = reconstructLocation({ id: id as never, workspaceId: context.workspaceId, companyId, name: text(payload.name, 200), address: nullableText(payload.address, 500), timezone: text(payload.timezone, 100), active: true, createdAt: at, updatedAt: at });
      await db.execute("INSERT INTO scheduling_locations(id,workspace_id,company_id,name,normalized_name,address,timezone,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [value.id, context.workspaceId, companyId, value.name, normalized(value.name), value.address, value.timezone, 1, at, at]);
      return { entityType: "location", entityId: id, action: "created" };
    }
    if (operation === "create_resource") {
      const id = `src_${randomUUID().replaceAll("-", "")}`, locationId = payload.locationId === undefined ? null : text(payload.locationId, 100), value = reconstructResource({ id: id as never, workspaceId: context.workspaceId, companyId, locationId: locationId as never, name: text(payload.name, 200), timezone: text(payload.timezone, 100), capacity: payload.capacity === undefined ? 1 : positive(payload.capacity), active: true, createdAt: at, updatedAt: at });
      const result = await db.execute("INSERT INTO scheduling_resources(id,workspace_id,company_id,location_id,name,normalized_name,timezone,capacity,active,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,1,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM scheduling_locations WHERE id=? AND workspace_id=? AND company_id=?)", [value.id, context.workspaceId, companyId, value.locationId, value.name, normalized(value.name), value.timezone, value.capacity, at, at, value.locationId, value.locationId, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) !== 1) throw new SchedulingError("Scheduling location was not found.");
      return { entityType: "resource", entityId: id, action: "created" };
    }
    if (operation === "create_service") {
      const id = `ssv_${randomUUID().replaceAll("-", "")}`, resourceId = text(payload.resourceId, 100), value = reconstructService({ id: id as never, workspaceId: context.workspaceId, companyId, resourceId: resourceId as never, name: text(payload.name, 200), durationMinutes: positive(payload.durationMinutes), bufferBeforeMinutes: payload.bufferBeforeMinutes === undefined ? 0 : nonnegative(payload.bufferBeforeMinutes), bufferAfterMinutes: payload.bufferAfterMinutes === undefined ? 0 : nonnegative(payload.bufferAfterMinutes), slotGranularityMinutes: payload.slotGranularityMinutes === undefined ? 15 : positive(payload.slotGranularityMinutes), minimumLeadMinutes: payload.minimumLeadMinutes === undefined ? 0 : nonnegative(payload.minimumLeadMinutes), maximumHorizonDays: payload.maximumHorizonDays === undefined ? 30 : positive(payload.maximumHorizonDays), active: true, createdAt: at, updatedAt: at });
      const result = await db.execute("INSERT INTO scheduling_services(id,workspace_id,company_id,resource_id,name,normalized_name,duration_minutes,buffer_before_minutes,buffer_after_minutes,slot_granularity_minutes,minimum_lead_minutes,maximum_horizon_days,active,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM scheduling_resources WHERE id=? AND workspace_id=? AND company_id=? AND active=1)", [value.id, context.workspaceId, companyId, resourceId, value.name, normalized(value.name), value.durationMinutes, value.bufferBeforeMinutes, value.bufferAfterMinutes, value.slotGranularityMinutes, value.minimumLeadMinutes, value.maximumHorizonDays, at, at, resourceId, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) !== 1) throw new SchedulingError("Scheduling resource was not found.");
      return { entityType: "service", entityId: id, action: "created" };
    }
    if (operation === "update_location") {
      const id = text(payload.locationId, 100), value = reconstructLocation({ id: id as never, workspaceId: context.workspaceId, companyId, name: text(payload.name, 200), address: nullableText(payload.address, 500), timezone: text(payload.timezone, 100), active: boolean(payload.active), createdAt: at, updatedAt: at });
      const result = await db.execute("UPDATE scheduling_locations SET name=?,normalized_name=?,address=?,timezone=?,active=?,updated_at=? WHERE id=? AND workspace_id=? AND company_id=?", [value.name, normalized(value.name), value.address, value.timezone, Number(value.active), at, id, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) !== 1) throw new SchedulingError("Scheduling location was not found.");
      return { entityType: "location", entityId: id, action: "updated" };
    }
    if (operation === "update_resource") {
      const id = text(payload.resourceId, 100), locationId = payload.locationId === null ? null : text(payload.locationId, 100), value = reconstructResource({ id: id as never, workspaceId: context.workspaceId, companyId, locationId: locationId as never, name: text(payload.name, 200), timezone: text(payload.timezone, 100), capacity: positive(payload.capacity), active: boolean(payload.active), createdAt: at, updatedAt: at });
      const result = await db.execute("UPDATE scheduling_resources SET location_id=?,name=?,normalized_name=?,timezone=?,capacity=?,active=?,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND (? IS NULL OR EXISTS(SELECT 1 FROM scheduling_locations WHERE id=? AND workspace_id=? AND company_id=?))", [value.locationId, value.name, normalized(value.name), value.timezone, value.capacity, Number(value.active), at, id, context.workspaceId, companyId, value.locationId, value.locationId, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) !== 1) throw new SchedulingError("Scheduling resource or location was not found.");
      return { entityType: "resource", entityId: id, action: "updated" };
    }
    if (operation === "update_service") {
      const id = text(payload.serviceId, 100), resourceId = text(payload.resourceId, 100), value = reconstructService({ id: id as never, workspaceId: context.workspaceId, companyId, resourceId: resourceId as never, name: text(payload.name, 200), durationMinutes: positive(payload.durationMinutes), bufferBeforeMinutes: nonnegative(payload.bufferBeforeMinutes), bufferAfterMinutes: nonnegative(payload.bufferAfterMinutes), slotGranularityMinutes: positive(payload.slotGranularityMinutes), minimumLeadMinutes: nonnegative(payload.minimumLeadMinutes), maximumHorizonDays: positive(payload.maximumHorizonDays), active: boolean(payload.active), createdAt: at, updatedAt: at });
      const result = await db.execute("UPDATE scheduling_services SET resource_id=?,name=?,normalized_name=?,duration_minutes=?,buffer_before_minutes=?,buffer_after_minutes=?,slot_granularity_minutes=?,minimum_lead_minutes=?,maximum_horizon_days=?,active=?,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND EXISTS(SELECT 1 FROM scheduling_resources WHERE id=? AND workspace_id=? AND company_id=?)", [value.resourceId, value.name, normalized(value.name), value.durationMinutes, value.bufferBeforeMinutes, value.bufferAfterMinutes, value.slotGranularityMinutes, value.minimumLeadMinutes, value.maximumHorizonDays, Number(value.active), at, id, context.workspaceId, companyId, value.resourceId, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) !== 1) throw new SchedulingError("Scheduling service or resource was not found.");
      return { entityType: "service", entityId: id, action: "updated" };
    }
    if (operation === "replace_weekly_availability") {
      const resourceId = text(payload.resourceId, 100), rows = list(payload.windows).map(item => object(item));
      const resource = await db.query<Record<string, unknown>>("SELECT id FROM scheduling_resources WHERE id=? AND workspace_id=? AND company_id=?", [resourceId, context.workspaceId, companyId]);
      if (!resource[0]) throw new SchedulingError("Scheduling resource was not found.");
      const values = rows.map(item => reconstructWorkingWindow({ id: randomUUID().replaceAll("-", ""), resourceId: resourceId as never, weekday: nonnegative(item.weekday), startTime: text(item.startTime, 5), endTime: text(item.endTime, 5) }));
      for (const left of values) for (const right of values) if (left !== right && left.weekday === right.weekday && left.startTime < right.endTime && right.startTime < left.endTime) throw new SchedulingError("Scheduling working windows overlap.");
      await db.execute("DELETE FROM scheduling_working_windows WHERE workspace_id=? AND company_id=? AND resource_id=?", [context.workspaceId, companyId, resourceId]);
      for (const value of values) await db.execute("INSERT INTO scheduling_working_windows(id,workspace_id,company_id,resource_id,weekday,start_time,end_time,created_at) VALUES(?,?,?,?,?,?,?,?)", [value.id, context.workspaceId, companyId, resourceId, value.weekday, value.startTime, value.endTime, at]);
      return { entityType: "resource", entityId: resourceId, action: "weekly_availability_replaced" };
    }
    if (operation === "add_date_exception") {
      const resourceId = text(payload.resourceId, 100), id = randomUUID().replaceAll("-", ""), value = reconstructException({ id, resourceId: resourceId as never, localDate: text(payload.localDate, 10), kind: payload.kind === "open" ? "open" : "closed", startTime: payload.startTime === undefined ? null : text(payload.startTime, 5), endTime: payload.endTime === undefined ? null : text(payload.endTime, 5) });
      const result = await db.execute("INSERT INTO scheduling_availability_exceptions(id,workspace_id,company_id,resource_id,local_date,kind,start_time,end_time) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM scheduling_resources WHERE id=? AND workspace_id=? AND company_id=?)", [id, context.workspaceId, companyId, resourceId, value.localDate, value.kind, value.startTime, value.endTime, resourceId, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) !== 1) throw new SchedulingError("Scheduling resource was not found.");
      return { entityType: "date_exception", entityId: id, action: "added" };
    }
    if (operation === "remove_date_exception") {
      const id = text(payload.exceptionId, 100), result = await db.execute("DELETE FROM scheduling_availability_exceptions WHERE id=? AND workspace_id=? AND company_id=?", [id, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) !== 1) throw new SchedulingError("Scheduling exception was not found.");
      return { entityType: "date_exception", entityId: id, action: "removed" };
    }
    throw new SchedulingError("Scheduling configuration operation is invalid.");
  }
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new SchedulingError("Scheduling configuration request is invalid."); return value as Record<string, unknown>; }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new SchedulingError("Scheduling configuration request is invalid."); return value; }
function text(value: unknown, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new SchedulingError("Scheduling configuration request is invalid."); return value.trim(); }
function nullableText(value: unknown, maximum: number): string | null { return value === undefined || value === null ? null : text(value, maximum); }
function positive(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new SchedulingError("Scheduling configuration request is invalid."); return Number(value); }
function nonnegative(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new SchedulingError("Scheduling configuration request is invalid."); return Number(value); }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new SchedulingError("Scheduling configuration request is invalid."); return value; }
function normalized(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }
function canonical(value: unknown): string { if (value === null || ["string", "number", "boolean"].includes(typeof value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; const row = object(value); return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`; }
