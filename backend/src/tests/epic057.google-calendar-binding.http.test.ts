import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Router } from "express";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { runMigrations } from "../config/migrations.js";
import { runAsyncMigrations } from "../config/asyncMigrations.js";
import { createLibsqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { GoogleCalendarBindingService, type GoogleCalendarBindingRefreshPort } from "../scheduling/services/googleCalendarBindingService.js";

const now = "2026-09-28T12:00:00.000Z";
const resource = "src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const connection = "inc_cccccccccccccccccccccccccccccccc";
class Refresh implements GoogleCalendarBindingRefreshPort {
  public async listCalendars(): Promise<Awaited<ReturnType<GoogleCalendarBindingRefreshPort["listCalendars"]>>> { return { kind: "success", subject: "subject-a", calendars: [{ id: "cal-a", displayName: "A", accessRole: "writer" }] }; }
}

test("EPIC057 binding HTTP protects mutations and persists a tenant-scoped bind through libSQL restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-google-binding-")), path = join(directory, "atlas.sqlite");
  let sync = new DatabaseSync(path), database: SqlDatabase | null = null, server: ReturnType<typeof createApp>["listen"] | null = null;
  try {
    sync.exec("PRAGMA foreign_keys=ON"); runMigrations(sync);
    const context = createWorkspaceContext(new WorkspaceRepository(sync).resolveDefault()), companies = new CompanyRepository(sync), company = companies.create(context, { name: "Binding HTTP", website: "https://binding-http.test" }), other = companies.create(context, { name: "Other", website: "https://binding-other.test" });
    sync.prepare("INSERT INTO scheduling_resources(id,workspace_id,company_id,location_id,name,normalized_name,timezone,capacity,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(resource, context.workspaceId, company.id, null, "Room", "room", "UTC", 1, 1, now, now);
    sync.prepare("INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',1,?,?)").run(connection, context.workspaceId, company.id, "google_calendar", "calendar", now, now);
    sync.prepare("INSERT INTO google_calendar_authorizations(integration_connection_id,workspace_id,company_id,google_subject,status,authorized_at,revoked_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?)").run(connection, context.workspaceId, company.id, "subject-a", "active", now, now);
    sync.prepare("INSERT INTO google_calendar_accesses(integration_connection_id,workspace_id,company_id,calendar_id,display_name,access_role,updated_at) VALUES(?,?,?,?,?,?,?)").run(connection, context.workspaceId, company.id, "cal-a", "A", "writer", now);
    sync.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(database);
    const binding = new GoogleCalendarBindingService(database, new Refresh(), { now: () => now }), router = createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: async (raw: string) => raw ? { userId: raw } : null, validateCsrf: async (raw: string, csrf: string) => raw === "manager" && csrf === "csrf" } as never, users: { findById: (id: string) => id === "manager" || id === "reader" ? { id, status: "active" } : null } as never, authorization: { authorize: (user: { id: string }, workspace: string, permission: string) => { if (workspace !== "wsp_default" || user.id === "reader" && permission !== "company:read") throw new Error("denied"); return { workspaceId: context.workspaceId, workspacePublicId: workspace, userId: user.id, membershipId: "mem", role: "owner", capabilities: new Set([permission]), permission }; } } as never, resolver: { resolve: async () => context } as never, controllers: {} as never, assistantControllers: {} as never, googleCalendarBindingService: binding }), empty = Router();
    server = createApp({ authorizedCompaniesRouter: router, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty }).listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, base = `${origin}/workspaces/wsp_default/companies/${company.id}/google-calendar`, headers = (actor: string, csrf = "csrf") => ({ "content-type": "application/json", cookie: `atlas=${actor}`, origin, "sec-fetch-site": "same-origin", "x-csrf-token": csrf });
    assert.equal((await fetch(`${base}/bindings/${resource}`, { headers: headers("reader") })).status, 404);
    assert.equal((await fetch(`${base}/bindings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceId: resource, calendarId: "cal-a" }) })).status, 404);
    assert.equal((await fetch(`${base}/bindings`, { method: "POST", headers: headers("reader"), body: JSON.stringify({ resourceId: resource, calendarId: "cal-a" }) })).status, 404);
    assert.equal((await fetch(`${base}/bindings`, { method: "POST", headers: headers("manager", "bad"), body: JSON.stringify({ resourceId: resource, calendarId: "cal-a" }) })).status, 404);
    assert.equal((await fetch(`${base}/bindings`, { method: "POST", headers: { ...headers("manager"), "sec-fetch-site": "cross-site" }, body: JSON.stringify({ resourceId: resource, calendarId: "cal-a" }) })).status, 404);
    assert.equal((await fetch(`${base}/bindings`, { method: "POST", headers: { ...headers("manager"), origin: "https://foreign.test" }, body: JSON.stringify({ resourceId: resource, calendarId: "cal-a" }) })).status, 404);
    assert.equal((await fetch(`${base}/bindings`, { method: "POST", headers: headers("manager"), body: JSON.stringify({ resourceId: resource, calendarId: "cal-a" }) })).status, 200);
    const replay = await fetch(`${base}/bindings`, { method: "POST", headers: headers("manager"), body: JSON.stringify({ resourceId: resource, calendarId: "cal-a", expectedVersion: 1 }) }); assert.equal((await replay.json() as { kind: string }).kind, "replayed");
    assert.equal((await fetch(`${origin}/workspaces/wsp_default/companies/${other.id}/google-calendar/bindings/${resource}`, { headers: headers("reader") })).status, 404);
    await database.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); assert.equal((await new GoogleCalendarBindingService(database, new Refresh(), { now: () => now }).status(context, company.id, resource))?.calendarId, "cal-a");
  } finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); if (sync.isOpen) sync.close(); if (database) await database.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});
