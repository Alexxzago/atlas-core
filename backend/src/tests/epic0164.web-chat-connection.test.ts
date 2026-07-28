import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createDatabase } from "../config/database.js";
import { assistantProfileId, reconstructAssistantProfile, type AssistantProfile } from "../assistant/domain/assistantProfile.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WebChatConnectionRepository } from "../repositories/webChatConnectionRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { WebChatConnectionNotFoundError, WebChatConnectionProfileNotExecutableError, WebChatConnectionService } from "../webChat/services/webChatConnectionService.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";

class Clock { private offset = 0; public now(): string { return new Date(Date.UTC(2026, 6, 24, 12, 0, this.offset++)).toISOString(); } }
function profile(companyId: number, status: AssistantProfile["status"] = "ready"): AssistantProfile { return reconstructAssistantProfile({ id: assistantProfileId("asp_0123456789abcdef0123456789abcdef"), companyId, name: "Web", normalizedName: "web", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status, createdAt: "2026-07-24T12:00:00.000Z", updatedAt: "2026-07-24T12:00:00.000Z", archivedAt: null }); }

function setup() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), primary = createWorkspaceContext(workspaces.resolveDefault()), secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "other", name: "Other" }));
  const companies = new CompanyRepository(database), first = companies.create(primary, { name: "First", website: "https://first.test" }), second = companies.create(primary, { name: "Second", website: "https://second.test" }), foreign = companies.create(secondary, { name: "Foreign", website: "https://foreign.test" });
  const profiles = new AssistantProfileRepository(database), firstProfile = profile(first.id), secondProfile = { ...profile(second.id), id: assistantProfileId("asp_1123456789abcdef0123456789abcdef"), name: "Second", normalizedName: "second" } as AssistantProfile, foreignProfile = { ...profile(foreign.id), id: assistantProfileId("asp_2123456789abcdef0123456789abcdef"), name: "Foreign", normalizedName: "foreign" } as AssistantProfile;
  profiles.create(primary, first.id, firstProfile); profiles.create(primary, second.id, secondProfile); profiles.create(secondary, foreign.id, foreignProfile);
  const repository = new WebChatConnectionRepository(database), service = new WebChatConnectionService(companies, profiles, repository, new Clock());
  return { database, primary, secondary, first, second, foreign, firstProfile, secondProfile, foreignProfile, repository, service };
}

test("EPIC-016.4 creates multiple opaque Company-bound Web Chat Connections and resolves active public IDs", () => {
  const { database, primary, first, firstProfile, repository, service } = setup();
  try {
    const firstConnection = service.create(primary, first.id, { assistantProfileId: firstProfile.id });
    const secondConnection = service.create(primary, first.id, { assistantProfileId: firstProfile.id });
    assert.match(firstConnection.id, /^wcc_[0-9a-f]{32}$/); assert.match(firstConnection.publicId, /^wcp_[0-9a-f]{32}$/);
    assert.equal(firstConnection.publicId.includes(firstProfile.id), false); assert.notEqual(firstConnection.publicId, secondConnection.publicId);
    assert.deepEqual(service.list(primary, first.id).map(({ id }) => id), [secondConnection.id, firstConnection.id]);
    assert.equal(service.get(primary, first.id, firstConnection.id).assistantProfileId, firstProfile.id);
    assert.equal(service.resolveActiveByPublicId(firstConnection.publicId)?.id, firstConnection.id);
    assert.throws(() => database.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("wcc_ffffffffffffffffffffffffffffffff", firstConnection.publicId, primary.workspaceId, first.id, firstProfile.id, "active", firstConnection.createdAt, firstConnection.updatedAt));
  } finally { database.close(); }
});

test("EPIC-016.4 transitions status idempotently and prevents inactive public resolution", () => {
  const { database, primary, first, firstProfile, service } = setup();
  try {
    const connection = service.create(primary, first.id, { assistantProfileId: firstProfile.id });
    const inactive = service.setStatus(primary, first.id, connection.id, { status: "inactive" });
    assert.equal(inactive.status, "inactive"); assert.equal(service.resolveActiveByPublicId(connection.publicId), null);
    assert.equal(service.setStatus(primary, first.id, connection.id, { status: "inactive" }).id, connection.id);
    assert.equal(service.setStatus(primary, first.id, connection.id, { status: "active" }).status, "active");
  } finally { database.close(); }
});

test("EPIC-016.4 enforces Workspace, Company, Profile, and Connection ownership", () => {
  const { database, primary, secondary, first, second, foreign, firstProfile, secondProfile, foreignProfile, service } = setup();
  try {
    const connection = service.create(primary, first.id, { assistantProfileId: firstProfile.id });
    assert.throws(() => service.create(primary, first.id, { assistantProfileId: secondProfile.id }), WebChatConnectionNotFoundError);
    assert.throws(() => service.create(primary, first.id, { assistantProfileId: foreignProfile.id }), WebChatConnectionNotFoundError);
    assert.throws(() => service.create(primary, foreign.id, { assistantProfileId: foreignProfile.id }), WebChatConnectionNotFoundError);
    assert.throws(() => service.get(secondary, first.id, connection.id), WebChatConnectionNotFoundError);
    assert.throws(() => service.setStatus(primary, second.id, connection.id, { status: "inactive" }), WebChatConnectionNotFoundError);
    assert.throws(() => service.create(primary, 999, { assistantProfileId: firstProfile.id }), WebChatConnectionNotFoundError);
  } finally { database.close(); }
});

test("EPIC-016.4 administrative routes require existing authentication, authorization, and CSRF", async () => {
  const app = express(); app.use(express.json());
  const controller = () => (_req: express.Request, response: express.Response): void => { response.status(201).json({ ok: true }); };
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "valid" ? { userId: "usr_test" } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "valid" } as never,
    users: { findById: () => ({ id: "usr_test" }) } as never,
    authorization: { authorize: () => ({ userId: "usr_test", membershipId: "mem_test", role: "owner", capabilities: [] }) } as never,
    resolver: { resolve: () => ({ workspaceId: 1, workspaceKey: "default" }) } as never,
    controllers: { list: controller, create: controller, get: controller, update: controller, delete: controller, onboard: () => controller() },
    assistantControllers: { list: controller, create: controller, get: controller, update: controller, transition: controller, preview: controller },
    webChatConnectionControllers: { list: controller, create: controller, get: controller, update: controller },
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, path = `${origin}/workspaces/wsp_default/companies/1/web-chat-connections`;
  try {
    assert.equal((await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(path, { method: "POST", headers: { "content-type": "application/json", cookie: "atlas=valid", origin, "sec-fetch-site": "same-origin", "x-csrf-token": "valid" }, body: "{}" })).status, 201);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
