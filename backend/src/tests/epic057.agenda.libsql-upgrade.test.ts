import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runAsyncMigrations } from "../config/asyncMigrations.js";
import { runMigrations } from "../config/migrations.js";
import { createLibsqlDatabase, LocalSqlDatabase } from "../config/sqlDatabase.js";
import { AgendaRepository } from "../repositories/agendaRepository.js";
import { BookingRepository } from "../repositories/bookingRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { BookingCommandService } from "../scheduling/services/bookingCommandService.js";
import { AgendaService } from "../scheduling/services/agendaService.js";
import { SchedulingService } from "../scheduling/services/schedulingService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

class Clock { public now(): string { return "2026-08-18T12:00:00.000Z"; } }

test("EPIC057 upgrades an existing 0080 legacy booking database through the current head with libSQL exactly once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic057-libsql-upgrade-")), path = join(directory, "agenda.sqlite"), url = pathToFileURL(path).href;
  let synchronous = new DatabaseSync(path), asyncDatabase: ReturnType<typeof createLibsqlDatabase> | null = null;
  try {
    synchronous.exec("PRAGMA foreign_keys=ON;");
    runMigrations(synchronous, 80);
    const context = createWorkspaceContext(new WorkspaceRepository(synchronous).resolveDefault()), company = new CompanyRepository(synchronous).create(context, { name: "Async legacy agenda", website: "https://async-legacy-agenda.test" }), sql = new LocalSqlDatabase(synchronous), clock = new Clock(), scheduling = new SchedulingService(new SchedulingRepository(sql), clock), resource = await scheduling.createResource(context, company.id, { name: "Court", timezone: "UTC" }), service = await scheduling.createService(context, company.id, { resourceId: resource.id, name: "Court hour", durationMinutes: 30 });
    await scheduling.addWorkingWindow(context, company.id, { resourceId: resource.id, weekday: 2, startTime: "13:00", endTime: "16:00" });
    const slot = (await scheduling.listSlots(context, company.id, service.id, { fromLocalDate: "2026-08-18", days: 1 }))[0]!;
    const legacy = await new BookingCommandService(new BookingRepository(sql), clock).create(context, company.id, { serviceId: service.id, startAt: slot.startAt, reference: "ASYNC-LEGACY", idempotencyKey: "async-legacy" });
    synchronous.close();
    asyncDatabase = createLibsqlDatabase(url, "local-test-token");
    await runAsyncMigrations(asyncDatabase);
    assert.deepEqual(await asyncDatabase.query<{ current_booking_id: string; version: number; created_at: string }>("SELECT current_booking_id,version,created_at FROM agenda_bookings WHERE workspace_id=? AND company_id=?", [context.workspaceId, company.id]), [{ current_booking_id: legacy.id, version: 1, created_at: legacy.createdAt }]);
    for (const table of ["contacts", "agenda_booking_audit_events", "agenda_booking_operation_receipts", "agenda_booking_operations"] as const) assert.deepEqual(await asyncDatabase.query<{ count: number }>(`SELECT COUNT(*) count FROM ${table} WHERE workspace_id=? AND company_id=?`, [context.workspaceId, company.id]), [{ count: 0 }]);
    assert.deepEqual(await asyncDatabase.query<{ id: number; name: string }>("SELECT id,name FROM schema_migrations WHERE id BETWEEN 79 AND 81 ORDER BY id"), [{ id: 79, name: "0079_operator_agenda_contacts" }, { id: 80, name: "0080_operator_agenda_contact_identifiers" }, { id: 81, name: "0081_operator_agenda_legacy_projection_receipts" }]);
    const asyncScheduling = new SchedulingService(new SchedulingRepository(asyncDatabase), clock), agenda = new AgendaService(new AgendaRepository(asyncDatabase), clock, asyncScheduling), slots = await agenda.slots(context, company.id, service.id, "2026-08-18"), createInput = { actorId: "operator", origin: "operator" as const, idempotencyKey: "async-create", reason: null, serviceId: service.id, startAt: slots[2]!.startAt, reference: "ASYNC-CREATE", contact: { name: "Ada", phone: "+15551234567", consent: { source: "operator", recordedAt: clock.now() } } }, created = await agenda.create(context, company.id, createInput), moved = await agenda.reschedule(context, company.id, created.booking.id, 1, { actorId: "operator", origin: "operator", idempotencyKey: "async-move", reason: null, startAt: slots[4]!.startAt, reference: "ASYNC-MOVED" }), cancelled = await agenda.cancel(context, company.id, created.booking.id, 2, { actorId: "operator", origin: "operator", idempotencyKey: "async-cancel", reason: null });
    assert.equal(created.booking.contact?.phone, "+15551234567");
    assert.equal(moved.booking.version, 2);
    assert.equal(cancelled.booking.state, "cancelled");
    assert.equal((await agenda.create(context, company.id, createInput)).booking.id, created.booking.id);
    await asyncDatabase.executeScript("CREATE TRIGGER fail_async_agenda_audit BEFORE INSERT ON agenda_booking_audit_events WHEN NEW.idempotency_key='async-rollback' BEGIN SELECT RAISE(ABORT,'forced audit failure'); END;");
    const beforeRollback = await asyncDatabase.query<{ bookings: number; agenda: number; audits: number; receipts: number }>("SELECT (SELECT COUNT(*) FROM scheduling_bookings WHERE workspace_id=? AND company_id=?) bookings,(SELECT COUNT(*) FROM agenda_bookings WHERE workspace_id=? AND company_id=?) agenda,(SELECT COUNT(*) FROM agenda_booking_audit_events WHERE workspace_id=? AND company_id=?) audits,(SELECT COUNT(*) FROM agenda_booking_operation_receipts WHERE workspace_id=? AND company_id=?) receipts", [context.workspaceId, company.id, context.workspaceId, company.id, context.workspaceId, company.id, context.workspaceId, company.id]);
    await assert.rejects(agenda.create(context, company.id, { ...createInput, idempotencyKey: "async-rollback", reference: "ASYNC-ROLLBACK", startAt: slots[5]!.startAt, contact: null }));
    assert.deepEqual(await asyncDatabase.query<{ bookings: number; agenda: number; audits: number; receipts: number }>("SELECT (SELECT COUNT(*) FROM scheduling_bookings WHERE workspace_id=? AND company_id=?) bookings,(SELECT COUNT(*) FROM agenda_bookings WHERE workspace_id=? AND company_id=?) agenda,(SELECT COUNT(*) FROM agenda_booking_audit_events WHERE workspace_id=? AND company_id=?) audits,(SELECT COUNT(*) FROM agenda_booking_operation_receipts WHERE workspace_id=? AND company_id=?) receipts", [context.workspaceId, company.id, context.workspaceId, company.id, context.workspaceId, company.id, context.workspaceId, company.id]), beforeRollback);
    await asyncDatabase.close();
    asyncDatabase = createLibsqlDatabase(url, "local-test-token");
    await runAsyncMigrations(asyncDatabase);
    const restartedScheduling = new SchedulingService(new SchedulingRepository(asyncDatabase), clock), restartedAgenda = new AgendaService(new AgendaRepository(asyncDatabase), clock, restartedScheduling);
    assert.equal((await restartedAgenda.cancel(context, company.id, created.booking.id, 2, { actorId: "operator", origin: "operator", idempotencyKey: "async-cancel", reason: null })).replayed, true);
    assert.deepEqual(await asyncDatabase.query<{ bookings: number; contacts: number; audits: number; receipts: number; migrations: number }>("SELECT (SELECT COUNT(*) FROM agenda_bookings WHERE workspace_id=? AND company_id=?) bookings,(SELECT COUNT(*) FROM contacts WHERE workspace_id=? AND company_id=?) contacts,(SELECT COUNT(*) FROM agenda_booking_audit_events WHERE workspace_id=? AND company_id=?) audits,(SELECT COUNT(*) FROM agenda_booking_operation_receipts WHERE workspace_id=? AND company_id=?) receipts,(SELECT COUNT(*) FROM schema_migrations WHERE id=82) migrations", [context.workspaceId, company.id, context.workspaceId, company.id, context.workspaceId, company.id, context.workspaceId, company.id]), [{ bookings: 2, contacts: 1, audits: 3, receipts: 3, migrations: 1 }]);
  } finally { if (synchronous.isOpen) synchronous.close(); if (asyncDatabase) await asyncDatabase.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});
