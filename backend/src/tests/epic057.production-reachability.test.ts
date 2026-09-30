import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Router } from "express";
import test from "node:test";
import { createApp } from "../app.js";
import { runAsyncMigrations } from "../config/asyncMigrations.js";
import { runMigrations } from "../config/migrations.js";
import { createLibsqlDatabase, LocalSqlDatabase, type SqlDatabase, type SqlResult, type SqlValue } from "../config/sqlDatabase.js";
import { BookingRepository } from "../repositories/bookingRepository.js";
import { CalendarSyncRepository } from "../repositories/calendarSyncRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { GoogleCalendarConflictEvidenceVerifier } from "../scheduling/services/googleCalendarConflictEvidenceVerifier.js";
import { GoogleCalendarConflictResolutionCommandService } from "../scheduling/services/googleCalendarConflictResolutionCommandService.js";
import { SchedulingService } from "../scheduling/services/schedulingService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const at = "2026-09-29T12:00:00.000Z";
const bindingId = "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const bookingId = "sbk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

class Clock { public now(): string { return at; } }
class TransactionDetector implements SqlDatabase {
  public active = false;
  public constructor(private readonly database: SqlDatabase) {}
  public execute(sql: string, args: readonly SqlValue[] = []): Promise<SqlResult> { return this.database.execute(sql, args); }
  public writeBatch(...args: Parameters<SqlDatabase["writeBatch"]>): ReturnType<SqlDatabase["writeBatch"]> { return this.database.writeBatch(...args); }
  public executeScript(...args: Parameters<SqlDatabase["executeScript"]>): ReturnType<SqlDatabase["executeScript"]> { return this.database.executeScript(...args); }
  public query<Row extends Record<string, unknown>>(sql: string, args: readonly SqlValue[] = []): Promise<Row[]> { return this.database.query<Row>(sql, args); }
  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> { return this.database.transaction(async database => { this.active = true; try { return await operation(new TransactionDetector(database)); } finally { this.active = false; } }); }
  public close(): Promise<void> { return this.database.close(); }
}
class FakeGoogle {
  public reads = 0;
  public constructor(private readonly database: TransactionDetector, private readonly operationId: string) {}
  private read(): void { assert.equal(this.database.active, false, "Google I/O must not occur in a local transaction"); this.reads += 1; }
  private event(externalEventId: string) { return { externalEventId, remoteVersion: "etag-a", remoteState: "active" as const, startAt: "2026-09-30T12:00:00.000Z", endAt: "2026-09-30T12:30:00.000Z", timeZone: "UTC", createOperationId: this.operationId, lastOperationId: null }; }
  public async getEvent(input: { readonly externalEventId: string }): Promise<unknown> { this.read(); return { kind: "success", event: this.event(input.externalEventId) }; }
  public async listEvents(): Promise<unknown> { this.read(); return { kind: "success", events: [this.event("event-a")] }; }
  public async listBusyIntervals(): Promise<unknown> { this.read(); return { kind: "success", intervals: [{ startAt: "2026-09-30T12:00:00.000Z", endAt: "2026-09-30T12:30:00.000Z", units: 1, observationKey: "event-a" }] }; }
  public async reconcileEvents(): Promise<unknown> { this.read(); return { kind: "success", events: [this.event("event-a")] }; }
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "atlas-production-reachability-")), path = join(directory, "atlas.sqlite"), sync = new DatabaseSync(path);
  sync.exec("PRAGMA foreign_keys=ON"); runMigrations(sync, 88);
  const context = createWorkspaceContext(new WorkspaceRepository(sync).resolveDefault()), company = new CompanyRepository(sync).create(context, { name: "Reachability", website: "https://reachability.test" }), scheduling = new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(sync)), new Clock());
  const resource = await scheduling.createResource(context, company.id, { name: "Room", timezone: "UTC" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Visit", durationMinutes: 30 });
  await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 3, startTime: "12:00", endTime: "13:00" });
  sync.prepare("INSERT INTO scheduling_bookings(id,workspace_id,company_id,service_id,hold_id,rescheduled_from_booking_id,reference,start_at,end_at,occupied_start_at,occupied_end_at,state,created_at,cancelled_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?,'confirmed',?,NULL)").run(bookingId, context.workspaceId, company.id, service.id, "REACH", "2026-09-30T12:00:00.000Z", "2026-09-30T12:30:00.000Z", "2026-09-30T12:00:00.000Z", "2026-09-30T12:30:00.000Z", at);
  sync.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run("icn_reach", context.workspaceId, company.id, "google_calendar", "calendar", at, at);
  sync.prepare("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(bindingId, context.workspaceId, company.id, resource.id, "icn_reach", "calendar-reach", at, at);
  sync.close();
  const raw = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(raw);
  const database = new TransactionDetector(raw), repository = new CalendarSyncRepository(database), item = await repository.enqueue(database, context, company.id, { id: "cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", bookingId, bindingId, operation: "create", idempotencyKey: "reach-head", requestFingerprint: "a".repeat(64), at });
  await database.execute("INSERT INTO scheduling_external_booking_events(id,workspace_id,company_id,booking_id,binding_id,external_event_id,remote_version,remote_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)", ["ebe_reach", context.workspaceId, company.id, bookingId, bindingId, "event-a", "etag-a", at, at]);
  await database.execute("INSERT INTO google_calendar_authorizations(integration_connection_id,workspace_id,company_id,google_subject,status,authorized_at,revoked_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?)", ["icn_reach", context.workspaceId, company.id, "subject-reach", "active", at, at]);
  await database.execute("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)", ["icn_reach", context.workspaceId, company.id, "calendar-reach", "Reach", "writer", at]);
  await database.execute("INSERT INTO google_calendar_company_bindings(binding_id,workspace_id,company_id,google_subject,calendar_id,created_at,state,version,updated_at) VALUES(?,?,?,?,?,?, 'active',1,?)", [bindingId, context.workspaceId, company.id, "subject-reach", "calendar-reach", at, at]);
  const google = new FakeGoogle(database, item.providerOperationId), verifier = new GoogleCalendarConflictEvidenceVerifier(google as never, google as never, google as never, new Clock());
  const evidence = await verifier.verify(context, company.id, { connectionId: "icn_reach", binding: { id: bindingId, workspaceId: context.workspaceId, companyId: company.id, resourceId: resource.id, integrationConnectionId: "icn_reach", externalCalendarId: "calendar-reach", createdAt: at, updatedAt: at } as never, googleSubject: "subject-reach", externalEventId: "event-a", expectedRemoteVersion: "etag-a", expectedOperationId: item.providerOperationId, startAt: "2026-09-30T12:00:00.000Z", endAt: "2026-09-30T12:30:00.000Z" });
  assert.ok(evidence); await repository.openConflict(database, context, company.id, { id: "ccf_reach", bookingId, bindingId, resourceId: resource.id, headBookingId: bookingId, headOutboxId: item.id, headFenceGeneration: item.fenceGeneration, state: "open", version: 1, evidenceFingerprint: evidence.fingerprint, createdAt: at, updatedAt: at });
  return { directory, raw, database, repository, context, company, google, verifier };
}

test("EPIC057 production reachability keeps absent capability closed and reaches restore, adopt, and cancel through the app boundary", async () => {
  const empty = Router(), absent = createApp({ authorizedCompaniesRouter: createAuthorizedCompaniesRouter({ authentication: {} as never, users: {} as never, authorization: {} as never, resolver: {} as never, controllers: {} as never, assistantControllers: {} as never }), chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty }, { production: true, trustedLocalMode: false });
  const absentServer = absent.listen(0, "127.0.0.1"); await new Promise<void>(resolve => absentServer.once("listening", resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${(absentServer.address() as AddressInfo).port}/workspaces/wsp_default/companies/1/google-calendar/conflicts/ccf_reach/resolutions`, { method: "POST" })).status, 404); }
  finally { await new Promise<void>(resolve => absentServer.close(() => resolve())); }
  for (const decision of ["restore_atlas", "adopt_google", "cancel_atlas"] as const) {
    const value = await fixture(), service = new GoogleCalendarConflictResolutionCommandService(value.database, value.repository, new BookingRepository(value.database), value.verifier, new Clock());
    const router = createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: async raw => raw === "manager" ? { userId: raw } : null, validateCsrf: async (_raw, csrf) => csrf === "csrf" } as never, users: { findById: (id: string) => id === "manager" ? { id, status: "active" } : null } as never, authorization: { authorize: (_user: unknown, workspace: string, permission: string) => { if (workspace !== "wsp_default" || permission !== "company:manage") throw new Error("denied"); return { workspaceId: value.context.workspaceId, workspacePublicId: workspace, userId: "manager", membershipId: "mem", role: "owner", capabilities: new Set([permission]) }; } } as never, resolver: { resolve: async () => value.context } as never, controllers: {} as never, assistantControllers: {} as never, googleCalendarConflictResolutionService: service });
    const app = createApp({ authorizedCompaniesRouter: router, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty }, { production: true, trustedLocalMode: false }), server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, url = `${origin}/workspaces/wsp_default/companies/${value.company.id}/google-calendar/conflicts/ccf_reach/resolutions`, body = JSON.stringify({ decision, expectedVersion: 1, operationId: `reach-${decision}`, reason: "manager reviewed evidence" });
      for (const headers of [{ "content-type": "application/json" }, { "content-type": "application/json", cookie: "atlas=manager", origin, "sec-fetch-site": "same-origin", "x-csrf-token": "bad" }, { "content-type": "application/json", cookie: "atlas=manager", origin: "https://foreign.test", "sec-fetch-site": "same-origin", "x-csrf-token": "csrf" }]) assert.equal((await fetch(url, { method: "POST", headers, body })).status, 404);
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", cookie: "atlas=manager", origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf" }, body });
      assert.equal(response.status, 200); assert.equal((await response.json() as { decision: string }).decision, decision); assert.ok(value.google.reads > 0);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await value.raw.close(); try { rmSync(value.directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
  }
});
