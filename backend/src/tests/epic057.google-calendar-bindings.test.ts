import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../config/migrations.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { GoogleCalendarBindingService, type GoogleCalendarBindingRefreshPort } from "../scheduling/services/googleCalendarBindingService.js";

class Clock { public now(): string { return "2026-09-28T12:00:00.000Z"; } }
class Refresh implements GoogleCalendarBindingRefreshPort { public response: Awaited<ReturnType<GoogleCalendarBindingRefreshPort["listCalendars"]>> = { kind: "success", subject: "subject-a", calendars: [{ id: "cal-a", displayName: "A", accessRole: "writer" }] }; public async listCalendars(): Promise<Awaited<ReturnType<GoogleCalendarBindingRefreshPort["listCalendars"]>>> { return this.response; } }

test("EPIC057 Google calendar bindings are company-scoped, CAS-safe, and revoke to a blocked state", async () => {
  const sync = new DatabaseSync(":memory:"), now = new Clock().now(); sync.exec("PRAGMA foreign_keys=ON"); runMigrations(sync);
  const database = new LocalSqlDatabase(sync), context = createWorkspaceContext(new WorkspaceRepository(sync).resolveDefault());
  const company = new CompanyRepository(sync).create(context, { name: "Bindings", website: "https://bindings.test" });
  const resource = "src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", other = "src_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", connection = "inc_cccccccccccccccccccccccccccccccc";
  sync.prepare("INSERT INTO scheduling_resources(id,workspace_id,company_id,location_id,name,normalized_name,timezone,capacity,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(resource, context.workspaceId, company.id, null, "Room", "room", "UTC", 1, 1, now, now);
  sync.prepare("INSERT INTO scheduling_resources(id,workspace_id,company_id,location_id,name,normalized_name,timezone,capacity,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(other, context.workspaceId, company.id, null, "Other", "other", "UTC", 1, 1, now, now);
  sync.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run(connection, context.workspaceId, company.id, "google_calendar", "calendar", now, now);
  sync.prepare("INSERT INTO google_calendar_authorizations(integration_connection_id,workspace_id,company_id,google_subject,status,authorized_at,revoked_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?)").run(connection, context.workspaceId, company.id, "subject-a", "active", now, now);
  sync.prepare("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)").run(connection, context.workspaceId, company.id, "cal-a", "A", "writer", now);
  const refresh = new Refresh(), service = new GoogleCalendarBindingService(database, refresh, new Clock());
  const bound = await service.bind(context, company.id, { resourceId: resource, calendarId: "cal-a" }); assert.equal(bound.kind, "bound"); if (bound.kind !== "bound") throw new Error("expected bind");
  assert.equal((await service.bind(context, company.id, { resourceId: resource, calendarId: "cal-a", expectedVersion: 1 })).kind, "replayed");
  assert.equal((await service.bind(context, company.id, { resourceId: other, calendarId: "cal-a" })).kind, "conflict");
  refresh.response = { kind: "revoked" }; assert.equal((await service.reconnect(context, company.id, { resourceId: resource, expectedVersion: 1 })).kind, "revoked");
  assert.equal((await service.status(context, company.id, resource))?.state, "blocked");
  await database.close();
});
