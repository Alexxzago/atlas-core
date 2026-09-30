import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface GoogleCalendarBindingRefreshPort { listCalendars(input: { readonly context: WorkspaceContext; readonly companyId: number; readonly connectionId: string; readonly subject: string }): Promise<{ readonly kind: "success"; readonly subject: string; readonly calendars: readonly { readonly id: string; readonly displayName: string; readonly accessRole: string }[] } | { readonly kind: "revoked" | "unavailable" | "invalid_response" }>; }
export interface BindingStatus { readonly bindingId: string; readonly resourceId: string; readonly calendarId: string; readonly subject: string; readonly state: "active" | "blocked" | "unbound"; readonly version: number; }
export type GoogleCalendarBindingResult = { readonly kind: "bound" | "replayed" | "unbound" | "reconnected"; readonly binding: BindingStatus } | { readonly kind: "not_found" | "invalid" | "conflict" | "blocked" | "revoked" | "unavailable" };
interface Row extends Record<string, unknown> { id:string; binding_id:string; resource_id:string; integration_connection_id:string; external_calendar_id:string; state:"active"|"blocked"|"unbound"; version:number; google_subject:string; calendar_id:string; access_role:string; authorization_status:"active"|"revoked"; connection_status:"active"|"inactive"; connection_id:string; }

/** Administrative boundary: subjects and connection ids are derived from persisted authorization only. */
export class GoogleCalendarBindingService {
  public constructor(private readonly database: SqlDatabase, private readonly refreshPort: GoogleCalendarBindingRefreshPort, private readonly clock: { now(): string }) {}
  public async bind(context: WorkspaceContext, companyId: number, input: { readonly resourceId: string; readonly calendarId: string; readonly expectedVersion?: number }): Promise<GoogleCalendarBindingResult> {
    if (!resourceId(input.resourceId) || !calendarId(input.calendarId) || !expected(input.expectedVersion)) return { kind: "not_found" };
    const now = this.clock.now();
    return this.database.transaction(async database => {
      const authorization = await authorizationFor(database, context, companyId);
      if (!authorization) return { kind: "not_found" };
      if (authorization.status !== "active" || authorization.connectionStatus !== "active") return { kind: "revoked" };
      const access = (await database.query<Row>("SELECT access_role FROM google_calendar_accesses WHERE integration_connection_id=? AND workspace_id=? AND company_id=? AND calendar_id=? AND updated_at>=?", [authorization.connectionId, context.workspaceId, companyId, input.calendarId, fresh(now)]))[0];
      if (!access || !writable(access.access_role)) return { kind: "not_found" };
      if (!(await database.query<Row>("SELECT id FROM scheduling_resources WHERE id=? AND workspace_id=? AND company_id=? AND active=1", [input.resourceId, context.workspaceId, companyId]))[0]) return { kind: "not_found" };
      const current = await byResource(database, context, companyId, input.resourceId);
      const used = (await database.query<Row>("SELECT binding_id FROM google_calendar_company_bindings WHERE workspace_id=? AND company_id=? AND google_subject=? AND calendar_id=? AND state='active'", [context.workspaceId, companyId, authorization.subject, input.calendarId]))[0];
      if (used && used.binding_id !== current?.id) return { kind: "conflict" };
      if (current) {
        if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) return { kind: "conflict" };
        if (current.state === "active" && current.external_calendar_id === input.calendarId && current.integration_connection_id === authorization.connectionId && current.google_subject === authorization.subject) return { kind: "replayed", binding: status(current) };
        if (await hasBlockers(database, context, companyId, current.id)) return { kind: "blocked" };
        if (Number((await database.execute("UPDATE scheduling_external_resource_bindings SET integration_connection_id=?,external_calendar_id=?,state='active',version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND version=?", [authorization.connectionId, input.calendarId, now, current.id, context.workspaceId, companyId, current.version])).rowsAffected) !== 1) return { kind: "conflict" };
        await database.execute("UPDATE google_calendar_company_bindings SET google_subject=?,calendar_id=?,state='active',version=version+1,updated_at=? WHERE binding_id=? AND workspace_id=? AND company_id=?", [authorization.subject, input.calendarId, now, current.id, context.workspaceId, companyId]);
        return { kind: "bound", binding: status((await byId(database, context, companyId, current.id))!) };
      }
      const bindingId = `ecb_${randomUUID().replaceAll("-", "")}`;
      await database.execute("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at,state,version) VALUES(?,?,?,?,?,?,?,?, 'active',1)", [bindingId, context.workspaceId, companyId, input.resourceId, authorization.connectionId, input.calendarId, now, now]);
      await database.execute("INSERT INTO google_calendar_company_bindings(binding_id,workspace_id,company_id,google_subject,calendar_id,created_at,state,version,updated_at) VALUES(?,?,?,?,?,?, 'active',1,?)", [bindingId, context.workspaceId, companyId, authorization.subject, input.calendarId, now, now]);
      return { kind: "bound", binding: status((await byId(database, context, companyId, bindingId))!) };
    });
  }
  public async unbind(context: WorkspaceContext, companyId: number, input: { readonly resourceId: string; readonly expectedVersion: number }): Promise<GoogleCalendarBindingResult> {
    if (!resourceId(input.resourceId) || !expected(input.expectedVersion)) return { kind: "not_found" };
    return this.database.transaction(async database => {
      const current = await byResource(database, context, companyId, input.resourceId); if (!current) return { kind: "not_found" };
      if (current.version !== input.expectedVersion) return { kind: "conflict" }; if (current.state === "unbound") return { kind: "replayed", binding: status(current) };
      if (await hasBlockers(database, context, companyId, current.id)) return { kind: "blocked" };
      const now = this.clock.now(); await setState(database, context, companyId, current.id, "unbound", now, current.version);
      return { kind: "unbound", binding: status((await byId(database, context, companyId, current.id))!) };
    });
  }
  public async reconnect(context: WorkspaceContext, companyId: number, input: { readonly resourceId: string; readonly expectedVersion: number }): Promise<GoogleCalendarBindingResult> {
    const current = await this.status(context, companyId, input.resourceId); if (!current) return { kind: "not_found" }; if (current.version !== input.expectedVersion) return { kind: "conflict" };
    const authorization = await authorizationFor(this.database, context, companyId); if (!authorization || authorization.status !== "active" || authorization.connectionStatus !== "active") return { kind: "revoked" };
    const result = await this.refreshPort.listCalendars({ context, companyId, connectionId: authorization.connectionId, subject: authorization.subject });
    if (result.kind === "revoked") { await this.block(context, companyId, current.bindingId); return { kind: "revoked" }; }
    if (result.kind !== "success" || result.subject !== authorization.subject) { await this.block(context, companyId, current.bindingId); return { kind: result.kind === "unavailable" ? "unavailable" : "invalid" }; }
    const selected = result.calendars.find(calendar => calendar.id === current.calendarId && writable(calendar.accessRole));
    if (!selected) { await this.block(context, companyId, current.bindingId); return { kind: "invalid" }; }
    const now = this.clock.now(); await this.database.transaction(async database => { await database.execute("DELETE FROM google_calendar_accesses WHERE integration_connection_id=?", [authorization.connectionId]); for (const calendar of result.calendars) await database.execute("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)", [authorization.connectionId, context.workspaceId, companyId, calendar.id, calendar.displayName, calendar.accessRole, now]); await setState(database, context, companyId, current.bindingId, "active", now, current.version); });
    return { kind: "reconnected", binding: (await this.status(context, companyId, input.resourceId))! };
  }
  public async status(context: WorkspaceContext, companyId: number, resource: string): Promise<BindingStatus | null> { const row = await byResource(this.database, context, companyId, resource); return row ? status(row) : null; }
  private async block(context: WorkspaceContext, companyId: number, bindingId: string): Promise<void> { await this.database.transaction(async database => { const row = await byId(database, context, companyId, bindingId); if (row && row.state !== "blocked") await setState(database, context, companyId, bindingId, "blocked", this.clock.now(), row.version); }); }
}
function resourceId(value:string):boolean{return /^src_[a-f0-9]{32}$/.test(value);} function calendarId(value:string):boolean{return typeof value==="string"&&value.trim().length>0&&value.length<=200;} function expected(value:number|undefined):boolean{return value===undefined||(Number.isSafeInteger(value)&&value>0);} function writable(role:string):boolean{return role==="owner"||role==="writer";} function fresh(now:string):string{return new Date(Date.parse(now)-900000).toISOString();} function status(row:Row):BindingStatus{return Object.freeze({bindingId:row.id,resourceId:row.resource_id,calendarId:row.calendar_id,subject:row.google_subject,state:row.state,version:Number(row.version)});}
async function authorizationFor(database:SqlDatabase,context:WorkspaceContext,companyId:number):Promise<{connectionId:string;subject:string;status:"active"|"revoked";connectionStatus:"active"|"inactive"}|null>{const row=(await database.query<Row>("SELECT a.integration_connection_id AS connection_id,a.google_subject,a.status AS authorization_status,i.status AS connection_status FROM google_calendar_authorizations a JOIN integration_connections i ON i.id=a.integration_connection_id AND i.workspace_id=a.workspace_id AND i.company_id=a.company_id WHERE a.workspace_id=? AND a.company_id=? ORDER BY a.updated_at DESC LIMIT 1",[context.workspaceId,companyId]))[0];return row?{connectionId:row.connection_id,subject:row.google_subject,status:row.authorization_status,connectionStatus:row.connection_status}:null;}
async function byResource(database:SqlDatabase,context:WorkspaceContext,companyId:number,resource:string):Promise<Row|undefined>{return (await database.query<Row>("SELECT b.*,g.google_subject,g.calendar_id FROM scheduling_external_resource_bindings b JOIN google_calendar_company_bindings g ON g.binding_id=b.id WHERE b.workspace_id=? AND b.company_id=? AND b.resource_id=? ORDER BY b.created_at DESC LIMIT 1",[context.workspaceId,companyId,resource]))[0];} async function byId(database:SqlDatabase,context:WorkspaceContext,companyId:number,id:string):Promise<Row|undefined>{return (await database.query<Row>("SELECT b.*,g.google_subject,g.calendar_id FROM scheduling_external_resource_bindings b JOIN google_calendar_company_bindings g ON g.binding_id=b.id WHERE b.id=? AND b.workspace_id=? AND b.company_id=?",[id,context.workspaceId,companyId]))[0];}
async function setState(database:SqlDatabase,context:WorkspaceContext,companyId:number,id:string,state:"active"|"blocked"|"unbound",now:string,version:number):Promise<void>{await database.execute("UPDATE scheduling_external_resource_bindings SET state=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND version=?",[state,now,id,context.workspaceId,companyId,version]);await database.execute("UPDATE google_calendar_company_bindings SET state=?,version=version+1,updated_at=? WHERE binding_id=? AND workspace_id=? AND company_id=?",[state,now,id,context.workspaceId,companyId]);}
async function hasBlockers(database:SqlDatabase,context:WorkspaceContext,companyId:number,bindingId:string):Promise<boolean>{const rows=await database.query<{id:string}>("SELECT e.id FROM scheduling_external_booking_events e JOIN scheduling_bookings b ON b.id=e.booking_id WHERE e.workspace_id=? AND e.company_id=? AND e.binding_id=? AND b.state='confirmed' UNION SELECT s.booking_id FROM scheduling_calendar_sync_statuses s JOIN scheduling_bookings b ON b.id=s.booking_id WHERE s.workspace_id=? AND s.company_id=? AND s.binding_id=? AND b.state='confirmed' UNION SELECT id FROM scheduling_calendar_sync_outbox WHERE workspace_id=? AND company_id=? AND binding_id=? AND state IN ('pending','retryable','leased','conflict') LIMIT 1",[context.workspaceId,companyId,bindingId,context.workspaceId,companyId,bindingId,context.workspaceId,companyId,bindingId]);return rows.length>0;}
