import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import test from "node:test";
import { runAsyncMigrations } from "../config/asyncMigrations.js";
import { runMigrations } from "../config/migrations.js";
import { createLibsqlDatabase, LocalSqlDatabase, type SqlDatabase, type SqlResult, type SqlValue } from "../config/sqlDatabase.js";
import { BookingRepository } from "../repositories/bookingRepository.js";
import { CalendarSyncRepository } from "../repositories/calendarSyncRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createGoogleCalendarConflictResolutionRouter } from "../routes/googleCalendarConflictResolution.js";
import { GoogleCalendarConflictEvidenceVerifier } from "../scheduling/services/googleCalendarConflictEvidenceVerifier.js";
import { GoogleCalendarConflictResolutionCommandService } from "../scheduling/services/googleCalendarConflictResolutionCommandService.js";
import { SchedulingService } from "../scheduling/services/schedulingService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const at = "2026-09-29T12:00:00.000Z";
const bindingId = "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sourceBookingId = "sbk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

class Clock { public constructor(private readonly value = at) {} public now(): string { return this.value; } }

class TransactionDetectingDatabase implements SqlDatabase {
  public inTransaction = false;
  public constructor(private readonly database: SqlDatabase) {}
  public execute(statement: string, args: readonly SqlValue[] = []): Promise<SqlResult> { return this.database.execute(statement, args); }
  public executeScript(script: string): Promise<void> { return this.database.executeScript(script); }
  public query<Row extends Record<string, unknown>>(statement: string, args: readonly SqlValue[] = []): Promise<Row[]> { return this.database.query<Row>(statement, args); }
  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    return this.database.transaction(async transaction => {
      this.inTransaction = true;
      try { return await operation(new TransactionDetectingDatabase(transaction)); }
      finally { this.inTransaction = false; }
    });
  }
  public close(): Promise<void> { return this.database.close(); }
}

class FakeGoogle {
  public calls = 0;
  public available = true;
  public remoteVersion = "etag-a";
  public ownershipOperationId: string;
  public constructor(private readonly database: TransactionDetectingDatabase, operationId: string) { this.ownershipOperationId = operationId; }
  private read(): void { assert.equal(this.database.inTransaction, false, "Google reads must complete before the local transaction"); this.calls += 1; }
  public async getEvent(request: { readonly externalEventId: string }): Promise<{ readonly kind: "success"; readonly event: { readonly externalEventId: string; readonly remoteVersion: string; readonly remoteState: "active"; readonly startAt: string; readonly endAt: string; readonly timeZone: string; readonly createOperationId: string; readonly lastOperationId: null; } } | { readonly kind: "unavailable" }> { this.read(); return this.available ? { kind: "success", event: this.event(request.externalEventId) } : { kind: "unavailable" }; }
  public async listEvents(): Promise<{ readonly kind: "success"; readonly events: readonly { readonly externalEventId: string; readonly remoteVersion: string; readonly remoteState: "active"; readonly startAt: string; readonly endAt: string; readonly timeZone: string; }[] } | { readonly kind: "unavailable" }> { this.read(); return this.available ? { kind: "success", events: [this.event("event-a")] } : { kind: "unavailable" }; }
  public async listBusyIntervals(): Promise<{ readonly kind: "success"; readonly intervals: readonly { readonly startAt: string; readonly endAt: string; readonly units: number; readonly observationKey: string; }[] } | { readonly kind: "unavailable" }> { this.read(); return this.available ? { kind: "success", intervals: [{ startAt: "2026-09-30T12:00:00.000Z", endAt: "2026-09-30T12:30:00.000Z", units: 1, observationKey: "event-a" }] } : { kind: "unavailable" }; }
  public async reconcileEvents(): Promise<{ readonly kind: "success"; readonly events: readonly { readonly externalEventId: string; readonly remoteVersion: string; readonly remoteState: "active"; readonly startAt: string; readonly endAt: string; readonly timeZone: string; readonly createOperationId: string; readonly lastOperationId: null; }[] } | { readonly kind: "unavailable" }> { this.read(); return this.available ? { kind: "success", events: [this.event("event-a")] } : { kind: "unavailable" }; }
  private event(externalEventId: string) { return { externalEventId, remoteVersion: this.remoteVersion, remoteState: "active" as const, startAt: "2026-09-30T12:00:00.000Z", endAt: "2026-09-30T12:30:00.000Z", timeZone: "UTC", createOperationId: this.ownershipOperationId, lastOperationId: null }; }
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "atlas-conflict-resolution-")), path = join(directory, "atlas.sqlite"), sync = new DatabaseSync(path);
  sync.exec("PRAGMA foreign_keys=ON"); runMigrations(sync, 88);
  const context = createWorkspaceContext(new WorkspaceRepository(sync).resolveDefault()), company = new CompanyRepository(sync).create(context, { name: "Conflict resolution", website: "https://conflict-resolution.test" }), local = new LocalSqlDatabase(sync), scheduling = new SchedulingService(new SchedulingRepository(local), new Clock());
  const resource = await scheduling.createResource(context, company.id, { name: "Room", timezone: "UTC" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Visit", durationMinutes: 30 });
  await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 3, startTime: "12:00", endTime: "13:00" });
  sync.prepare("INSERT INTO scheduling_bookings(id,workspace_id,company_id,service_id,hold_id,rescheduled_from_booking_id,reference,start_at,end_at,occupied_start_at,occupied_end_at,state,created_at,cancelled_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?,'confirmed',?,NULL)").run(sourceBookingId, context.workspaceId, company.id, service.id, "SMOKE", "2026-09-30T12:00:00.000Z", "2026-09-30T12:30:00.000Z", "2026-09-30T12:00:00.000Z", "2026-09-30T12:30:00.000Z", at);
  sync.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run("icn_smoke", context.workspaceId, company.id, "google_calendar", "calendar", at, at);
  sync.prepare("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(bindingId, context.workspaceId, company.id, resource.id, "icn_smoke", "calendar-smoke", at, at);
  sync.close();
  const raw = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(raw);
  const database = new TransactionDetectingDatabase(raw), repository = new CalendarSyncRepository(database), item = await repository.enqueue(database, context, company.id, { id: "cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", bookingId: sourceBookingId, bindingId, operation: "create", idempotencyKey: "smoke-head", requestFingerprint: "a".repeat(64), at });
  await database.execute("INSERT INTO scheduling_external_booking_events(id,workspace_id,company_id,booking_id,binding_id,external_event_id,remote_version,remote_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)", ["ebe_smoke", context.workspaceId, company.id, sourceBookingId, bindingId, "event-a", "etag-a", at, at]);
  await database.execute("INSERT INTO google_calendar_authorizations(integration_connection_id,workspace_id,company_id,google_subject,status,authorized_at,revoked_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?)", ["icn_smoke", context.workspaceId, company.id, "subject-smoke", "active", at, at]);
  await database.execute("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)", ["icn_smoke", context.workspaceId, company.id, "calendar-smoke", "Smoke", "writer", at]);
  await database.execute("INSERT INTO google_calendar_company_bindings(binding_id,workspace_id,company_id,google_subject,calendar_id,created_at,state,version,updated_at) VALUES(?,?,?,?,?,?, 'active',1,?)", [bindingId, context.workspaceId, company.id, "subject-smoke", "calendar-smoke", at, at]);
  const google = new FakeGoogle(database, item.providerOperationId), verifier = new GoogleCalendarConflictEvidenceVerifier(google, google, google, new Clock()), binding = { id: bindingId, workspaceId: context.workspaceId, companyId: company.id, resourceId: resource.id, integrationConnectionId: "icn_smoke", externalCalendarId: "calendar-smoke", createdAt: at, updatedAt: at };
  const evidence = await verifier.verify(context, company.id, { connectionId: "icn_smoke", binding: binding as never, googleSubject: "subject-smoke", externalEventId: "event-a", expectedRemoteVersion: "etag-a", expectedOperationId: item.providerOperationId, startAt: "2026-09-30T12:00:00.000Z", endAt: "2026-09-30T12:30:00.000Z" });
  assert.ok(evidence);
  await repository.openConflict(database, context, company.id, { id: "ccf_smoke", bookingId: sourceBookingId, bindingId, resourceId: resource.id, headBookingId: sourceBookingId, headOutboxId: item.id, headFenceGeneration: item.fenceGeneration, state: "open", version: 1, evidenceFingerprint: evidence.fingerprint, createdAt: at, updatedAt: at });
  return { directory, path, raw, database, repository, context, company, google, verifier, evidence };
}

test("EPIC057 conflict resolution smoke executes restore, adopt, cancel, negatives, transaction isolation, and restart", async () => {
  for (const decision of ["restore_atlas", "adopt_google", "cancel_atlas"] as const) {
    const value = await fixture();
    try {
      const observedAt = "2026-09-29T12:05:00.000Z", verifier = new GoogleCalendarConflictEvidenceVerifier(value.google, value.google, value.google, new Clock(observedAt)), service = new GoogleCalendarConflictResolutionCommandService(value.database, value.repository, new BookingRepository(value.database), verifier, new Clock(observedAt)), input = { conflictId: "ccf_smoke", decision, expectedVersion: 1, operationId: `smoke-${decision}`, reason: "operator reviewed evidence", actorId: "user-smoke" };
      assert.deepEqual(await service.execute(value.context, value.company.id + 1, input), { kind: "not_found" });
      assert.deepEqual(await service.execute(value.context, value.company.id, { ...input, operationId: "bad", decision: "bad" as never }), { kind: "invalid" });
      value.google.available = false; assert.deepEqual(await service.execute(value.context, value.company.id, input), { kind: "unavailable" }); value.google.available = true;
      const resolved = await service.execute(value.context, value.company.id, input); assert.equal(resolved.kind, "resolved", JSON.stringify({ decision, resolved, conflicts: await value.database.query("SELECT state,version,head_fence_generation FROM scheduling_calendar_sync_conflicts"), outbox: await value.database.query("SELECT id,state,fence_generation,causal_generation,last_failure_code FROM scheduling_calendar_sync_outbox") })); assert.equal(value.google.calls >= 12, true);
      assert.equal((await value.database.query<{ state: string; version: number }>("SELECT state,version FROM scheduling_calendar_sync_conflicts WHERE id='ccf_smoke'"))[0]?.state, "resolved");
      assert.deepEqual(await value.database.query<{ evidence_fingerprint: string; created_at: string; observed_at: string }>("SELECT c.evidence_fingerprint,c.created_at,e.observed_at FROM scheduling_calendar_sync_conflicts c JOIN scheduling_calendar_sync_remote_evidence_snapshots e ON e.conflict_id=c.id WHERE c.id='ccf_smoke'"), [{ evidence_fingerprint: value.evidence.fingerprint, created_at: at, observed_at: observedAt }]);
      assert.deepEqual(JSON.parse((await value.database.query<{ payload_json: string }>("SELECT payload_json FROM scheduling_calendar_sync_audit_events"))[0]!.payload_json), { actorId: "user-smoke", reason: "operator reviewed evidence", decision, evidenceSnapshotId: (await value.database.query<{ evidence_snapshot_id: string }>("SELECT evidence_snapshot_id FROM scheduling_calendar_sync_decisions"))[0]!.evidence_snapshot_id, evidenceFingerprint: value.evidence.fingerprint, evidenceObservedAt: observedAt, evidenceSource: "manual_verifier" });
      assert.equal((await value.database.query<{ state: string }>("SELECT state FROM scheduling_calendar_sync_outbox WHERE id='cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"))[0]?.state, "failed");
      if (decision === "restore_atlas") assert.deepEqual(await value.database.query<{ operation: string; state: string }>("SELECT operation,state FROM scheduling_calendar_sync_outbox WHERE operation='restore'"), [{ operation: "restore", state: "pending" }]);
      if (decision === "adopt_google") { const mapping = (await value.database.query<{ booking_id: string }>("SELECT booking_id FROM scheduling_external_booking_events WHERE id='ebe_smoke'"))[0]; assert.notEqual(mapping?.booking_id, sourceBookingId); assert.deepEqual(await value.repository.ownedProviderOperationIds(value.database, value.context, value.company.id, mapping!.booking_id, bindingId, "event-a"), ["ewo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]); assert.equal((await value.database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_calendar_sync_outbox WHERE operation IN ('restore','cancel')"))[0]?.count, 0); }
      if (decision === "cancel_atlas") assert.deepEqual(await value.database.query<{ operation: string; state: string }>("SELECT operation,state FROM scheduling_calendar_sync_outbox WHERE operation='cancel'"), [{ operation: "cancel", state: "pending" }]);
      const replay = await service.execute(value.context, value.company.id, input); assert.equal(replay.kind, "replayed");
      assert.deepEqual(await service.execute(value.context, value.company.id, { ...input, reason: "changed" }), { kind: "conflict" });
      await value.raw.close(); const restarted = createLibsqlDatabase(pathToFileURL(value.path).href, "local-test-token");
      try { const afterRestart = new GoogleCalendarConflictResolutionCommandService(restarted, new CalendarSyncRepository(restarted), new BookingRepository(restarted), verifier, new Clock(observedAt)); assert.equal((await afterRestart.execute(value.context, value.company.id, input)).kind, "replayed"); assert.equal(value.google.calls, 12); }
      finally { await restarted.close(); }
    } finally { try { await value.raw.close(); } catch {} try { rmSync(value.directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
  }
});

test("EPIC057 conflict evidence rejects changed material facts, stale CAS, divergent ownership, and direct snapshot drift", async () => {
  const value = await fixture();
  try {
    const service = new GoogleCalendarConflictResolutionCommandService(value.database, value.repository, new BookingRepository(value.database), new GoogleCalendarConflictEvidenceVerifier(value.google, value.google, value.google, new Clock("2026-09-29T12:05:00.000Z")), new Clock("2026-09-29T12:05:00.000Z"));
    const input = { conflictId: "ccf_smoke", decision: "restore_atlas" as const, expectedVersion: 1, operationId: "negative-material", reason: "operator reviewed evidence", actorId: "user-smoke" };
    value.google.remoteVersion = "etag-b";
    assert.deepEqual(await service.execute(value.context, value.company.id, input), { kind: "unavailable" });
    value.google.remoteVersion = "etag-a";
    value.google.ownershipOperationId = "ewo_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assert.deepEqual(await service.execute(value.context, value.company.id, { ...input, operationId: "negative-owner" }), { kind: "unavailable" });
    value.google.ownershipOperationId = "ewo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await value.database.execute("UPDATE google_calendar_company_bindings SET google_subject='subject-changed' WHERE binding_id=?", [bindingId]);
    await value.database.execute("UPDATE google_calendar_authorizations SET google_subject='subject-changed' WHERE integration_connection_id='icn_smoke'");
    assert.deepEqual(await service.execute(value.context, value.company.id, { ...input, operationId: "negative-subject" }), { kind: "unavailable" });
    await value.database.execute("UPDATE google_calendar_company_bindings SET google_subject='subject-smoke' WHERE binding_id=?", [bindingId]);
    await value.database.execute("UPDATE google_calendar_authorizations SET google_subject='subject-smoke' WHERE integration_connection_id='icn_smoke'");
    await assert.rejects(value.repository.recordEvidenceSnapshot(value.database, value.context, value.company.id, { id: "ces_drift", conflictId: "ccf_smoke", googleSubject: "subject-smoke", bindingId, resourceId: (await value.database.query<{ resource_id: string }>("SELECT resource_id FROM scheduling_calendar_sync_conflicts WHERE id='ccf_smoke'"))[0]!.resource_id, calendarId: "calendar-smoke", outboxId: "cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", evidenceState: "present", externalEventId: "event-a", etag: "etag-drift", intervalStartAt: "2026-09-30T12:00:00.000Z", intervalEndAt: "2026-09-30T12:30:00.000Z", timeZone: "UTC", providerOperationId: "ewo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", observedAt: "2026-09-29T12:05:00.000Z", fingerprint: value.evidence.fingerprint, source: "test", createdAt: "2026-09-29T12:05:00.000Z" }), /binding is invalid/);
    assert.deepEqual(await service.execute(value.context, value.company.id, { ...input, expectedVersion: 2, operationId: "negative-stale" }), { kind: "conflict" });
  } finally { try { await value.raw.close(); } catch {} try { rmSync(value.directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});

test("EPIC057 conflict resolution route rejects unauthenticated and cross-site mutations", async () => {
  let calls = 0;
  const router = createGoogleCalendarConflictResolutionRouter({ service: { execute: async () => { calls += 1; return { kind: "resolved", receiptId: "crp_http", decision: "restore_atlas" }; } } as never, authentication: { cookieName: () => "atlas", current: async raw => raw === "manager" ? { userId: raw } : null, validateCsrf: async (_raw, csrf) => csrf === "csrf" } as never, users: { findById: () => ({ id: "manager", status: "active" }) } as never, authorization: { authorize: () => ({ workspaceId: 1, workspacePublicId: "wsp_default", userId: "manager", membershipId: "mem", role: "owner", capabilities: new Set(["company:manage"]) }) } as never, resolver: { resolve: async () => ({ workspaceId: 1, workspaceKey: "default" }) } as never });
  const server = express().use(router).listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, url = `${origin}/wsp_default/companies/1/google-calendar/conflicts/ccf_smoke/resolutions`, body = JSON.stringify({ decision: "restore_atlas", expectedVersion: 1, operationId: "http", reason: "review" });
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 404);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", cookie: "atlas=manager", origin, "sec-fetch-site": "cross-site", "x-csrf-token": "csrf" }, body })).status, 404);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", cookie: "atlas=manager", origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf" }, body })).status, 200);
    assert.equal(calls, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
