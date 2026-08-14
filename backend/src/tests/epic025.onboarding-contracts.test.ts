import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createDatabase } from "../config/database.js";
import { reconstructUser } from "../identity/domain/user.js";
import { UserRepository } from "../repositories/userRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { SqliteWorkspaceAdministrationTransaction } from "../repositories/workspaceAdministrationTransaction.js";
import { WorkspaceAdministrationService } from "../workspace/services/workspaceAdministrationService.js";
import { createWorkspaceAdministrationControllers } from "../controllers/workspaceAdministrationController.js";
import { createWorkspacesRouter } from "../routes/workspaces.js";
import { CompanyDomainRepository } from "../repositories/companyDomainRepository.js";
import { CompanyApplicationService } from "../company/application/companyApplicationService.js";
import { createCompanyCoreControllers } from "../controllers/companyCoreController.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { CommercialControlsRepository } from "../repositories/commercialControlsRepository.js";

const now = "2026-07-30T10:00:00.000Z";

async function server(app: express.Express): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  const value = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => value.once("listening", resolve));
  return { origin: `http://127.0.0.1:${(value.address() as AddressInfo).port}`, close: async () => new Promise<void>((resolve, reject) => value.close((error) => error ? reject(error) : resolve())) };
}

test("workspace creation persists optional onboarding settings and returns them safely", async () => {
  const db = createDatabase(":memory:");
  const user = reconstructUser({ id: "user" as never, status: "active", locale: "en", authenticationIdentities: [{ id: "identity", email: "owner@example.test", normalizedEmail: "owner@example.test", emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now });
  new UserRepository(db).create(user);
  const authentication = { cookieName: () => "atlas", current: (raw: string) => raw === "session" ? { userId: user.id } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "csrf" } as never;
  const service = new WorkspaceAdministrationService(new SqliteWorkspaceAdministrationTransaction(db), { create: () => ({ raw: "proof", digest: "digest", version: "sha256-v1" }), parse: () => null } as never, { now: () => now }, { deliver: async () => "accepted" } as never, "https://atlas.test");
  const app = express();
  app.use(express.json());
  app.use("/workspaces", createWorkspacesRouter(createWorkspaceAdministrationControllers(service, authentication, { allows: () => true } as never)));
  const http = await server(app);
  const headers = { "content-type": "application/json", cookie: "atlas=session", origin: http.origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf" };
  try {
    const response = await fetch(`${http.origin}/workspaces`, { method: "POST", headers, body: JSON.stringify({ name: "North America", timezone: "America/New_York", defaultLocale: "es" }) });
    assert.equal(response.status, 201);
    const body = await response.json() as { workspace: { id: string; name: string; timezone: string | null; defaultLocale: string | null }; membership: { id: string; role: string; status: string } };
    assert.equal(body.workspace.name, "North America");
    assert.equal(body.workspace.timezone, "America/New_York");
    assert.equal(body.workspace.defaultLocale, "es");
    assert.match(body.workspace.id, /^wsp_/);
    assert.match(body.membership.id, /^mem_/);
    assert.deepEqual({ role: body.membership.role, status: body.membership.status }, { role: "owner", status: "active" });
    const persisted = new WorkspaceRepository(db).findByPublicId(body.workspace.id);
    assert.ok(persisted);
    assert.equal(persisted.name, "North America");
    assert.equal(persisted.timezone, "America/New_York");
    assert.equal(persisted.defaultLocale, "es");
  } finally { await http.close(); db.close(); }
});

test("Company onboarding derives collision-resolved slugs and rejects client-owned fields", async () => {
  const db = createDatabase(":memory:");
  const workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace);
  let tick = 0;
  const service = new CompanyApplicationService(new CompanyDomainRepository(db), { clock: { now: () => `2026-07-30T10:00:${String(tick++).padStart(2, "0")}.000Z` } });
  const app = express();
  app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "manage" ? { userId: "manage" } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "valid" } as never,
    users: { findById: (id: string) => id === "manage" ? { id } : null } as never,
    authorization: { authorize: () => ({ userId: "manage", membershipId: "membership", role: "operator", capabilities: [] }) } as never,
    resolver: { resolve: () => context } as never, controllers: {} as never, assistantControllers: {} as never, companyCoreControllers: createCompanyCoreControllers(service),
  }));
  const http = await server(app), base = `${http.origin}/workspaces/${workspace.key}/companies/onboarding`;
  const headers = { "content-type": "application/json", cookie: "atlas=manage", origin: http.origin, "sec-fetch-site": "same-origin", "x-csrf-token": "valid" };
  try {
    const first = await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "Cafe de l'Atlas", logoAssetReference: "asset_logo_1" }) });
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { data: { slug: string; website: string | null; lifecycle: string; branding: { logoAssetReference: string | null } } };
    assert.equal(firstBody.data.slug, "cafe-de-l-atlas");
    assert.equal(firstBody.data.website, null);
    assert.equal(firstBody.data.lifecycle, "draft");
    assert.equal(firstBody.data.branding.logoAssetReference, "asset_logo_1");
    const second = await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "Cafe-de-l-Atlas", website: "https://atlas.example" }) });
    assert.equal(second.status, 201);
    assert.equal((await second.json() as { data: { slug: string } }).data.slug, "cafe-de-l-atlas-2");
    assert.equal((await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "Rejected", id: 7, slug: "client-slug", lifecycle: "operational" }) })).status, 400);
  } finally { await http.close(); db.close(); }
});

test("Company onboarding enforces commercial company limits while Company Core remains strict", async () => {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace), controls = new CommercialControlsRepository(db);
  db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('manage','active','en',?,?)").run(now, now);
  const service = new CompanyApplicationService(new CompanyDomainRepository(db), { clock: { now: () => now } });
  const app = express(); app.use(express.json()); app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "manage" ? { userId: "manage" } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "valid" } as never, users: { findById: (id: string) => id === "manage" ? { id } : null } as never, authorization: { authorize: () => ({ userId: "manage", membershipId: "membership", role: "operator", capabilities: [] }) } as never, resolver: { resolve: () => context } as never, controllers: {} as never, assistantControllers: {} as never, companyCoreControllers: createCompanyCoreControllers(service) }));
  const http = await server(app), base = `${http.origin}/workspaces/${workspace.key}/companies`, headers = { "content-type": "application/json", cookie: "atlas=manage", origin: http.origin, "sec-fetch-site": "same-origin", "x-csrf-token": "valid" };
  try {
    assert.equal((await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "Wrong contract", website: null }) })).status, 400);
    assert.equal((await fetch(`${base}/onboarding`, { method: "POST", headers, body: JSON.stringify({ name: "First", website: null }) })).status, 201);
    const current = controls.workspace(workspace.id)!;
    assert.ok(controls.updateWorkspaceLimits("manage", workspace.id, { maxCompanies: 1, maxAssistantProfiles: null, maxActiveChannels: null }, current.version, now));
    const denied = await fetch(`${base}/onboarding`, { method: "POST", headers, body: JSON.stringify({ name: "Second", website: "https://example.test" }) });
    assert.equal(denied.status, 409); assert.equal((await denied.json() as { error: { code: string } }).error.code, "commercial_limit_reached");
    const afterDenied = service.listCompanies(context); assert.equal(afterDenied.status, "success"); if (afterDenied.status === "success") assert.equal(afterDenied.companies.length, 1);
    const raised = controls.workspace(workspace.id)!;
    assert.ok(controls.updateWorkspaceLimits("manage", workspace.id, { maxCompanies: 2, maxAssistantProfiles: null, maxActiveChannels: null }, raised.version, now));
    assert.equal((await fetch(`${base}/onboarding`, { method: "POST", headers, body: JSON.stringify({ name: "Second", website: "https://example.test" }) })).status, 201);
    const afterRaised = service.listCompanies(context); assert.equal(afterRaised.status, "success"); if (afterRaised.status === "success") assert.equal(afterRaised.companies.length, 2);
  } finally { await http.close(); db.close(); }
});
