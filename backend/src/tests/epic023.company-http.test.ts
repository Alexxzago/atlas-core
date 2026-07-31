import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { CompanyApplicationService } from "../company/application/companyApplicationService.js";
import { createCompanyCoreControllers } from "../controllers/companyCoreController.js";
import { createDatabase } from "../config/database.js";
import { CompanyDomainRepository } from "../repositories/companyDomainRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { createApp } from "../app.js";

function setup() {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace);
  let tick = 0, event = 0;
  const service = new CompanyApplicationService(new CompanyDomainRepository(db), { clock: { now: () => `2026-07-30T10:${String(tick++).padStart(2, "0")}:00.000Z` }, eventIds: { next: () => `event-${++event}` } });
  const authorizedCompaniesRouter = createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "read" || raw === "manage" ? { userId: raw } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "valid" } as never,
    users: { findById: (id: string) => id === "read" || id === "manage" ? { id } : null } as never,
    authorization: { authorize: (user: { id: string }, requestedWorkspace: string, permission: string) => { if (requestedWorkspace !== workspace.key) throw new Error("workspace not found"); if ((user.id === "read" && permission === "company:read") || user.id === "manage") return { userId: user.id, membershipId: "membership", role: "operator", capabilities: [] }; throw new Error("forbidden"); } } as never,
    resolver: { resolve: () => context } as never,
    controllers: {} as never,
    assistantControllers: {} as never,
    companyCoreControllers: createCompanyCoreControllers(service),
  });
  const app = createApp({ authorizedCompaniesRouter, chatRouter: express.Router(), companiesRouter: express.Router(), identityRouter: express.Router(), knowledgeRouter: express.Router(), publicWebChatRouter: express.Router(), scrapeRouter: express.Router(), workspacesRouter: express.Router() }, { trustedLocalMode: false });
  return { db, app, workspace };
}

async function server(app: express.Express): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  const value = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => value.once("listening", resolve));
  return { origin: `http://127.0.0.1:${(value.address() as AddressInfo).port}`, close: async () => new Promise<void>((resolve, reject) => value.close((error) => error ? reject(error) : resolve())) };
}

const configuration = { timezone: "Europe/London", locale: "en-GB", operatingLocale: { countryCode: "GB", currencyCode: "GBP", dateFormat: "DD/MM/YYYY", phoneFormat: "national" }, businessHours: { weekly: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } } };

test("Company Core HTTP API validates DTOs, maps application outcomes, and returns response DTOs", async () => {
  const value = setup(), http = await server(value.app), base = `${http.origin}/workspaces/${value.workspace.key}/companies`;
  const manageHeaders = { "content-type": "application/json", cookie: "atlas=manage", origin: http.origin, "sec-fetch-site": "same-origin", "x-csrf-token": "valid" };
  try {
    assert.equal((await fetch(`${base}?unexpected=value`, { headers: { cookie: "atlas=read" } })).status, 400);
    assert.equal((await fetch(base)).status, 404);
    assert.equal((await fetch(base, { method: "POST", headers: { "content-type": "application/json", cookie: "atlas=manage" }, body: "{}" })).status, 404);
    const malformed = await fetch(base, { method: "POST", headers: manageHeaders, body: "{" });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: { code: "validation_failed", message: "Request body must be valid JSON." } });
    const created = await fetch(base, { method: "POST", headers: manageHeaders, body: JSON.stringify({ identity: { name: "Atlas Realty", slug: "atlas-realty", website: "https://atlas.example" } }) });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { data: Record<string, unknown> };
    assert.equal(createdBody.data.workspaceId, undefined);
    assert.equal(createdBody.data.normalizedName, undefined);
    assert.equal(typeof createdBody.data.id, "number");
    assert.equal(createdBody.data.slug, "atlas-realty");
    const websiteLess = await fetch(base, { method: "POST", headers: manageHeaders, body: JSON.stringify({ identity: { name: "Offline Realty", slug: "offline-realty" } }) });
    assert.equal(websiteLess.status, 201);
    assert.equal((await websiteLess.json() as { data: { website: string | null } }).data.website, null);
    assert.equal((await fetch(`${base}/slug/atlas-realty`, { headers: { cookie: "atlas=read" } })).status, 200);
    const companyId = createdBody.data.id as number;
    assert.equal((await fetch(`${base}/${companyId}/identity`, { method: "PATCH", headers: manageHeaders, body: JSON.stringify({ expectedVersion: 1, identity: { name: "Atlas Updated", slug: "atlas-updated", website: "https://atlas.example" } }) })).status, 200);
    const invalid = await fetch(`${base}/${companyId}/branding`, { method: "PATCH", headers: manageHeaders, body: JSON.stringify({ expectedVersion: 2, branding: { unsupported: true } }) });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { error: { code: string } }).error.code, "validation_failed");
    assert.equal((await fetch(`${base}/${companyId}/branding`, { method: "PATCH", headers: manageHeaders, body: JSON.stringify({ expectedVersion: 1, branding: { publicName: "Atlas" } }) })).status, 409);
    assert.equal((await fetch(`${base}/${companyId}/configuration`, { method: "PATCH", headers: manageHeaders, body: JSON.stringify({ expectedVersion: 2, configuration }) })).status, 200);
    const evaluated = await fetch(`${base}/${companyId}/readiness/evaluate`, { method: "POST", headers: manageHeaders, body: JSON.stringify({}) });
    assert.equal(evaluated.status, 200);
    assert.equal((await evaluated.json() as { data: { outcome: string } }).data.outcome, "indeterminate");
    assert.equal((await fetch(`${base}/${companyId}/readiness/apply`, { method: "POST", headers: manageHeaders, body: JSON.stringify({ expectedVersion: 3, assessment: { outcome: "eligible" } }) })).status, 400);
    assert.equal((await fetch(`${base}/${companyId}/readiness/apply`, { method: "POST", headers: manageHeaders, body: JSON.stringify({ expectedVersion: 3 }) })).status, 200);
    assert.equal((await fetch(`${base}/${companyId}`, { method: "PATCH", headers: manageHeaders, body: JSON.stringify({}) })).status, 404);
  } finally { await http.close(); value.db.close(); }
});

test("Company Core HTTP API enforces authorization and workspace-scoped non-disclosure", async () => {
  const value = setup(), http = await server(value.app), base = `${http.origin}/workspaces/${value.workspace.key}/companies`, headers = { "content-type": "application/json", cookie: "atlas=manage", origin: http.origin, "sec-fetch-site": "same-origin", "x-csrf-token": "valid" };
  try {
    const created = await fetch(base, { method: "POST", headers, body: JSON.stringify({ identity: { name: "Private Company", slug: "private-company", website: "https://private.example" } }) });
    assert.equal(created.status, 201);
    const companyId = (await created.json() as { data: { id: number } }).data.id;
    assert.equal((await fetch(`${http.origin}/workspaces/other/companies/${companyId}`, { headers: { cookie: "atlas=read" } })).status, 404);
    assert.equal((await fetch(`${base}/${companyId}/suspend`, { method: "POST", headers: { ...headers, cookie: "atlas=read" }, body: JSON.stringify({ expectedVersion: 1 }) })).status, 404);
    assert.equal((await fetch(`${base}/${companyId}/suspend`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1 }) })).status, 200);
  } finally { await http.close(); value.db.close(); }
});
