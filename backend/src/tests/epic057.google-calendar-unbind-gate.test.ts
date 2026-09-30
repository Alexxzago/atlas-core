import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runMigrations } from "../config/migrations.js";
import { createLibsqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { GoogleCalendarBindingService, type GoogleCalendarBindingRefreshPort } from "../scheduling/services/googleCalendarBindingService.js";
import { createWorkspaceContext, type WorkspaceContext } from "../types/workspaceContext.js";

const now = "2026-09-28T12:00:00.000Z";
const resource = "src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherResource = "src_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const connection = "inc_cccccccccccccccccccccccccccccccc";
const otherConnection = "inc_dddddddddddddddddddddddddddddddd";

class Refresh implements GoogleCalendarBindingRefreshPort {
  public response: Awaited<ReturnType<GoogleCalendarBindingRefreshPort["listCalendars"]>> = { kind: "success", subject: "subject-a", calendars: [{ id: "cal-a", displayName: "A", accessRole: "writer" }, { id: "cal-b", displayName: "B", accessRole: "writer" }] };
  public async listCalendars(): Promise<Awaited<ReturnType<GoogleCalendarBindingRefreshPort["listCalendars"]>>> { return this.response; }
}

interface Fixture { readonly database: SqlDatabase; readonly context: WorkspaceContext; readonly companyId: number; readonly otherCompanyId: number; readonly refresh: Refresh; readonly service: GoogleCalendarBindingService; readonly reopen: () => SqlDatabase; readonly close: () => Promise<void>; }
async function fixture(): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), "atlas-unbind-gate-")), path = join(directory, "atlas.sqlite"), sync = new DatabaseSync(path);
  sync.exec("PRAGMA foreign_keys=ON"); runMigrations(sync);
  const context = createWorkspaceContext(new WorkspaceRepository(sync).resolveDefault()), companies = new CompanyRepository(sync), company = companies.create(context, { name: "Unbind gate", website: "https://unbind.test" }), other = companies.create(context, { name: "Other unbind", website: "https://other-unbind.test" });
  for (const [id, companyId, name] of [[resource, company.id, "Room"], [otherResource, other.id, "Other room"]] as const) {
    sync.prepare("INSERT INTO scheduling_resources(id,workspace_id,company_id,location_id,name,normalized_name,timezone,capacity,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, context.workspaceId, companyId, null, name, name.toLowerCase(), "UTC", 1, 1, now, now);
    sync.prepare("INSERT INTO scheduling_services(id,workspace_id,company_id,resource_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,slot_granularity_minutes,minimum_lead_minutes,maximum_horizon_days,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(`svc_${id.slice(4)}`, context.workspaceId, companyId, id, name, 30, 0, 0, 30, 0, 30, 1, now, now);
  }
  for (const [id, companyId, subject] of [[connection, company.id, "subject-a"], [otherConnection, other.id, "subject-b"]] as const) {
    sync.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run(id, context.workspaceId, companyId, "google_calendar", "calendar", now, now);
    sync.prepare("INSERT INTO google_calendar_authorizations(integration_connection_id,workspace_id,company_id,google_subject,status,authorized_at,revoked_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?)").run(id, context.workspaceId, companyId, subject, "active", now, now);
    for (const calendarId of ["cal-a", "cal-b"]) sync.prepare("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, context.workspaceId, companyId, calendarId, calendarId, "writer", now);
  }
  sync.close(); const database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"), refresh = new Refresh(), service = new GoogleCalendarBindingService(database, refresh, { now: () => now });
  return { database, context, companyId: company.id, otherCompanyId: other.id, refresh, service, reopen: () => createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"), close: async () => { await database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} } };
}
async function bind(value: Fixture): Promise<{ bindingId: string; version: number }> { const result = await value.service.bind(value.context, value.companyId, { resourceId: resource, calendarId: "cal-a" }); assert.equal(result.kind, "bound"); if (result.kind !== "bound") throw new Error("binding fixture failed"); return { bindingId: result.binding.bindingId, version: result.binding.version }; }
async function booking(value: Fixture, id: string, state: "confirmed" | "cancelled"): Promise<void> { await value.database.execute("INSERT INTO scheduling_bookings(id,workspace_id,company_id,service_id,hold_id,reference,start_at,end_at,occupied_start_at,occupied_end_at,state,created_at,cancelled_at) VALUES(?,?,?,?,?,?,'2026-10-01T10:00:00.000Z','2026-10-01T10:30:00.000Z','2026-10-01T10:00:00.000Z','2026-10-01T10:30:00.000Z',?,?,?)", [id, value.context.workspaceId, value.companyId, `svc_${resource.slice(4)}`, null, id, state, now, state === "cancelled" ? now : null]); }
async function assertBlocked(value: Fixture, version: number): Promise<void> { assert.equal((await value.service.unbind(value.context, value.companyId, { resourceId: resource, expectedVersion: version })).kind, "blocked"); assert.equal((await value.service.bind(value.context, value.companyId, { resourceId: resource, calendarId: "cal-b", expectedVersion: version })).kind, "blocked"); assert.equal((await value.service.status(value.context, value.companyId, resource))?.calendarId, "cal-a"); }

test("EPIC057 unbind and reassignment fail closed for each durable external obligation", async () => {
  const mapping = await fixture(); try { const current = await bind(mapping); await booking(mapping, "sbk_mapping", "confirmed"); await mapping.database.execute("INSERT INTO scheduling_external_booking_events(id,workspace_id,company_id,booking_id,binding_id,external_event_id,remote_version,remote_state,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,'active',?,?)", ["ebe_mapping", mapping.context.workspaceId, mapping.companyId, "sbk_mapping", current.bindingId, "event-mapping", now, now]); await assertBlocked(mapping, current.version); } finally { await mapping.close(); }
  const sync = await fixture(); try { const current = await bind(sync); await booking(sync, "sbk_sync", "confirmed"); await sync.database.execute("INSERT INTO scheduling_calendar_sync_statuses(booking_id,workspace_id,company_id,binding_id,status,desired_operation,last_provider_evidence_at,last_failure_code,created_at,updated_at) VALUES(?,?,?,?, 'synced','create',NULL,NULL,?,?)", ["sbk_sync", sync.context.workspaceId, sync.companyId, current.bindingId, now, now]); await assertBlocked(sync, current.version); } finally { await sync.close(); }
  for (const [state, suffix] of [["pending", "1"], ["retryable", "2"], ["leased", "3"], ["conflict", "4"]] as const) { const outbox = await fixture(); try { const current = await bind(outbox), id = `cso_${suffix.repeat(32)}`; await booking(outbox, `sbk_${state}`, "cancelled"); await outbox.database.execute("INSERT INTO scheduling_calendar_sync_outbox(id,provider_operation_id,workspace_id,company_id,booking_id,binding_id,operation,idempotency_key,request_fingerprint,state,attempt_count,lease_owner,lease_token,lease_expires_at,last_provider_evidence_at,last_failure_code,created_at,updated_at) VALUES(?,?,?,?,?,?,'cancel',?,? ,?,0,NULL,NULL,NULL,NULL,NULL,?,?)", [id, `ewo_${suffix.repeat(32)}`, outbox.context.workspaceId, outbox.companyId, `sbk_${state}`, current.bindingId, state, "a".repeat(64), state, now, now]); await assertBlocked(outbox, current.version); } finally { await outbox.close(); } }
});

test("EPIC057 unbind preserves history, is CAS-safe, isolates companies, and survives libSQL restart", async () => {
  const value = await fixture(); let restarted: SqlDatabase | null = null; try { const current = await bind(value); await booking(value, "sbk_history", "cancelled"); await value.database.execute("INSERT INTO scheduling_external_booking_events(id,workspace_id,company_id,booking_id,binding_id,external_event_id,remote_version,remote_state,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,'cancelled',?,?)", ["ebe_history", value.context.workspaceId, value.companyId, "sbk_history", current.bindingId, "event-history", now, now]); assert.equal((await value.service.unbind(value.context, value.companyId, { resourceId: resource, expectedVersion: current.version })).kind, "unbound"); assert.deepEqual((await value.database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_bookings WHERE id='sbk_history' UNION ALL SELECT COUNT(*) FROM scheduling_external_booking_events WHERE id='ebe_history'", [])).map(row => Number(row.count)), [1, 1]); assert.equal((await value.service.unbind(value.context, value.companyId, { resourceId: resource, expectedVersion: current.version + 1 })).kind, "replayed"); assert.equal((await value.service.bind(value.context, value.companyId, { resourceId: resource, calendarId: "cal-b", expectedVersion: current.version })).kind, "conflict"); assert.equal(await value.service.status(value.context, value.otherCompanyId, resource), null); assert.equal((await value.service.bind(value.context, value.otherCompanyId, { resourceId: resource, calendarId: "cal-a" })).kind, "not_found"); restarted = value.reopen(); assert.equal((await new GoogleCalendarBindingService(restarted, value.refresh, { now: () => now }).status(value.context, value.companyId, resource))?.state, "unbound"); } finally { if (restarted) await restarted.close(); await value.close(); }
});

test("EPIC057 revoked and subject-mismatched reconnects block without changing a bound calendar", async () => {
  const value = await fixture(); try { const current = await bind(value); value.refresh.response = { kind: "success", subject: "different-subject", calendars: [{ id: "cal-b", displayName: "B", accessRole: "writer" }] }; assert.equal((await value.service.reconnect(value.context, value.companyId, { resourceId: resource, expectedVersion: current.version })).kind, "invalid"); const blocked = await value.service.status(value.context, value.companyId, resource); assert.deepEqual({ state: blocked?.state, calendarId: blocked?.calendarId }, { state: "blocked", calendarId: "cal-a" }); value.refresh.response = { kind: "revoked" }; assert.equal((await value.service.reconnect(value.context, value.companyId, { resourceId: resource, expectedVersion: blocked!.version })).kind, "revoked"); } finally { await value.close(); }
});

test("EPIC057 rolls back a partial binding write when its persisted Google evidence fails", async () => {
  const value = await fixture(); try {
    const failing: SqlDatabase = { execute: (sql, args) => value.database.execute(sql, args), writeBatch: statements => value.database.writeBatch(statements), executeScript: script => value.database.executeScript(script), query: (sql, args) => value.database.query(sql, args), close: () => value.database.close(), transaction: operation => value.database.transaction(transaction => operation({ execute: (sql, args) => sql.startsWith("INSERT INTO google_calendar_company_bindings") ? Promise.reject(new Error("evidence write failed")) : transaction.execute(sql, args), writeBatch: statements => transaction.writeBatch(statements), executeScript: script => transaction.executeScript(script), query: (sql, args) => transaction.query(sql, args), transaction: nested => transaction.transaction(nested), close: () => Promise.resolve() })) };
    await assert.rejects(new GoogleCalendarBindingService(failing, value.refresh, { now: () => now }).bind(value.context, value.companyId, { resourceId: resource, calendarId: "cal-a" }), /evidence write failed/);
    assert.equal((await value.database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_external_resource_bindings WHERE workspace_id=? AND company_id=?", [value.context.workspaceId, value.companyId]))[0]?.count, 0);
  } finally { await value.close(); }
});

test("EPIC057 serializes unbind against a newly queued outbox operation", async () => {
  const value = await fixture(); try {
    const current = await bind(value); await booking(value, "sbk_race", "cancelled");
    const unbind = value.service.unbind(value.context, value.companyId, { resourceId: resource, expectedVersion: current.version });
    const queue = value.database.execute("INSERT INTO scheduling_calendar_sync_outbox(id,provider_operation_id,workspace_id,company_id,booking_id,binding_id,operation,idempotency_key,request_fingerprint,state,attempt_count,lease_owner,lease_token,lease_expires_at,last_provider_evidence_at,last_failure_code,created_at,updated_at) VALUES(?,?,?,?,?,?,'cancel','race',?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,?)", ["cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ewo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", value.context.workspaceId, value.companyId, "sbk_race", current.bindingId, "a".repeat(64), now, now]);
    const [unbindResult, queueResult] = await Promise.allSettled([unbind, queue]);
    const pending = (await value.database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_calendar_sync_outbox WHERE binding_id=? AND state='pending'", [current.bindingId]))[0]?.count === 1;
    const state = (await value.service.status(value.context, value.companyId, resource))?.state;
    if (pending) { assert.equal(unbindResult.status, "fulfilled"); if (unbindResult.status === "fulfilled") assert.equal(unbindResult.value.kind, "blocked"); assert.equal(state, "active"); } else { assert.equal(unbindResult.status, "fulfilled"); if (unbindResult.status === "fulfilled") assert.equal(unbindResult.value.kind, "unbound"); assert.equal(queueResult.status, "rejected"); assert.equal(state, "unbound"); }
  } finally { await value.close(); }
});
