import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";
import { createDatabase } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { AgendaRepository } from "../repositories/agendaRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SchedulingRepository } from "../repositories/schedulingRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { AgendaService } from "../scheduling/services/agendaService.js";
import { SchedulingService } from "../scheduling/services/schedulingService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

class Clock { public now(): string { return "2026-08-18T12:00:00.000Z"; } }

test("EPIC057 Agenda HTTP enforces read/manage scope and CSRF without tenant disclosure", async () => {
  const database = createDatabase(":memory:"), primary = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), companies = new CompanyRepository(database), company = companies.create(primary, { name: "Agenda HTTP", website: "https://agenda-http.test" }), other = companies.create(primary, { name: "Other Agenda HTTP", website: "https://other-agenda-http.test" }), sql = new LocalSqlDatabase(database), clock = new Clock(), scheduling = new SchedulingService(new SchedulingRepository(sql), clock), resource = await scheduling.createResource(primary, company.id, { name: "Court", timezone: "UTC" }), service = await scheduling.createService(primary, company.id, { resourceId: resource.id, name: "Court hour", durationMinutes: 30 });
  await scheduling.addWorkingWindow(primary, company.id, { resourceId: resource.id, weekday: 2, startTime: "13:00", endTime: "14:00" });
  const slot = (await scheduling.listSlots(primary, company.id, service.id, { fromLocalDate: "2026-08-18", days: 1 }))[0]!;
  const agenda = new AgendaService(new AgendaRepository(sql), clock, scheduling), booking = await agenda.create(primary, company.id, { actorId: "operator", origin: "operator", idempotencyKey: "http-create", reason: null, serviceId: service.id, startAt: slot.startAt, reference: "HTTP-1", contact: null });
  const router = createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw ? { userId: raw } : null, validateCsrf: (_raw: string, token: string) => token === "csrf" } as never, users: { findById: (id: string) => ({ id, status: "active" }) } as never, authorization: { authorize: (user: { id: string }, workspace: string, permission: string) => { if (workspace !== "wsp_default" || user.id === "reader" && permission !== "company:read") throw new Error("denied"); return { userId: user.id, membershipId: "membership", role: user.id === "reader" ? "viewer" : "operator", capabilities: new Set([permission]), workspaceId: primary.workspaceId, workspacePublicId: workspace, permission }; } } as never, resolver: { resolve: () => primary } as never, controllers: {} as never, assistantControllers: {} as never, agendaService: agenda });
  const empty = Router(), app = createApp({ authorizedCompaniesRouter: router, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty }), server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, base = `${origin}/workspaces/wsp_default/companies/${company.id}/agenda/bookings`, headers = (actor: string, overrides: Record<string, string> = {}) => ({ "content-type": "application/json", cookie: `atlas=${actor}`, origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf", ...overrides });
  try {
    assert.equal((await fetch(`${base}/${booking.booking.id}`, { headers: headers("reader") })).status, 200);
    assert.equal((await fetch(base, { method: "POST", headers: headers("reader"), body: JSON.stringify({}) })).status, 404);
    assert.equal((await fetch(base, { method: "POST", headers: headers("operator"), body: JSON.stringify({ idempotencyKey: "invalid-consent", origin: "operator", serviceId: service.id, startAt: slot.startAt, reference: "INVALID-CONSENT", contact: { phone: "+15551234567", consent: { source: "operator", recordedAt: "not-an-instant" } } }) })).status, 400);
    assert.equal((await fetch(base, { method: "POST", headers: headers("operator", { "x-csrf-token": "wrong" }), body: JSON.stringify({}) })).status, 404);
    assert.equal((await fetch(base, { method: "POST", headers: headers("operator", { origin: "https://foreign.test" }), body: JSON.stringify({}) })).status, 404);
    assert.equal((await fetch(`${origin}/workspaces/wsp_default/companies/${other.id}/agenda/bookings/${booking.booking.id}`, { headers: headers("reader") })).status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); database.close(); }
});
