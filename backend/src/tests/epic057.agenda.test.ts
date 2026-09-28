import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { runFreshAsyncMigrations } from "../config/asyncMigrations.js";
import { createLibsqlDatabase, LocalSqlDatabase } from "../config/sqlDatabase.js";
import { AgendaRepository } from "../repositories/agendaRepository.js";
import { BookingRepository } from "../repositories/bookingRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { AgendaConflictError, AgendaService, AgendaValidationError, AgendaVersionConflictError } from "../scheduling/services/agendaService.js";
import { BookingCommandService } from "../scheduling/services/bookingCommandService.js";
import { SchedulingService } from "../scheduling/services/schedulingService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

class Clock { public now(): string { return "2026-08-18T12:00:00.000Z"; } }

test("EPIC057 creates a local agenda booking with a contact and preserves replay, audit, and optimistic version rules", async () => {
  const database = createDatabase(":memory:");
  try {
    const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
    const company = new CompanyRepository(database).create(context, { name: "Agenda", website: "https://agenda.test" });
    const otherCompany = new CompanyRepository(database).create(context, { name: "Other agenda", website: "https://other-agenda.test" });
    const sql = new LocalSqlDatabase(database), clock = new Clock();
    const scheduling = new SchedulingService(new SchedulingRepository(sql), clock);
    const resource = await scheduling.createResource(context, company.id, { name: "Desk", timezone: "UTC" });
    const service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Visit", durationMinutes: 30 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 2, startTime: "13:00", endTime: "16:00" });
    const slots = await scheduling.listSlots(context, company.id, service.id, { fromLocalDate: "2026-08-18", days: 1 });
    const agenda = new AgendaService(new AgendaRepository(sql), clock, scheduling);
    const input = { actorId: "usr_operator", origin: "operator" as const, idempotencyKey: "agenda-create", reason: "customer called", serviceId: service.id, startAt: slots[0]!.startAt, reference: "AGENDA-1", contact: { name: "Ada", phone: "+1 (555) 123-4567", consent: { source: "operator", recordedAt: "2026-08-18T12:00:00.000Z" } } };
    const created = await agenda.create(context, company.id, input);
    assert.equal(created.replayed, false);
    assert.equal(created.booking.version, 1);
    assert.equal(created.booking.contact?.phone, "+15551234567");
    await assert.rejects(() => agenda.create(context, company.id, { ...input, idempotencyKey: "invalid-consent", contact: { name: "Ada", phone: "+15551234567", consent: { source: "operator", recordedAt: "not-an-instant" } } }), AgendaValidationError);
    assert.equal((await agenda.create(context, company.id, input)).booking.id, created.booking.id);
    await assert.rejects(() => agenda.create(context, company.id, { ...input, reference: "different" }), AgendaConflictError);
    const moved = await agenda.reschedule(context, company.id, created.booking.id, 1, { actorId: "usr_operator", origin: "phone", idempotencyKey: "agenda-move", reason: "customer requested", startAt: slots[1]!.startAt, reference: "AGENDA-2" });
    assert.equal(moved.booking.version, 2);
    assert.equal(moved.booking.resource.timezone, "UTC");
    assert.equal(moved.booking.service.name, "Visit");
    assert.equal((await agenda.create(context, company.id, input)).booking.bookingId, created.booking.bookingId);
    assert.equal((await agenda.create(context, company.id, input)).booking.version, 1);
    const sameIdentifier = await agenda.create(context, company.id, { ...input, idempotencyKey: "agenda-identifier", reference: "AGENDA-3", startAt: slots[3]!.startAt, contact: { name: "Different display name", phone: "+15551234567", consent: { source: "operator", recordedAt: "2026-08-18T12:00:00.000Z" } } });
    assert.equal(sameIdentifier.booking.contact?.id, created.booking.contact?.id);
    const sameName = await agenda.create(context, company.id, { ...input, idempotencyKey: "agenda-name", reference: "AGENDA-4", startAt: slots[5]!.startAt, contact: { name: "Ada", phone: "+15551234568", consent: { source: "operator", recordedAt: "2026-08-18T12:00:00.000Z" } } });
    assert.notEqual(sameName.booking.contact?.id, created.booking.contact?.id);
    const withoutContact = await agenda.create(context, company.id, { ...input, idempotencyKey: "agenda-no-contact", reference: "AGENDA-5", startAt: slots[7]!.startAt, contact: null });
    assert.equal(withoutContact.booking.contact, null);
    const listed = await agenda.list(context, company.id, { fromDate: "2026-08-18", toDate: "2026-08-18", status: "confirmed", serviceId: service.id, resourceId: resource.id, query: "+1 (555) 123-4567" });
    assert.deepEqual(listed.map(value => value.id), [created.booking.id, sameIdentifier.booking.id]);
    assert.deepEqual(await agenda.list(context, otherCompany.id, { fromDate: "2026-08-18", toDate: "2026-08-18", status: null, serviceId: null, resourceId: null, query: null }), []);
    await assert.rejects(() => agenda.cancel(context, company.id, created.booking.id, 1, { actorId: "usr_operator", origin: "operator", idempotencyKey: "agenda-stale", reason: null }), AgendaVersionConflictError);
    const cancelled = await agenda.cancel(context, company.id, created.booking.id, 2, { actorId: "usr_operator", origin: "operator", idempotencyKey: "agenda-cancel", reason: null });
    assert.equal(cancelled.booking.state, "cancelled");
    const replayedMove = await agenda.reschedule(context, company.id, created.booking.id, 1, { actorId: "usr_operator", origin: "phone", idempotencyKey: "agenda-move", reason: "customer requested", startAt: slots[1]!.startAt, reference: "AGENDA-2" });
    assert.equal(replayedMove.replayed, true);
    assert.equal(replayedMove.booking.version, 2);
    assert.equal(replayedMove.booking.state, "confirmed");
    const audit = database.prepare("SELECT actor_id,origin,reason,previous_version,resulting_version FROM agenda_booking_audit_events ORDER BY occurred_at,id").all() as Array<{ actor_id: string; origin: string; reason: string | null; previous_version: number | null; resulting_version: number }>;
    const initialAudit = audit.find(value => value.reason === "customer called" && value.resulting_version === 1);
    const movedAudit = audit.find(value => value.reason === "customer requested" && value.resulting_version === 2);
    assert.deepEqual(initialAudit && [initialAudit.actor_id, initialAudit.origin, initialAudit.reason, initialAudit.previous_version, initialAudit.resulting_version], ["usr_operator", "operator", "customer called", null, 1]);
    assert.deepEqual(movedAudit && [movedAudit.actor_id, movedAudit.origin, movedAudit.reason, movedAudit.previous_version, movedAudit.resulting_version], ["usr_operator", "phone", "customer requested", 1, 2]);
    assert.deepEqual(created.booking.history.map(value => [value.operation, value.idempotencyKey]), [["create", "agenda-create"]]);
    database.prepare("INSERT INTO agenda_booking_operations(id,workspace_id,company_id,idempotency_key,request_fingerprint,operation,result_agenda_booking_id,created_at) VALUES(?,?,?,?,?,?,?,?)").run(`ago_${"f".repeat(32)}`, context.workspaceId, company.id, "long-receipt", "a".repeat(64), "create", created.booking.id, "2026-08-18T12:00:00.000Z");
    database.prepare("INSERT INTO agenda_booking_operation_receipts(operation_id,workspace_id,company_id,result_json,created_at) VALUES(?,?,?,?,?)").run(`ago_${"f".repeat(32)}`, context.workspaceId, company.id, JSON.stringify({ history: "x".repeat(21_000) }), "2026-08-18T12:00:00.000Z");
    const beforeRollback = (database.prepare("SELECT COUNT(*) AS count FROM scheduling_bookings").get() as { count: number }).count;
    database.exec("CREATE TRIGGER fail_agenda_audit BEFORE INSERT ON agenda_booking_audit_events WHEN NEW.idempotency_key='agenda-rollback' BEGIN SELECT RAISE(ABORT,'forced audit failure'); END;");
    await assert.rejects(() => agenda.create(context, company.id, { ...input, idempotencyKey: "agenda-rollback", reference: "ROLLBACK", startAt: slots[9]!.startAt, contact: null }));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM scheduling_bookings").get() as { count: number }).count, beforeRollback);
  } finally { database.close(); }
});

test("EPIC057 lists canonical legacy heads after range filtering without a global limit", async () => {
  const database = createDatabase(":memory:");
  try {
    const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
    const company = new CompanyRepository(database).create(context, { name: "Legacy agenda", website: "https://legacy-agenda.test" });
    const sql = new LocalSqlDatabase(database), clock = new Clock(), scheduling = new SchedulingService(new SchedulingRepository(sql), clock);
    const newYork = await scheduling.createResource(context, company.id, { name: "New York court", timezone: "America/New_York" });
    const newYorkService = await scheduling.createService(context, company.id, { resourceId: newYork.id, name: "Court hour", durationMinutes: 30 });
    const losAngeles = await scheduling.createResource(context, company.id, { name: "Los Angeles court", timezone: "America/Los_Angeles" });
    const losAngelesService = await scheduling.createService(context, company.id, { resourceId: losAngeles.id, name: "West court", durationMinutes: 30 });
    const insert = database.prepare("INSERT INTO scheduling_bookings(id,workspace_id,company_id,service_id,hold_id,rescheduled_from_booking_id,reference,start_at,end_at,occupied_start_at,occupied_end_at,state,created_at,cancelled_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?,'confirmed',?,NULL)");
    for (let index = 0; index < 101; index += 1) { const start = new Date(Date.parse("2026-08-18T04:00:00.000Z") + index * 60_000).toISOString(), end = new Date(Date.parse(start) + 30 * 60_000).toISOString(); insert.run(`sbk_${index.toString(16).padStart(32, "0")}`, context.workspaceId, company.id, newYorkService.id, `NY-${index}`, start, end, start, end, "2026-08-01T00:00:00.000Z"); }
    insert.run(`sbk_${"f".repeat(32)}`, context.workspaceId, company.id, losAngelesService.id, "LA-local-day", "2026-08-19T06:30:00.000Z", "2026-08-19T07:00:00.000Z", "2026-08-19T06:30:00.000Z", "2026-08-19T07:00:00.000Z", "2026-08-01T00:00:00.000Z");
    const agenda = new AgendaService(new AgendaRepository(sql), clock, scheduling);
    const listed = await agenda.list(context, company.id, { fromDate: "2026-08-18", toDate: "2026-08-18", status: "confirmed", serviceId: null, resourceId: null, query: null });
    assert.equal(listed.length, 102);
    assert.equal(listed[0]?.reference, "NY-0");
    assert.equal(listed.at(-1)?.reference, "LA-local-day");
    const legacy = listed.find(item => item.reference === "NY-0");
    assert.equal(legacy?.id, `abk_${"0".repeat(32)}`);
    assert.deepEqual(legacy?.history, []);
    assert.equal((await agenda.get(context, company.id, legacy!.id)).bookingId, legacy?.bookingId);
  } finally { database.close(); }
});

test("EPIC057 upgrades canonical legacy bookings into restart-safe Agenda projections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic057-")), path = join(directory, "agenda.sqlite");
  let database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    runMigrations(database, 80);
    const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
    const company = new CompanyRepository(database).create(context, { name: "Migrated agenda", website: "https://migrated-agenda.test" });
    const sql = new LocalSqlDatabase(database), clock = new Clock(), scheduling = new SchedulingService(new SchedulingRepository(sql), clock);
    const resource = await scheduling.createResource(context, company.id, { name: "Court", timezone: "UTC" });
    const service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Court hour", durationMinutes: 30 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 2, startTime: "13:00", endTime: "14:00" });
    const slot = (await scheduling.listSlots(context, company.id, service.id, { fromLocalDate: "2026-08-18", days: 1 }))[0]!;
    const legacy = await new BookingCommandService(new BookingRepository(sql), clock).create(context, company.id, { serviceId: service.id, startAt: slot.startAt, reference: "LEGACY-1", idempotencyKey: "legacy" });
    runMigrations(database);
    const migrated = new AgendaService(new AgendaRepository(sql), clock, scheduling);
    const listed = await migrated.list(context, company.id, { fromDate: "2026-08-18", toDate: "2026-08-18", status: null, serviceId: null, resourceId: null, query: null });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.bookingId, legacy.id);
    assert.equal(listed[0]?.contact, null);
    assert.deepEqual(listed[0]?.history, []);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM agenda_bookings").get() as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM contacts").get() as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM agenda_booking_audit_events").get() as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM agenda_booking_operation_receipts").get() as { count: number }).count, 0);
    database.close();
    database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys=ON;");
    runMigrations(database);
    const restarted = new AgendaService(new AgendaRepository(new LocalSqlDatabase(database)), clock, scheduling);
    assert.equal((await restarted.get(context, company.id, listed[0]!.id)).bookingId, legacy.id);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM agenda_bookings").get() as { count: number }).count, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC057 creates the Agenda projection schema through the production libSQL adapter", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic057-libsql-")), database = createLibsqlDatabase(pathToFileURL(join(directory, "agenda.sqlite")).href, "local-test-token");
  try {
    await runFreshAsyncMigrations(database);
    assert.deepEqual(await database.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agenda_bookings','agenda_booking_operation_receipts') ORDER BY name"), [{ name: "agenda_booking_operation_receipts" }, { name: "agenda_bookings" }]);
  } finally { await database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {} }
});

test("EPIC057 fails closed for a calendar-bound resource and emits DST-safe server slots", async () => {
  const database = createDatabase(":memory:");
  try {
    const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), company = new CompanyRepository(database).create(context, { name: "Bound agenda", website: "https://bound-agenda.test" }), clock = { now: (): string => "2026-01-01T00:00:00.000Z" }, sql = new LocalSqlDatabase(database), scheduling = new SchedulingService(new SchedulingRepository(sql), clock), resource = await scheduling.createResource(context, company.id, { name: "New York court", timezone: "America/New_York" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Court", durationMinutes: 30, slotGranularityMinutes: 30, maximumHorizonDays: 365 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 0, startTime: "01:00", endTime: "04:00" });
    const agenda = new AgendaService(new AgendaRepository(sql), clock, scheduling), fallSlots = await agenda.slots(context, company.id, service.id, "2026-11-01"), springSlots = await agenda.slots(context, company.id, service.id, "2026-03-08");
    assert.equal(fallSlots.filter(slot => slot.localStartTime === "01:00").length, 2);
    assert.equal(springSlots.some(slot => slot.localStartTime.startsWith("02:")), false);
    database.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','inactive',1,?,?)").run("icn_agenda", context.workspaceId, company.id, "google_calendar", "calendar", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    database.prepare("INSERT INTO scheduling_external_resource_bindings(id,workspace_id,company_id,resource_id,integration_connection_id,external_calendar_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", context.workspaceId, company.id, resource.id, "icn_agenda", "calendar", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    await assert.rejects(() => agenda.create(context, company.id, { actorId: "operator", origin: "operator", idempotencyKey: "bound", reason: null, serviceId: service.id, startAt: fallSlots[0]!.startAt, reference: "BOUND", contact: null }), AgendaConflictError);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM scheduling_bookings").get() as { count: number }).count, 0);
  } finally { database.close(); }
});
