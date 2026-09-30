import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runAsyncMigrations } from "../config/asyncMigrations.js";
import { runMigrations } from "../config/migrations.js";
import { createLibsqlDatabase, LocalSqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import type { ProviderAdapterRegistryPort } from "../integrations/application/providerAdapterRegistry.js";
import { CalendarSyncRepository } from "../repositories/calendarSyncRepository.js";
import { SharedWorkerOwnershipRepository } from "../repositories/sharedWorkerOwnershipRepository.js";
import { BookingRepository } from "../repositories/bookingRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { GoogleCalendarOutboxRuntime, googleCalendarOutboxRuntimeConfiguration } from "../scheduling/services/googleCalendarOutboxRuntime.js";
import { GoogleCalendarOutboxWorker } from "../scheduling/services/googleCalendarOutboxWorker.js";
import { BookingCommandService } from "../scheduling/services/bookingCommandService.js";
import { SchedulingService } from "../scheduling/services/schedulingService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

class Clock { public now(): string { return "2026-09-28T12:00:00.000Z"; } }
class FakeGoogle {
  public inserts = 0;
  private readonly events = new Map<string, { readonly externalEventId: string; readonly remoteVersion: string; readonly remoteState: "active"; readonly startAt: string; readonly endAt: string; readonly timeZone: string; readonly createOperationId: string | null; readonly lastOperationId: string | null; }>();
  public async getEvent(input: { readonly externalEventId: string }): Promise<unknown> { const event = this.events.get(input.externalEventId); return event ? { kind: "success", event } : { kind: "not_found" }; }
  public async reconcileEvents(): Promise<unknown> { return { kind: "success", events: [...this.events.values()] }; }
  public async insertEvent(input: { readonly externalEventId: string; readonly operationId: string; readonly startAt: string; readonly endAt: string; readonly timeZone: string }): Promise<unknown> { this.inserts += 1; const event = { externalEventId: input.externalEventId, remoteVersion: "etag-1", remoteState: "active" as const, startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone, createOperationId: input.operationId, lastOperationId: null }; this.events.set(event.externalEventId, event); return { kind: "success", event }; }
  public async patchEvent(): Promise<unknown> { return { kind: "unavailable" }; }
  public async deleteEvent(): Promise<unknown> { return { kind: "unavailable" }; }
  public async listBusyIntervals(): Promise<unknown> { return { kind: "success", intervals: [] }; }
}

const flush = async (): Promise<void> => { await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve)); };
function ownership() { let lease: { worker: string; owner: string; expiresAt: string; fenceGeneration: number } | null = null; return { async acquire(worker: string, owner: string, _now: string, expiresAt: string) { if (lease && lease.owner !== owner) return null; return lease = { worker, owner, expiresAt, fenceGeneration: lease?.fenceGeneration ?? 1 }; }, async renew(current: { worker: string; owner: string; expiresAt: string; fenceGeneration: number }, _now: string, expiresAt: string) { return lease?.owner === current.owner ? lease = { ...current, expiresAt } : null; }, async release(current: { owner: string; fenceGeneration: number }) { if (lease?.owner === current.owner && lease.fenceGeneration === current.fenceGeneration) lease = null; } }; }

test("EPIC057 production calendar composition is disabled by default and bounds concurrent tenant work", async () => {
  assert.equal(googleCalendarOutboxRuntimeConfiguration({}).enabled, false);
  assert.equal(googleCalendarOutboxRuntimeConfiguration({ GOOGLE_CALENDAR_OUTBOX_WORKER_ENABLED: "true", GOOGLE_CALENDAR_OUTBOX_WORKER_OWNERSHIP_APPROVED: "true" }).enabled, true);
  assert.throws(() => googleCalendarOutboxRuntimeConfiguration({ GOOGLE_CALENDAR_OUTBOX_WORKER_ENABLED: "yes" }), /true or false/);
  let listed = 0, active = 0, maximum = 0, release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const timers: Array<{ readonly callback: () => void; cleared: boolean; unref(): void }> = [];
  const runtime = new GoogleCalendarOutboxRuntime({ async runOnce() { active += 1; maximum = Math.max(maximum, active); await gate; active -= 1; } }, { async listPendingScopes() { listed += 1; return [{ workspaceId: 1, workspaceKey: "one", companyId: 1 }, { workspaceId: 1, workspaceKey: "one", companyId: 2 }, { workspaceId: 2, workspaceKey: "two", companyId: 3 }]; } }, ownership(), { enabled: true, requested: true, ownershipApproved: true, sharedLeaderAvailable: true, intervalMilliseconds: 1_000, scopeLimit: 3, concurrency: 2 }, { schedule: callback => { const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; }, clear: timer => { timer.cleared = true; } });
  runtime.start(); await flush(); assert.equal(listed, 1); assert.equal(maximum, 2);
  const stopping = runtime.stop(); release?.(); await stopping;
  assert.equal(timers.length, 0);
  assert.equal(active, 0);
  assert.deepEqual(runtime.diagnostics(), { state: "stopped", requested: true, ownershipApproved: true, sharedLeaderAvailable: true, cyclesStarted: 1, cyclesSucceeded: 1, cyclesFailed: 0, pendingScopes: 3, processedScopes: 3 });
});

test("EPIC057 production calendar composition enumerates pending libSQL scopes and invokes the fake Google worker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-calendar-runtime-")), path = join(directory, "atlas.sqlite");
  let synchronous = new DatabaseSync(path), database: SqlDatabase | null = null;
  try {
    synchronous.exec("PRAGMA foreign_keys=ON;"); runMigrations(synchronous);
    const context = createWorkspaceContext(new WorkspaceRepository(synchronous).resolveDefault()), company = new CompanyRepository(synchronous).create(context, { name: "Runtime calendar", website: "https://runtime-calendar.test" }), local = new LocalSqlDatabase(synchronous), clock = new Clock(), scheduling = new SchedulingService(new SchedulingRepository(local), clock);
    const resource = await scheduling.createResource(context, company.id, { name: "Room", timezone: "UTC" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Visit", durationMinutes: 30 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 1, startTime: "13:00", endTime: "14:00" });
    const slot = (await scheduling.listSlots(context, company.id, service.id, { fromLocalDate: "2026-09-28", days: 1 }))[0]!;
    const booking = await new BookingCommandService(new BookingRepository(local), clock).create(context, company.id, { serviceId: service.id, startAt: slot.startAt, reference: "RUNTIME-1", idempotencyKey: "runtime-booking" });
    const bindingId = "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    synchronous.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run("icn_calendar", context.workspaceId, company.id, "google_calendar", "calendar", clock.now(), clock.now());
    synchronous.prepare("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(bindingId, context.workspaceId, company.id, resource.id, "icn_calendar", "calendar-1", clock.now(), clock.now());
    synchronous.prepare("INSERT INTO google_calendar_authorizations(integration_connection_id,workspace_id,company_id,google_subject,status,authorized_at,revoked_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?)").run("icn_calendar", context.workspaceId, company.id, "subject-runtime", "active", clock.now(), clock.now());
    synchronous.prepare("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)").run("icn_calendar", context.workspaceId, company.id, "calendar-1", "Calendar", "writer", clock.now());
    synchronous.prepare("INSERT INTO google_calendar_company_bindings(binding_id,workspace_id,company_id,google_subject,calendar_id,created_at,state,version,updated_at) VALUES(?,?,?,?,?,?, 'active',1,?)").run(bindingId, context.workspaceId, company.id, "subject-runtime", "calendar-1", clock.now(), clock.now());
    synchronous.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(database);
    const repository = new CalendarSyncRepository(database);
    await repository.enqueue(database, context, company.id, { id: "cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", bookingId: booking.id, bindingId, operation: "create", idempotencyKey: "runtime-create", requestFingerprint: createHash("sha256").update("runtime-create").digest("hex"), at: clock.now() });
    const google = new FakeGoogle(), registry = { resolveCalendarEvents: () => google, resolveCalendarReconciliation: () => google, resolveCalendarBusy: () => google } as never as ProviderAdapterRegistryPort;
    const timers: Array<{ readonly callback: () => void; cleared: boolean; unref(): void }> = [];
    const runtime = new GoogleCalendarOutboxRuntime(new GoogleCalendarOutboxWorker(repository, registry, clock), { listPendingScopes: limit => repository.listPendingScopes(database!, limit) }, new SharedWorkerOwnershipRepository(database), { enabled: true, requested: true, ownershipApproved: true, sharedLeaderAvailable: true, intervalMilliseconds: 1_000, scopeLimit: 10, concurrency: 1 }, { schedule: callback => { const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; }, clear: timer => { timer.cleared = true; }, now: () => clock.now() });
    runtime.start(); await flush();
    assert.equal(google.inserts, 1);
    assert.equal((await repository.find(database, context, company.id, "cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))?.state, "succeeded");
    await runtime.stop(); assert.equal(timers[0]?.cleared, true);
    assert.equal(runtime.diagnostics().processedScopes, 1);
  } finally { if (synchronous.isOpen) synchronous.close(); if (database) await database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});

test("EPIC057 calendar runtime records partial failures and fences repeated starts", async () => {
  const timers: Array<{ readonly callback: () => void; cleared: boolean; unref(): void }> = [];
  let runs = 0;
  const runtime = new GoogleCalendarOutboxRuntime({ async runOnce() { runs += 1; if (runs === 2) throw new Error("provider unavailable"); } }, { async listPendingScopes() { return [{ workspaceId: 1, workspaceKey: "one", companyId: 1 }, { workspaceId: 1, workspaceKey: "one", companyId: 2 }]; } }, ownership(), { enabled: true, requested: true, ownershipApproved: true, sharedLeaderAvailable: true, intervalMilliseconds: 1_000, scopeLimit: 2, concurrency: 1 }, { schedule: callback => { const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; }, clear: timer => { timer.cleared = true; } });
  runtime.start(); runtime.start(); await flush();
  assert.deepEqual(runtime.diagnostics(), { state: "scheduled", requested: true, ownershipApproved: true, sharedLeaderAvailable: true, cyclesStarted: 1, cyclesSucceeded: 0, cyclesFailed: 1, pendingScopes: 2, processedScopes: 1 });
  assert.equal(timers.length, 1);
  await runtime.stop(); await runtime.stop();
  assert.equal(timers[0]?.cleared, true);
});
