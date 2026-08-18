import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { SchedulingConflictError, SchedulingIdempotencyError, SchedulingService } from "../scheduling/services/schedulingService.js";
import { reconstructBusyInterval, SchedulingError, SchedulingNameConflictError } from "../scheduling/domain/scheduling.js";

class Clock { public value = "2026-08-18T12:00:00.000Z"; public now(): string { return this.value; } }
function setup(): { readonly database: ReturnType<typeof createDatabase>; readonly context: ReturnType<typeof createWorkspaceContext>; readonly company: ReturnType<CompanyRepository["create"]>; readonly clock: Clock; readonly service: SchedulingService } { const database = createDatabase(":memory:"), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), company = new CompanyRepository(database).create(context, { name: "Scheduling", website: "https://scheduling.test" }), clock = new Clock(); return { database, context, company, clock, service: new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(database)), clock) }; }

test("EPIC036 migrates fully scoped scheduling tables and constraints", () => {
  const database = createDatabase(":memory:");
  try {
    assert.equal((database.prepare("SELECT name FROM schema_migrations WHERE id=43").get() as { name: string }).name, "0043_scheduling_domain_core");
    assert.equal((database.prepare("SELECT name FROM schema_migrations WHERE id=44").get() as { name: string }).name, "0044_scheduling_normalized_names");
    assert.equal((database.prepare("SELECT name FROM schema_migrations WHERE id=45").get() as { name: string }).name, "0045_scheduling_busy_interval_validation");
    for (const table of ["scheduling_locations", "scheduling_resources", "scheduling_services", "scheduling_working_windows", "scheduling_availability_exceptions", "scheduling_busy_intervals", "scheduling_holds", "scheduling_bookings"]) assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    const holds = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduling_holds'").get() as { sql: string }).sql;
    const locations = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduling_locations'").get() as { sql: string }).sql;
    const busy = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduling_busy_intervals'").get() as { sql: string }).sql;
    assert.match(holds, /idempotency_key TEXT NOT NULL/);
    assert.match(holds, /occupied_start_at TEXT NOT NULL/);
    assert.match(locations, /normalized_name TEXT NOT NULL DEFAULT ''/);
    assert.doesNotMatch(locations, /UNIQUE\(workspace_id,company_id,normalized_name\)/);
    assert.doesNotMatch(busy, /source IN \('internal_block','external_observed'\)/);
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='scheduling_busy_intervals_validate_insert'").get());
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='scheduling_busy_intervals_validate_update'").get());
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});

test("EPIC036 upgrades the original 0043 schema additively and remains restart-safe", () => {
  const from43 = new DatabaseSync(":memory:"), from44 = new DatabaseSync(":memory:");
  try {
    for (const database of [from43, from44]) database.exec("PRAGMA foreign_keys = ON;");
    runMigrations(from43, 43);
    const originalLocations = (from43.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduling_locations'").get() as { sql: string }).sql;
    const originalBusy = (from43.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduling_busy_intervals'").get() as { sql: string }).sql;
    const checksum43 = (from43.prepare("SELECT checksum FROM schema_migrations WHERE id=43").get() as { checksum: string }).checksum;
    assert.doesNotMatch(originalLocations, /normalized_name/);
    assert.match(originalBusy, /source TEXT NOT NULL,external_reference TEXT,created_at TEXT NOT NULL/);
    assert.doesNotMatch(originalBusy, /source IN|external_reference IS NULL|length\(external_reference\)/);
    runMigrations(from43);
    assert.equal((from43.prepare("SELECT checksum FROM schema_migrations WHERE id=43").get() as { checksum: string }).checksum, checksum43);
    assert.equal((from43.prepare("SELECT COUNT\(\*\) AS count FROM schema_migrations").get() as { count: number }).count, 45);
    assert.ok(from43.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='scheduling_busy_intervals_validate_insert'").get());
    const inventory = from43.prepare("SELECT id,name,checksum FROM schema_migrations ORDER BY id").all();
    runMigrations(from43);
    assert.deepEqual(from43.prepare("SELECT id,name,checksum FROM schema_migrations ORDER BY id").all(), inventory);

    runMigrations(from44, 44);
    assert.ok((from44.prepare("PRAGMA table_info(scheduling_locations)").all() as Array<{ name: string }>).some((column) => column.name === "normalized_name"));
    assert.equal(from44.prepare("SELECT id FROM schema_migrations WHERE id=45").get(), undefined);
    runMigrations(from44);
    assert.ok(from44.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='scheduling_busy_intervals_validate_update'").get());
    assert.deepEqual(from44.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { from43.close(); from44.close(); }
});

test("EPIC036 lists timezone-safe slots, applies closures, capacity, buffers, idempotency, and lifecycle", async () => {
  const { database, context, company, clock, service } = setup();
  try {
    const location = await service.createLocation(context, company.id, { name: "Office", address: "1 Main St", timezone: "America/New_York" });
    const resource = await service.createResource(context, company.id, { name: "Room", locationId: location.id, timezone: "America/New_York", capacity: 2 });
    const appointment = await service.createService(context, company.id, { resourceId: resource.id, name: "Viewing", durationMinutes: 30, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, slotGranularityMinutes: 30, minimumLeadMinutes: 30, maximumHorizonDays: 14 });
    await service.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 2, startTime: "09:00", endTime: "11:00" });
    const slots = await service.listSlots(context, company.id, appointment.id, { fromLocalDate: "2026-08-18", days: 1 });
    assert.deepEqual(slots.map((slot) => slot.localStartTime), ["09:30", "10:00"]);
    await service.addException(context, company.id, { resourceId: resource.id, localDate: "2026-08-18", kind: "closed" });
    assert.deepEqual(await service.listSlots(context, company.id, appointment.id, { fromLocalDate: "2026-08-18", days: 1 }), []);
    await service.addException(context, company.id, { resourceId: resource.id, localDate: "2026-08-18", kind: "open", startTime: "09:00", endTime: "10:30" });
    const reopened = await service.listSlots(context, company.id, appointment.id, { fromLocalDate: "2026-08-18", days: 1 });
    assert.deepEqual(reopened.map((slot) => slot.localStartTime), ["09:30"]);
    const input = { serviceId: appointment.id, startAt: reopened[0]!.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "request-1" };
    const first = await service.hold(context, company.id, input);
    assert.equal((await service.hold(context, company.id, input)).id, first.id);
    await assert.rejects(() => service.hold(context, company.id, { ...input, expiresAt: "2026-08-18T12:11:00.000Z" }), SchedulingIdempotencyError);
    const second = await service.hold(context, company.id, { ...input, idempotencyKey: "request-2" });
    await assert.rejects(() => service.hold(context, company.id, { ...input, idempotencyKey: "request-3" }), SchedulingConflictError);
    await service.releaseHold(context, company.id, second.id);
    const booking = await service.book(context, company.id, first.id, "BK-100");
    assert.equal(booking.state, "confirmed");
    await assert.rejects(() => service.book(context, company.id, first.id, "BK-101"), SchedulingConflictError);
    assert.equal((await service.cancelBooking(context, company.id, booking.id)).state, "cancelled");
    clock.value = "2026-08-18T12:11:00.000Z";
    const expired = await service.hold(context, company.id, { ...input, expiresAt: "2026-08-18T12:20:00.000Z", idempotencyKey: "expiring" });
    clock.value = "2026-08-18T12:21:00.000Z";
    await assert.rejects(() => service.book(context, company.id, expired.id, "BK-102"), SchedulingConflictError);
  } finally { database.close(); }
});

test("EPIC036 rejects DST gaps, returns both DST overlaps, and never calls an unready busy provider", async () => {
  const { database, context, company } = setup();
  let called = false;
  const service = new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(database)), { now: () => "2026-10-31T12:00:00.000Z" }, { isReady: async () => false, listBusyIntervals: async () => { called = true; return []; } });
  try {
    const resource = await service.createResource(context, company.id, { name: "DST", timezone: "America/New_York" });
    const appointment = await service.createService(context, company.id, { resourceId: resource.id, name: "DST service", durationMinutes: 30, slotGranularityMinutes: 30 });
    await service.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 0, startTime: "01:00", endTime: "03:00" });
    const overlap = await service.listSlots(context, company.id, appointment.id, { fromLocalDate: "2026-11-01", days: 1 });
    assert.equal(overlap.filter((slot) => slot.localStartTime === "01:00").length, 2);
    const gapResource = await service.createResource(context, company.id, { name: "DST gap", timezone: "America/New_York" });
    const gapService = await service.createService(context, company.id, { resourceId: gapResource.id, name: "DST gap service", durationMinutes: 30, slotGranularityMinutes: 30 });
    await service.addWorkingWindow(context, company.id, { resourceId: gapResource.id, weekday: 0, startTime: "02:00", endTime: "03:00" });
    const springService = new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(database)), { now: () => "2026-03-07T12:00:00.000Z" });
    assert.deepEqual(await springService.listSlots(context, company.id, gapService.id, { fromLocalDate: "2026-03-08", days: 1 }), []);
    await service.refreshExternalBusy(context, company.id, resource.id, "2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z");
    assert.equal(called, false);
  } finally { database.close(); }
});

test("EPIC036 controls normalized names and validates busy interval persistence", async () => {
  const { database, context, company, service } = setup();
  try {
    const location = await service.createLocation(context, company.id, { name: "  Main Office  ", timezone: "UTC" });
    assert.equal((database.prepare("SELECT normalized_name FROM scheduling_locations WHERE id=?").get(location.id) as { normalized_name: string }).normalized_name, "main office");
    await assert.rejects(() => service.createLocation(context, company.id, { name: "MAIN OFFICE", timezone: "UTC" }), SchedulingNameConflictError);
    const resource = await service.createResource(context, company.id, { name: "Room", timezone: "UTC" });
    await assert.rejects(() => service.createResource(context, company.id, { name: " room ", timezone: "UTC" }), SchedulingNameConflictError);
    await service.createService(context, company.id, { resourceId: resource.id, name: "Viewing", durationMinutes: 30 });
    await assert.rejects(() => service.createService(context, company.id, { resourceId: resource.id, name: " viewing ", durationMinutes: 30 }), SchedulingNameConflictError);
    const repository = new SchedulingRepository(new LocalSqlDatabase(database));
    const valid = { id: "a".repeat(32), workspaceId: context.workspaceId, companyId: company.id, resourceId: resource.id, startAt: "2026-08-18T13:00:00.000Z", endAt: "2026-08-18T14:00:00.000Z", units: 1, source: "external_observed" as const, externalReference: "event-1", createdAt: "2026-08-18T12:00:00.000Z" };
    await repository.upsertBusyInterval(context, valid);
    await assert.rejects(() => repository.upsertBusyInterval(context, { ...valid, id: "b".repeat(32), units: 0 }), SchedulingError);
    assert.throws(() => reconstructBusyInterval({ ...valid, source: "internal_block", externalReference: "event-1" }), SchedulingError);
    assert.throws(() => reconstructBusyInterval({ ...valid, externalReference: null }), SchedulingError);
    const insertBusy = database.prepare("INSERT INTO scheduling_busy_intervals(id,workspace_id,company_id,resource_id,start_at,end_at,units,source,external_reference,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    assert.throws(() => insertBusy.run("c".repeat(32), context.workspaceId, company.id, resource.id, valid.startAt, valid.endAt, 1, "unknown", null, valid.createdAt));
    assert.throws(() => insertBusy.run("d".repeat(32), context.workspaceId, company.id, resource.id, valid.startAt, valid.endAt, 1, "internal_block", "unexpected", valid.createdAt));
    assert.throws(() => insertBusy.run("e".repeat(32), context.workspaceId, company.id, resource.id, valid.startAt, valid.endAt, 1, "external_observed", null, valid.createdAt));
    assert.throws(() => database.prepare("UPDATE scheduling_busy_intervals SET source='internal_block' WHERE id=?").run(valid.id));
  } finally { database.close(); }
});

test("EPIC036 scopes reads and writes to the workspace and rejects stale slots", async () => {
  const { database, context, company, service } = setup();
  try {
    const workspaceRepository = new WorkspaceRepository(database);
    const otherContext = createWorkspaceContext(workspaceRepository.createForSystemUse({ key: "scheduling-other", name: "Scheduling Other" }));
    const otherCompany = new CompanyRepository(database).create(otherContext, { name: "Scheduling Other", website: "https://scheduling-other.test" });
    const resource = await service.createResource(context, company.id, { name: "Scoped", timezone: "UTC" });
    const appointment = await service.createService(context, company.id, { resourceId: resource.id, name: "Scoped service", durationMinutes: 30, minimumLeadMinutes: 0 });
    await service.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 2, startTime: "13:00", endTime: "14:00" });
    const slot = (await service.listSlots(context, company.id, appointment.id, { fromLocalDate: "2026-08-18", days: 1 }))[0]!;
    await assert.rejects(() => service.listSlots(otherContext, otherCompany.id, appointment.id, { fromLocalDate: "2026-08-18", days: 1 }), /not found/);
    await assert.rejects(() => service.createService(otherContext, otherCompany.id, { resourceId: resource.id, name: "Cross workspace", durationMinutes: 30 }), /not found/);
    await assert.rejects(() => service.addWorkingWindow(otherContext, otherCompany.id, { resourceId: resource.id, weekday: 2, startTime: "13:00", endTime: "14:00" }), /not found/);
    await assert.rejects(() => service.hold(otherContext, otherCompany.id, { serviceId: appointment.id, startAt: slot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "cross" }), /not found/);
    await service.addException(context, company.id, { resourceId: resource.id, localDate: "2026-08-18", kind: "closed" });
    await assert.rejects(() => service.hold(context, company.id, { serviceId: appointment.id, startAt: slot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "stale" }), SchedulingConflictError);
  } finally { database.close(); }
});

test("EPIC036 scopes normalized scheduling names to a workspace company", async () => {
  const { database, context, company, service } = setup();
  try {
    const otherContext = createWorkspaceContext(new WorkspaceRepository(database).createForSystemUse({ key: "scheduling-names-other", name: "Scheduling Names Other" }));
    const otherCompany = new CompanyRepository(database).create(otherContext, { name: "Scheduling Names Other", website: "https://scheduling-names-other.test" });
    const location = await service.createLocation(context, company.id, { name: "Main Office", timezone: "UTC" });
    await assert.rejects(() => service.createLocation(context, company.id, { name: " main office ", timezone: "UTC" }), SchedulingNameConflictError);
    const resource = await service.createResource(context, company.id, { name: "Room", locationId: location.id, timezone: "UTC" });
    await assert.rejects(() => service.createResource(context, company.id, { name: " room ", timezone: "UTC" }), SchedulingNameConflictError);
    await service.createService(context, company.id, { resourceId: resource.id, name: "Viewing", durationMinutes: 30 });
    await assert.rejects(() => service.createService(context, company.id, { resourceId: resource.id, name: " viewing ", durationMinutes: 30 }), SchedulingNameConflictError);
    const otherService = new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(database)), { now: () => "2026-08-18T12:00:00.000Z" });
    const otherLocation = await otherService.createLocation(otherContext, otherCompany.id, { name: "MAIN OFFICE", timezone: "UTC" });
    const otherResource = await otherService.createResource(otherContext, otherCompany.id, { name: "ROOM", locationId: otherLocation.id, timezone: "UTC" });
    await otherService.createService(otherContext, otherCompany.id, { resourceId: otherResource.id, name: "VIEWING", durationMinutes: 30 });
  } finally { database.close(); }
});

test("EPIC036 enforces capacity one and atomically commits one of two duplicate hold confirmations", async () => {
  const { database, context, company, service } = setup();
  try {
    const resource = await service.createResource(context, company.id, { name: "Single", timezone: "UTC", capacity: 1 });
    const appointment = await service.createService(context, company.id, { resourceId: resource.id, name: "Single service", durationMinutes: 30 });
    await service.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 2, startTime: "13:00", endTime: "14:00" });
    const slot = (await service.listSlots(context, company.id, appointment.id, { fromLocalDate: "2026-08-18", days: 1 }))[0]!;
    const hold = await service.hold(context, company.id, { serviceId: appointment.id, startAt: slot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "single" });
    await assert.rejects(() => service.hold(context, company.id, { serviceId: appointment.id, startAt: slot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "second" }), SchedulingConflictError);
    const commits = await Promise.allSettled([service.book(context, company.id, hold.id, "BK-RACE-1"), service.book(context, company.id, hold.id, "BK-RACE-2")]);
    assert.equal(commits.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM scheduling_bookings WHERE hold_id=?").get(hold.id) as { count: number }).count, 1);
  } finally { database.close(); }
});

test("EPIC036 remains durable and enforces capacity during separate-connection holds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-scheduling-")), path = join(directory, "atlas.sqlite"), first = createDatabase(path), second = createDatabase(path);
  try {
    second.exec("PRAGMA busy_timeout = 1");
    const context = createWorkspaceContext(new WorkspaceRepository(first).resolveDefault()), company = new CompanyRepository(first).create(context, { name: "Durable", website: "https://durable.test" }), clock = new Clock();
    const firstService = new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(first)), clock);
    const secondService = new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(second)), clock);
    const single = await firstService.createResource(context, company.id, { name: "Single durable room", timezone: "UTC", capacity: 1 });
    const singleService = await firstService.createService(context, company.id, { resourceId: single.id, name: "Single durable service", durationMinutes: 30 });
    await firstService.addWorkingWindow(context, company.id, { resourceId: single.id, weekday: 2, startTime: "13:00", endTime: "14:00" });
    const singleSlot = (await firstService.listSlots(context, company.id, singleService.id, { fromLocalDate: "2026-08-18", days: 1 }))[0]!;
    const singleHolds = await Promise.allSettled([firstService.hold(context, company.id, { serviceId: singleService.id, startAt: singleSlot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "single-first" }), secondService.hold(context, company.id, { serviceId: singleService.id, startAt: singleSlot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "single-second" })]);
    assert.equal(singleHolds.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((first.prepare("SELECT COUNT(*) AS count FROM scheduling_holds WHERE service_id=? AND state='active'").get(singleService.id) as { count: number }).count, 1);

    const double = await firstService.createResource(context, company.id, { name: "Double durable room", timezone: "UTC", capacity: 2 });
    const doubleService = await firstService.createService(context, company.id, { resourceId: double.id, name: "Double durable service", durationMinutes: 30 });
    await firstService.addWorkingWindow(context, company.id, { resourceId: double.id, weekday: 2, startTime: "13:00", endTime: "14:00" });
    const doubleSlot = (await firstService.listSlots(context, company.id, doubleService.id, { fromLocalDate: "2026-08-18", days: 1 }))[0]!;
    await Promise.allSettled([firstService.hold(context, company.id, { serviceId: doubleService.id, startAt: doubleSlot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "double-first" }), secondService.hold(context, company.id, { serviceId: doubleService.id, startAt: doubleSlot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "double-second" }), firstService.hold(context, company.id, { serviceId: doubleService.id, startAt: doubleSlot.startAt, expiresAt: "2026-08-18T12:10:00.000Z", idempotencyKey: "double-third" })]);
    assert.ok((first.prepare("SELECT COUNT(*) AS count FROM scheduling_holds WHERE service_id=? AND state='active'").get(doubleService.id) as { count: number }).count <= 2);

    const fulfilledHold = singleHolds.find((result) => result.status === "fulfilled");
    if (!fulfilledHold || fulfilledHold.status !== "fulfilled") assert.fail("A capacity-one hold must succeed.");
    const hold = fulfilledHold.value;
    const migrationInventory = first.prepare("SELECT id,name,checksum FROM schema_migrations ORDER BY id").all();
    first.close();
    const restarted = createDatabase(path), restartedService = new SchedulingService(new SchedulingRepository(new LocalSqlDatabase(restarted)), clock);
    try {
      assert.equal((await restartedService.book(context, company.id, hold.id, "BK-RESTART")).state, "confirmed");
      assert.deepEqual(restarted.prepare("SELECT id,name,checksum FROM schema_migrations ORDER BY id").all(), migrationInventory);
      assert.deepEqual(restarted.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { restarted.close(); }
  } finally { try { first.close(); } catch {} second.close(); rmSync(directory, { recursive: true, force: true }); }
});
