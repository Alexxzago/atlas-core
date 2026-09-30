import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runMigrations } from "../config/migrations.js";
import { runAsyncMigrations } from "../config/asyncMigrations.js";
import { createLibsqlDatabase, LocalSqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { CalendarSyncRepository } from "../repositories/calendarSyncRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { BookingCommandService } from "../scheduling/services/bookingCommandService.js";
import { SchedulingService } from "../scheduling/services/schedulingService.js";
import { BookingRepository } from "../repositories/bookingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { CalendarBoundBookingCommandService, type ReadyCalendarBindingPort } from "../scheduling/services/calendarBoundBookingCommandService.js";
import { CalendarAvailabilityPreflightService } from "../scheduling/services/calendarAvailabilityPreflightService.js";
import { GoogleCalendarOutboxWorker } from "../scheduling/services/googleCalendarOutboxWorker.js";
import { GoogleCalendarConflictEvidenceVerifier } from "../scheduling/services/googleCalendarConflictEvidenceVerifier.js";
import { GoogleCalendarEventsProvider, googleCalendarEventId } from "../integrations/providers/googleCalendarEventsProvider.js";
import type { ExternalBookingEventRepositoryPort, ExternalBusyProviderPort, ExternalCalendarEventProviderPort, ExternalEventListResult } from "../scheduling/application/externalCalendarPorts.js";
import type { ProviderAdapterRegistryPort } from "../integrations/application/providerAdapterRegistry.js";
import type { ReadyExternalCalendarBindingResolution } from "../scheduling/services/externalCalendarBindingService.js";

class Clock { public now(): string { return "2026-09-28T12:00:00.000Z"; } }
class FakeEventListing implements Pick<ExternalCalendarEventProviderPort, "listEvents"> {
  public async listEvents(): Promise<ExternalEventListResult> { return { kind: "success", events: Object.freeze([{ externalEventId: "a0000", remoteVersion: "etag-1", remoteState: "active", startAt: "2026-09-29T13:00:00.000Z", endAt: "2026-09-29T13:30:00.000Z", timeZone: "UTC" }]) }; }
}

class FakeProvider implements ExternalBusyProviderPort, ExternalCalendarEventProviderPort {
  public listed: readonly { readonly externalEventId: string; readonly remoteVersion: string; readonly remoteState: "active"; readonly startAt: string; readonly endAt: string; readonly timeZone: string; }[] = [];
  public busy: readonly { readonly startAt: string; readonly endAt: string; readonly units: number; readonly observationKey: string; }[] | null = null;
  public getCalls = 0;
  public async listBusyIntervals(): Promise<Awaited<ReturnType<ExternalBusyProviderPort["listBusyIntervals"]>>> { return { kind: "success", intervals: this.busy ?? this.listed.map(event => ({ startAt: event.startAt, endAt: event.endAt, units: 1, observationKey: event.externalEventId })) }; }
  public async listEvents(): Promise<ExternalEventListResult> { return { kind: "success", events: this.listed }; }
  public async reconcileEvents(): Promise<Awaited<ReturnType<import("../scheduling/application/externalCalendarPorts.js").ExternalCalendarReconciliationProviderPort["reconcileEvents"]>>> { return { kind: "success", events: this.listed.map(event => ({ ...event, createOperationId: null, lastOperationId: null })) }; }
  public async getEvent(request: Parameters<ExternalCalendarEventProviderPort["getEvent"]>[0]): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["getEvent"]>>> { this.getCalls += 1; const event = this.listed.find(value => value.externalEventId === request.externalEventId); return event ? { kind: "success", event: { ...event, createOperationId: null, lastOperationId: null } } : { kind: "not_found" }; }
  public async insertEvent(): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["insertEvent"]>>> { throw new Error("Provider writes are forbidden in local-first commands."); }
  public async patchEvent(): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["patchEvent"]>>> { throw new Error("Provider writes are forbidden in local-first commands."); }
  public async deleteEvent(): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["deleteEvent"]>>> { throw new Error("Provider writes are forbidden in local-first commands."); }
}
class EvidenceProvider extends FakeProvider {
  public readonly operationId = "ewo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  public failure = false;
  public foreign = false;
  public stale = false;
  public async getEvent(request: Parameters<ExternalCalendarEventProviderPort["getEvent"]>[0]): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["getEvent"]>>> { if (this.failure) return { kind: "unavailable" }; const event = this.listed.find(value => value.externalEventId === request.externalEventId); return event ? { kind: "success", event: { ...event, externalEventId: this.foreign ? "foreign" : event.externalEventId, remoteVersion: this.stale ? "etag-stale" : event.remoteVersion, createOperationId: this.operationId, lastOperationId: null } } : { kind: "not_found" }; }
  public override async reconcileEvents(): Promise<Awaited<ReturnType<import("../scheduling/application/externalCalendarPorts.js").ExternalCalendarReconciliationProviderPort["reconcileEvents"]>>> { if (this.failure) return { kind: "unavailable" }; return { kind: "success", events: this.listed.map(event => ({ ...event, createOperationId: this.operationId, lastOperationId: null })) }; }
}
class FakeRegistry implements ProviderAdapterRegistryPort {
  public constructor(private readonly provider: FakeProvider) {}
  public register(): void {}
  public resolveValidation() { return null; }
  public resolveCalendarBusy() { return this.provider; }
  public resolveCalendarEvents() { return this.provider; }
  public resolveCalendarReconciliation() { return this.provider; }
}
class FailingCalendarSyncRepository extends CalendarSyncRepository {
  public override async enqueue(): Promise<never> { throw new Error("outbox unavailable"); }
}
class FakeOutboxProvider implements ExternalCalendarEventProviderPort {
  public loseInsertResponse = false;
  public losePatchResponse = false;
  public loseDeleteResponse = false;
  public foreignGetResponse = false;
  public calls = 0;
  public readonly events = new Map<string, { readonly externalEventId: string; readonly remoteVersion: string; readonly remoteState: "active"; readonly startAt: string; readonly endAt: string; readonly timeZone: string; readonly createOperationId: string | null; readonly lastOperationId: string | null; }>();
  public async listEvents(): Promise<ExternalEventListResult> { return { kind: "success", events: [...this.events.values()] }; }
  public async listBusyIntervals(): Promise<Awaited<ReturnType<ExternalBusyProviderPort["listBusyIntervals"]>>> { return { kind: "success", intervals: [...this.events.values()].map(event => ({ startAt: event.startAt, endAt: event.endAt, units: 1, observationKey: event.externalEventId })) }; }
  public async reconcileEvents(request: { readonly startAt: string; readonly endAt: string }): Promise<Awaited<ReturnType<import("../scheduling/application/externalCalendarPorts.js").ExternalCalendarReconciliationProviderPort["reconcileEvents"]>>> { return { kind: "success", events: [...this.events.values()].filter(event => event.startAt < request.endAt && event.endAt > request.startAt) }; }
  public async getEvent(request: Parameters<ExternalCalendarEventProviderPort["getEvent"]>[0]): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["getEvent"]>>> { this.calls += 1; const event = this.events.get(request.externalEventId); return event ? { kind: "success", event: this.foreignGetResponse ? { ...event, externalEventId: "a0001" } : event } : { kind: "not_found" }; }
  public async insertEvent(request: Parameters<ExternalCalendarEventProviderPort["insertEvent"]>[0]): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["insertEvent"]>>> { this.calls += 1; const event = { externalEventId: request.externalEventId, remoteVersion: `etag-${this.events.size + 1}`, remoteState: "active" as const, startAt: request.startAt, endAt: request.endAt, timeZone: request.timeZone, createOperationId: request.operationId, lastOperationId: null }; this.events.set(event.externalEventId, event); return this.loseInsertResponse ? { kind: "timeout" } : { kind: "success", event }; }
  public async patchEvent(request: Parameters<ExternalCalendarEventProviderPort["patchEvent"]>[0]): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["patchEvent"]>>> { this.calls += 1; const current = this.events.get(request.externalEventId); if (!current) return { kind: "not_found" }; if (current.remoteVersion !== request.expectedRemoteVersion) return { kind: "conflict" }; const event = { ...current, remoteVersion: `etag-${this.events.size + 1}-${this.calls}`, startAt: request.startAt, endAt: request.endAt, timeZone: request.timeZone, lastOperationId: request.operationId }; this.events.set(event.externalEventId, event); return this.losePatchResponse ? { kind: "timeout" } : { kind: "success", event }; }
  public async deleteEvent(request: Parameters<ExternalCalendarEventProviderPort["deleteEvent"]>[0]): Promise<Awaited<ReturnType<ExternalCalendarEventProviderPort["deleteEvent"]>>> { this.calls += 1; const current = this.events.get(request.externalEventId); if (!current) return { kind: "not_found" }; if (current.remoteVersion !== request.expectedRemoteVersion) return { kind: "conflict" }; this.events.delete(request.externalEventId); return this.loseDeleteResponse ? { kind: "timeout" } : { kind: "success" }; }
}
class FakeOutboxRegistry implements ProviderAdapterRegistryPort {
  public constructor(private readonly provider: FakeOutboxProvider) {}
  public register(): void {}
  public resolveValidation() { return null; }
  public resolveCalendarBusy() { return this.provider; }
  public resolveCalendarEvents() { return this.provider; }
  public resolveCalendarReconciliation() { return this.provider; }
}

test("EPIC057 reconciliation evidence paginates completely and rejects cycles and duplicates", async () => {
  const binding = { id: "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as never, workspaceId: 1, companyId: 1, resourceId: "src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as never, integrationConnectionId: "icn_calendar" as never, externalCalendarId: "calendar-1", createdAt: "2026-09-28T12:00:00.000Z", updatedAt: "2026-09-28T12:00:00.000Z" };
  const item = (id: string) => ({ id, etag: `"${id}"`, status: "confirmed", start: { dateTime: "2026-09-29T13:00:00.000Z", timeZone: "UTC" }, end: { dateTime: "2026-09-29T13:30:00.000Z", timeZone: "UTC" } });
  const provider = (listEvents: (input: { readonly pageToken?: string }) => Promise<{ readonly status: number; readonly body: string }>) => new GoogleCalendarEventsProvider({ resolve: async () => ({ kind: "resolved" as const, provider: "google_calendar", integrationKind: "calendar", material: { version: "v1", opaqueSecret: "opaque" } }) }, { acquire: async () => ({ kind: "success" as const, accessToken: "token" }) }, { listEvents, getEvent: async () => ({ status: 500, body: "" }), insertEvent: async () => ({ status: 500, body: "" }), patchEvent: async () => ({ status: 500, body: "" }), deleteEvent: async () => ({ status: 500, body: "" }) });
  const request = { context: { workspaceId: 1 } as never, companyId: 1, connectionId: "icn_calendar" as never, binding, startAt: "2026-09-29T13:00:00.000Z", endAt: "2026-09-29T13:30:00.000Z", signal: new AbortController().signal };
  const tokens: Array<string | undefined> = [];
  const complete = provider(async input => { tokens.push(input.pageToken); return input.pageToken === undefined ? { status: 200, body: JSON.stringify({ items: [item("a0000")], nextPageToken: "second" }) } : { status: 200, body: JSON.stringify({ items: [item("a0001")] }) }; });
  assert.equal((await complete.reconcileEvents(request)).kind, "success"); assert.deepEqual(tokens, [undefined, "second"]);
  const cycle = provider(async () => ({ status: 200, body: JSON.stringify({ items: [], nextPageToken: "again" }) }));
  assert.equal((await cycle.reconcileEvents(request)).kind, "invalid_response");
  const duplicate = provider(async input => input.pageToken === undefined ? { status: 200, body: JSON.stringify({ items: [item("a0000")], nextPageToken: "second" }) } : { status: 200, body: JSON.stringify({ items: [item("a0000")] }) });
  assert.equal((await duplicate.reconcileEvents(request)).kind, "invalid_response");
  const bounded = provider(async input => { const page = input.pageToken === undefined ? 0 : Number(input.pageToken); return { status: 200, body: JSON.stringify({ items: [item(`a00${page}0`)], nextPageToken: String(page + 1) }) }; });
  assert.equal((await bounded.reconcileEvents(request)).kind, "invalid_response");
});

test("EPIC057 verified conflict evidence requires a fresh Atlas-owned event and consistent bounded reads", async () => {
  const provider = new EvidenceProvider(), binding = { id: "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as never, workspaceId: 1, companyId: 1, resourceId: "src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as never, integrationConnectionId: "icn_calendar" as never, externalCalendarId: "calendar-1", createdAt: "2026-09-28T12:00:00.000Z", updatedAt: "2026-09-28T12:00:00.000Z" }, event = { externalEventId: "a0000", remoteVersion: "etag-1", remoteState: "active" as const, startAt: "2026-09-29T13:00:00.000Z", endAt: "2026-09-29T13:30:00.000Z", timeZone: "America/New_York" };
  provider.listed = [event];
  const verifier = new GoogleCalendarConflictEvidenceVerifier(provider, provider, provider, new Clock()), input = { connectionId: "icn_calendar", binding, googleSubject: "subject-calendar", externalEventId: event.externalEventId, expectedRemoteVersion: event.remoteVersion, expectedOperationId: provider.operationId, startAt: event.startAt, endAt: event.endAt };
  const first = await verifier.verify({ workspaceId: 1, workspaceKey: "default" }, 1, input), second = await verifier.verify({ workspaceId: 1, workspaceKey: "default" }, 1, input);
  assert.ok(first); assert.equal(first?.fingerprint, second?.fingerprint); assert.equal(first?.timeZone, "America/New_York");
  provider.foreign = true; assert.equal(await verifier.verify({ workspaceId: 1, workspaceKey: "default" }, 1, input), null); provider.foreign = false;
  provider.stale = true; assert.equal(await verifier.verify({ workspaceId: 1, workspaceKey: "default" }, 1, input), null); provider.stale = false;
  provider.busy = []; assert.equal(await verifier.verify({ workspaceId: 1, workspaceKey: "default" }, 1, input), null); provider.busy = null;
  provider.failure = true; assert.equal(await verifier.verify({ workspaceId: 1, workspaceKey: "default" }, 1, input), null);
  provider.failure = false; assert.equal(await verifier.verify({ workspaceId: 2, workspaceKey: "foreign" }, 1, input), null);
});

test("EPIC057 P2 persists a local-first calendar outbox atomically through libSQL", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-calendar-sync-")), path = join(directory, "atlas.sqlite");
  let synchronous = new DatabaseSync(path), database: SqlDatabase | null = null;
  try {
    synchronous.exec("PRAGMA foreign_keys=ON;"); runMigrations(synchronous);
    const context = createWorkspaceContext(new WorkspaceRepository(synchronous).resolveDefault()), company = new CompanyRepository(synchronous).create(context, { name: "Calendar core", website: "https://calendar-core.test" }), local = new LocalSqlDatabase(synchronous), clock = new Clock(), scheduling = new SchedulingService(new SchedulingRepository(local), clock);
    const resource = await scheduling.createResource(context, company.id, { name: "Room", timezone: "UTC" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Visit", durationMinutes: 30 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 1, startTime: "13:00", endTime: "14:00" });
    const slot = (await scheduling.listSlots(context, company.id, service.id, { fromLocalDate: "2026-09-28", days: 1 }))[0]!;
    const booking = await new BookingCommandService(new BookingRepository(local), clock).create(context, company.id, { serviceId: service.id, startAt: slot.startAt, reference: "P2-1", idempotencyKey: "p2-booking" });
    synchronous.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run("icn_calendar", context.workspaceId, company.id, "google_calendar", "calendar", clock.now(), clock.now());
    synchronous.prepare("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", context.workspaceId, company.id, resource.id, "icn_calendar", "calendar-1", clock.now(), clock.now());
    synchronous.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(database);
    const repository = new CalendarSyncRepository(), input = { id: "cso_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bookingId: booking.id, bindingId: "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operation: "create" as const, idempotencyKey: "p2-create", requestFingerprint: createHash("sha256").update("p2-create").digest("hex"), at: clock.now() };
    const item = await database.transaction(async transaction => repository.enqueue(transaction, context, company.id, input));
    assert.equal(item.state, "pending"); assert.equal(await repository.status(database, context, company.id, booking.id), "pending");
    assert.equal((await repository.enqueue(database, context, company.id, input)).id, item.id);
    await assert.rejects(database.transaction(async transaction => { await repository.enqueue(transaction, context, company.id, { ...input, id: "cso_cccccccccccccccccccccccccccccccc", idempotencyKey: "p2-rollback" }); throw new Error("rollback"); }));
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_calendar_sync_outbox WHERE workspace_id=? AND company_id=?", [context.workspaceId, company.id]))[0]?.count, 1);
    assert.deepEqual(await new FakeEventListing().listEvents(), { kind: "success", events: [{ externalEventId: "a0000", remoteVersion: "etag-1", remoteState: "active", startAt: "2026-09-29T13:00:00.000Z", endAt: "2026-09-29T13:30:00.000Z", timeZone: "UTC" }] });
  } finally { if (synchronous.isOpen) synchronous.close(); if (database) await database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});

test("EPIC057 P2 bound commands preflight, commit booking and outbox together, and survive restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-bound-calendar-")), path = join(directory, "atlas.sqlite");
  let synchronous = new DatabaseSync(path), database: SqlDatabase | null = null;
  try {
    synchronous.exec("PRAGMA foreign_keys=ON;"); runMigrations(synchronous);
    const context = createWorkspaceContext(new WorkspaceRepository(synchronous).resolveDefault()), company = new CompanyRepository(synchronous).create(context, { name: "Bound calendar", website: "https://bound-calendar.test" }), local = new LocalSqlDatabase(synchronous), clock = new Clock(), scheduling = new SchedulingService(new SchedulingRepository(local), clock);
    const resource = await scheduling.createResource(context, company.id, { name: "Room", timezone: "UTC" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Visit", durationMinutes: 30 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 1, startTime: "13:00", endTime: "14:00" });
    const slots = await scheduling.listSlots(context, company.id, service.id, { fromLocalDate: "2026-09-28", days: 1 });
    synchronous.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run("icn_calendar", context.workspaceId, company.id, "google_calendar", "calendar", clock.now(), clock.now());
    const bindingId = "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    synchronous.prepare("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(bindingId, context.workspaceId, company.id, resource.id, "icn_calendar", "calendar-1", clock.now(), clock.now());
    synchronous.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(database);
    const provider = new FakeProvider(), ready: ReadyCalendarBindingPort = { async resolveReadyBindingForResource(): Promise<ReadyExternalCalendarBindingResolution> { return { kind: "ready", binding: { bindingId: bindingId as never, connectionId: "icn_calendar", resourceId: resource.id, externalCalendarId: "calendar-1", provider: "google_calendar", kind: "calendar" } }; } };
    let mappedBookingId = "";
    const mappings: ExternalBookingEventRepositoryPort = { async create() { return null; }, async findByBooking(_context, _companyId, bookingId) { return bookingId === mappedBookingId ? { id: "ebe_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as never, workspaceId: context.workspaceId, companyId: company.id, bookingId: bookingId as never, bindingId: bindingId as never, externalEventId: "a0000", remoteVersion: "etag-1", remoteState: "active", createdAt: clock.now(), updatedAt: clock.now() } : null; }, async findCurrent() { return null; } };
    const commands = new CalendarBoundBookingCommandService(database, new SchedulingRepository(database), ready, mappings, new FakeRegistry(provider), new CalendarSyncRepository(), clock);
    const created = await commands.create(context, company.id, { serviceId: service.id, startAt: slots[0]!.startAt, reference: "BOUND-1", idempotencyKey: "bound-create" });
    assert.equal(created.kind, "pending"); if (created.kind !== "pending") throw new Error("expected booking");
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_calendar_sync_outbox", []))[0]?.count, 1);
    assert.equal((await commands.create(context, company.id, { serviceId: service.id, startAt: slots[0]!.startAt, reference: "BOUND-1", idempotencyKey: "bound-create" })).kind, "pending");
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_calendar_sync_outbox", []))[0]?.count, 1);
    mappedBookingId = created.booking.id;
    provider.listed = [{ externalEventId: "a0000", remoteVersion: "etag-1", remoteState: "active", startAt: created.booking.startAt, endAt: created.booking.endAt, timeZone: "UTC" }];
    const preflight = new CalendarAvailabilityPreflightService(provider, provider), bound = { id: bindingId as never, workspaceId: context.workspaceId, companyId: company.id, resourceId: resource.id, integrationConnectionId: "icn_calendar" as never, externalCalendarId: "calendar-1", createdAt: clock.now(), updatedAt: clock.now() };
    const mapping = { externalEventId: "a0000", remoteVersion: "etag-1" };
    provider.listed = [...provider.listed, { externalEventId: "a0001", remoteVersion: "etag-2", remoteState: "active", startAt: slots[1]!.startAt, endAt: new Date(Date.parse(slots[1]!.startAt) + 30 * 60_000).toISOString(), timeZone: "UTC" }];
    assert.equal((await preflight.reschedule(context, company.id, "icn_calendar", bound, created.booking, mapping, { startAt: slots[1]!.startAt, endAt: new Date(Date.parse(slots[1]!.startAt) + 30 * 60_000).toISOString() })).kind, "availability_unverified");
    provider.listed = provider.listed.slice(0, 1); provider.busy = [];
    assert.equal((await preflight.reschedule(context, company.id, "icn_calendar", bound, created.booking, mapping, { startAt: slots[1]!.startAt, endAt: new Date(Date.parse(slots[1]!.startAt) + 30 * 60_000).toISOString() })).kind, "availability_unverified");
    provider.busy = null;
    const rescheduled = await commands.reschedule(context, company.id, { bookingId: created.booking.id, startAt: slots[1]!.startAt, reference: "BOUND-2", idempotencyKey: "bound-reschedule" });
    assert.equal(rescheduled.kind, "pending"); if (rescheduled.kind !== "pending") throw new Error("expected reschedule");
    mappedBookingId = rescheduled.booking.id; provider.listed = [];
    const callsBeforeCancel = provider.getCalls;
    assert.equal((await commands.cancel(context, company.id, { bookingId: rescheduled.booking.id, idempotencyKey: "bound-cancel" })).kind, "pending");
    assert.equal(provider.getCalls, callsBeforeCancel);
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_calendar_sync_outbox WHERE operation='cancel'", []))[0]?.count, 1);
    const failing = new CalendarBoundBookingCommandService(database, new SchedulingRepository(database), ready, mappings, new FakeRegistry(provider), new FailingCalendarSyncRepository(), clock);
    assert.equal((await failing.create(context, company.id, { serviceId: service.id, startAt: slots[0]!.startAt, reference: "ROLLBACK", idempotencyKey: "bound-rollback" })).kind, "conflict");
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_bookings", []))[0]?.count, 2);
    await database.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token");
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_calendar_sync_outbox WHERE state='pending'", []))[0]?.count, 3);
  } finally { if (synchronous.isOpen) synchronous.close(); if (database) await database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});

test("EPIC057 PASS2 reclaims calendar outbox leases and reconciles ambiguous Google creates through libSQL", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-calendar-worker-")), path = join(directory, "atlas.sqlite");
  let synchronous = new DatabaseSync(path), database: SqlDatabase | null = null;
  try {
    synchronous.exec("PRAGMA foreign_keys=ON;"); runMigrations(synchronous);
    const context = createWorkspaceContext(new WorkspaceRepository(synchronous).resolveDefault()), company = new CompanyRepository(synchronous).create(context, { name: "Calendar worker", website: "https://calendar-worker.test" }), local = new LocalSqlDatabase(synchronous), scheduling = new SchedulingService(new SchedulingRepository(local), new Clock());
    const resource = await scheduling.createResource(context, company.id, { name: "Room", timezone: "UTC" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Visit", durationMinutes: 30 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 1, startTime: "13:00", endTime: "15:00" });
    const slots = await scheduling.listSlots(context, company.id, service.id, { fromLocalDate: "2026-09-28", days: 1 }), commands = new BookingCommandService(new BookingRepository(local), new Clock());
    const first = await commands.create(context, company.id, { serviceId: service.id, startAt: slots[0]!.startAt, reference: "WORKER-1", idempotencyKey: "worker-booking-1" }), secondSlot = slots.find(slot => slot.startAt >= first.endAt);
    assert.ok(secondSlot);
    const second = await commands.create(context, company.id, { serviceId: service.id, startAt: secondSlot.startAt, reference: "WORKER-2", idempotencyKey: "worker-booking-2" });
    const bindingId = "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    synchronous.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run("icn_calendar", context.workspaceId, company.id, "google_calendar", "calendar", "2026-09-28T12:00:00.000Z", "2026-09-28T12:00:00.000Z");
    synchronous.prepare("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(bindingId, context.workspaceId, company.id, resource.id, "icn_calendar", "calendar-1", "2026-09-28T12:00:00.000Z", "2026-09-28T12:00:00.000Z");
    synchronous.prepare("INSERT INTO google_calendar_authorizations(integration_connection_id,workspace_id,company_id,google_subject,status,authorized_at,revoked_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?)").run("icn_calendar", context.workspaceId, company.id, "subject-worker", "active", "2026-09-28T12:00:00.000Z", "2026-09-28T12:00:00.000Z");
    synchronous.prepare("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)").run("icn_calendar", context.workspaceId, company.id, "calendar-1", "Calendar", "writer", "2026-09-28T12:00:00.000Z");
    synchronous.prepare("INSERT INTO google_calendar_company_bindings(binding_id,workspace_id,company_id,google_subject,calendar_id,created_at,state,version,updated_at) VALUES(?,?,?,?,?,?, 'active',1,?)").run(bindingId, context.workspaceId, company.id, "subject-worker", "calendar-1", "2026-09-28T12:00:00.000Z", "2026-09-28T12:00:00.000Z");
    synchronous.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(database);
    const repository = new CalendarSyncRepository(database), fingerprint = createHash("sha256").update("worker").digest("hex"), at = "2026-09-28T12:00:00.000Z";
    const one = await repository.enqueue(database, context, company.id, { id: "cso_11111111111111111111111111111111", bookingId: first.id, bindingId, operation: "create", idempotencyKey: "worker-one", requestFingerprint: fingerprint, at });
    assert.equal(one.providerOperationId, "ewo_11111111111111111111111111111111");
    assert.ok(await database.transaction(transaction => repository.claimNext(transaction, context, company.id, "worker-a", at, "2026-09-28T12:01:00.000Z")));
    const provider = new FakeOutboxProvider(); let now = "2026-09-28T12:01:01.000Z";
    const worker = new GoogleCalendarOutboxWorker(repository, new FakeOutboxRegistry(provider), { now: () => now });
    assert.equal(await worker.runOnce(context, company.id, "worker-b"), "synced");
    assert.equal((await repository.find(database, context, company.id, one.id))?.attemptCount, 2);
    const two = await repository.enqueue(database, context, company.id, { id: "cso_22222222222222222222222222222222", bookingId: second.id, bindingId, operation: "create", idempotencyKey: "worker-two", requestFingerprint: createHash("sha256").update("worker-two").digest("hex"), at: now });
    provider.loseInsertResponse = true;
    assert.equal(await worker.runOnce(context, company.id, "worker-b"), "retryable");
    assert.equal(await repository.status(database, context, company.id, second.id), "pending");
    provider.loseInsertResponse = false; now = "2026-09-28T12:02:01.000Z";
    assert.equal(await worker.runOnce(context, company.id, "worker-c"), "synced");
    assert.equal((await repository.find(database, context, company.id, two.id))?.state, "succeeded");
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*) count FROM scheduling_external_booking_events WHERE booking_id=?", [second.id]))[0]?.count, 1);
    const secondEventId = googleCalendarEventId(two.providerOperationId), secondEvent = provider.events.get(secondEventId)!;
    provider.events.set(secondEventId, { ...secondEvent, remoteVersion: "etag-worker-drift", startAt: "2026-09-28T14:00:00.000Z", endAt: "2026-09-28T14:30:00.000Z" });
    await repository.enqueue(database, context, company.id, { id: "cso_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", bookingId: second.id, bindingId, operation: "cancel", idempotencyKey: "worker-verified-conflict", requestFingerprint: createHash("sha256").update("worker-verified-conflict").digest("hex"), at: now });
    assert.equal(await worker.runOnce(context, company.id, "worker-verified-conflict"), "conflict");
    const durableConflict = (await database.query<{ id: string; state: string; evidence_fingerprint: string }>("SELECT id,state,evidence_fingerprint FROM scheduling_calendar_sync_conflicts WHERE booking_id=? AND binding_id=?", [second.id, bindingId]))[0]!;
    assert.equal(durableConflict.state, "open");
    assert.deepEqual(await database.query<{ conflict_id: string; etag: string; source: string }>("SELECT conflict_id,etag,source FROM scheduling_calendar_sync_remote_evidence_snapshots WHERE conflict_id=?", [durableConflict.id]), [{ conflict_id: durableConflict.id, etag: "etag-worker-drift", source: "worker_verifier" }]);
    provider.events.set(secondEventId, { ...secondEvent, remoteVersion: "etag-worker-drift" });
    const rescheduledId = "sbk_33333333333333333333333333333333", rescheduledStart = second.startAt, rescheduledEnd = second.endAt;
    await database.execute("INSERT INTO scheduling_bookings(id,workspace_id,company_id,service_id,hold_id,rescheduled_from_booking_id,reference,start_at,end_at,occupied_start_at,occupied_end_at,state,created_at,cancelled_at) VALUES(?,?,?,?,NULL,?,?,?,?,?,?, 'confirmed',?,NULL)", [rescheduledId, context.workspaceId, company.id, service.id, first.id, "WORKER-1-R", rescheduledStart, rescheduledEnd, rescheduledStart, rescheduledEnd, now]);
    await database.execute("UPDATE scheduling_bookings SET state='cancelled',cancelled_at=? WHERE id=?", [now, first.id]);
    await repository.enqueue(database, context, company.id, { id: "cso_33333333333333333333333333333333", bookingId: rescheduledId, bindingId, operation: "reschedule", idempotencyKey: "worker-reschedule", requestFingerprint: createHash("sha256").update("worker-reschedule").digest("hex"), at: now });
    provider.losePatchResponse = true;
    assert.equal(await worker.runOnce(context, company.id, "worker-d"), "retryable");
    provider.losePatchResponse = false; now = "2026-09-28T12:03:01.000Z";
    assert.equal(await worker.runOnce(context, company.id, "worker-d-reconcile"), "synced");
    assert.equal((await repository.mapping(database, context, company.id, rescheduledId, bindingId))?.externalEventId, googleCalendarEventId(one.providerOperationId));
    await database.execute("UPDATE scheduling_bookings SET state='cancelled',cancelled_at=? WHERE id=?", [now, rescheduledId]);
    await repository.enqueue(database, context, company.id, { id: "cso_44444444444444444444444444444444", bookingId: rescheduledId, bindingId, operation: "cancel", idempotencyKey: "worker-cancel", requestFingerprint: createHash("sha256").update("worker-cancel").digest("hex"), at: now });
    provider.loseDeleteResponse = true;
    assert.equal(await worker.runOnce(context, company.id, "worker-e"), "retryable");
    provider.loseDeleteResponse = false; now = "2026-09-28T12:04:01.000Z";
    assert.equal(await worker.runOnce(context, company.id, "worker-e-reconcile"), "synced");
    assert.deepEqual(await repository.mapping(database, context, company.id, rescheduledId, bindingId), { externalEventId: googleCalendarEventId(one.providerOperationId), remoteVersion: null });
    await database.execute("UPDATE scheduling_bookings SET state='cancelled',cancelled_at=? WHERE id=?", [now, second.id]);
    await repository.enqueue(database, context, company.id, { id: "cso_f1111111111111111111111111111111", bookingId: second.id, bindingId, operation: "cancel", idempotencyKey: "worker-foreign-cancel", requestFingerprint: createHash("sha256").update("worker-foreign-cancel").digest("hex"), at: now });
    provider.foreignGetResponse = true; const foreignCalls = provider.calls;
    assert.equal(await worker.runOnce(context, company.id, "worker-foreign"), "conflict");
    assert.equal(provider.calls, foreignCalls + 1); assert.ok(await repository.mapping(database, context, company.id, second.id, bindingId)); provider.foreignGetResponse = false;
    for (const [suffix, mutation, restore] of [
      ["5", "UPDATE google_calendar_authorizations SET status='revoked' WHERE integration_connection_id='icn_calendar'", "UPDATE google_calendar_authorizations SET status='active' WHERE integration_connection_id='icn_calendar'"],
      ["6", "UPDATE google_calendar_accesses SET access_role='reader' WHERE integration_connection_id='icn_calendar'", "UPDATE google_calendar_accesses SET access_role='writer' WHERE integration_connection_id='icn_calendar'"],
      ["7", "UPDATE google_calendar_company_bindings SET google_subject='other-subject' WHERE binding_id='ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'", "UPDATE google_calendar_company_bindings SET google_subject='subject-worker' WHERE binding_id='ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"],
      ["8", "UPDATE scheduling_external_resource_bindings SET state='blocked' WHERE id='ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'", "UPDATE scheduling_external_resource_bindings SET state='active' WHERE id='ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"],
      ["9", "UPDATE integration_connections SET status='inactive' WHERE id='icn_calendar'", "UPDATE integration_connections SET status='active' WHERE id='icn_calendar'"],
    ] as const) {
      await repository.enqueue(database, context, company.id, { id: `cso_${suffix.repeat(32)}`, bookingId: second.id, bindingId, operation: "create", idempotencyKey: `worker-guard-${suffix}`, requestFingerprint: createHash("sha256").update(`worker-guard-${suffix}`).digest("hex"), at: now });
      await database.execute(mutation); const calls = provider.calls; assert.equal(await worker.runOnce(context, company.id, `worker-guard-${suffix}`), "conflict"); assert.equal(provider.calls, calls); await database.execute(restore);
    }
    assert.ok(one.causalGeneration > 0);
    const rollback = await repository.enqueue(database, context, company.id, { id: "cso_f2222222222222222222222222222222", bookingId: second.id, bindingId, operation: "cancel", idempotencyKey: "worker-settlement-rollback", requestFingerprint: createHash("sha256").update("worker-settlement-rollback").digest("hex"), at: now });
    await database.execute("CREATE TRIGGER epic057_cancel_settlement_fault BEFORE DELETE ON scheduling_external_booking_events BEGIN SELECT RAISE(ABORT,'injected calendar settlement fault'); END;");
    assert.equal(await worker.runOnce(context, company.id, "worker-rollback"), "synced");
    assert.equal((await repository.find(database, context, company.id, rollback.id))?.state, "succeeded"); assert.deepEqual(await repository.mapping(database, context, company.id, second.id, bindingId), { externalEventId: googleCalendarEventId(two.providerOperationId), remoteVersion: null });
    await database.execute("DROP TRIGGER epic057_cancel_settlement_fault;"); await database.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); now = new Date(Date.parse(now) + 60_000).toISOString();
    const restarted = new GoogleCalendarOutboxWorker(new CalendarSyncRepository(database), new FakeOutboxRegistry(provider), { now: () => now });
    assert.equal(await restarted.runOnce(context, company.id, "worker-restarted"), "idle");
    assert.equal((await new CalendarSyncRepository(database).find(database, context, company.id, rollback.id))?.state, "succeeded"); assert.deepEqual(await new CalendarSyncRepository(database).mapping(database, context, company.id, second.id, bindingId), { externalEventId: googleCalendarEventId(two.providerOperationId), remoteVersion: null });
  } finally { if (synchronous.isOpen) synchronous.close(); if (database) await database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});
