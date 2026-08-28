import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { createGetVoicePolicyController, createPutVoicePolicyController } from "../controllers/voicePolicyController.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WhatsAppVoiceRepository } from "../repositories/whatsappVoiceRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { VoicePolicyService } from "../whatsapp/services/voicePolicyService.js";

const at = "2026-08-28T12:00:00.000Z";

function addConnection(database: DatabaseSync, context: ReturnType<typeof createWorkspaceContext>, companyId: number, suffix: string): string {
  const profileId = `apr_8a_${suffix}`.padEnd(36, "a").slice(0, 36), connectionId = `wac_8a_${suffix}`.padEnd(36, "a").slice(0, 36);
  database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(profileId, companyId, `Voice ${suffix}`, `voice-${suffix}`, "professional", "es", "Fallback", "ready", at, at, null);
  database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, companyId, profileId, `phone-${suffix}`, `business-${suffix}`, "inactive", at, at);
  return connectionId;
}

function fixture() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), primary = createWorkspaceContext(workspaces.resolveDefault()), secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" }));
  const companies = new CompanyRepository(database), company = companies.create(primary, { name: "Voice policy", website: "https://voice-policy.test" }), other = companies.create(primary, { name: "Other", website: "https://other.test" }), foreign = companies.create(secondary, { name: "Foreign", website: "https://foreign.test" });
  const connectionId = addConnection(database, primary, company.id, "primary"), otherConnectionId = addConnection(database, primary, other.id, "other"), foreignConnectionId = addConnection(database, secondary, foreign.id, "foreign");
  const service = new VoicePolicyService(new WhatsAppVoiceRepository(database), { now: () => at });
  const authorizedCompaniesRouter = createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "missing" ? null : { userId: raw }, validateCsrf: (_raw: string, token: string) => token === "csrf" } as never,
    users: { findById: (id: string) => id === "deleted" ? null : { id, status: id === "inactive" ? "suspended" : "active" } } as never,
    authorization: { authorize: (user: { id: string; status: string }, workspace: string, permission: string) => {
      if (user.status !== "active" || user.id === "reader" && permission !== "company:read") throw new Error("denied");
      const context = workspace === "wsp_default" ? primary : workspace === "wsp_secondary" ? secondary : null;
      if (!context) throw new Error("denied");
      return { userId: user.id, membershipId: "membership", role: user.id === "reader" ? "viewer" : "operator", capabilities: new Set([permission]), workspaceId: context.workspaceId, workspacePublicId: workspace, permission };
    } } as never,
    resolver: { resolve: (decision: { workspaceId: number }) => decision.workspaceId === primary.workspaceId ? primary : secondary } as never,
    controllers: {} as never,
    assistantControllers: {} as never,
    voicePolicyControllers: { get: (context) => createGetVoicePolicyController(service, context), put: (context, actor) => createPutVoicePolicyController(service, context, actor) },
  });
  const empty = Router(), app = createApp({ authorizedCompaniesRouter, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty });
  return { database, app, primary, secondary, company, other, foreign, connectionId, otherConnectionId, foreignConnectionId };
}

async function running(value: ReturnType<typeof fixture>) {
  const server = value.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const path = (workspace = "wsp_default", companyId = value.company.id, connectionId = value.connectionId) => `${origin}/workspaces/${workspace}/companies/${companyId}/whatsapp-connections/${connectionId}/voice-policy`;
  const headers = (actor = "manage", overrides: Record<string, string> = {}) => ({ "content-type": "application/json", cookie: `atlas=${actor}`, origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf", ...overrides });
  return { origin, path, headers, close: async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); value.database.close(); } };
}

const body = (operationId: string, expectedVersion = 1, voiceAiEnabled = true, audioResponseMode: "text_only" | "voice_with_text_fallback" = "voice_with_text_fallback") => ({ operationId, expectedVersion, voiceAiEnabled, audioResponseMode });

test("EPIC044 PASS8A GET returns only the durable scoped Voice policy", async () => {
  const value = fixture(), http = await running(value);
  try {
    const initial = await fetch(http.path(), { headers: http.headers("reader") });
    assert.equal(initial.status, 200); assert.deepEqual(await initial.json(), { voiceAiEnabled: false, audioResponseMode: "text_only", version: 1 });
    assert.equal((await fetch(http.path("wsp_default", value.other.id, value.otherConnectionId), { headers: http.headers("reader") })).status, 200);
    for (const request of [
      fetch(http.path("wsp_default", value.other.id), { headers: http.headers("reader") }),
      fetch(http.path("wsp_secondary", value.company.id), { headers: http.headers("reader") }),
      fetch(http.path("wsp_default", value.company.id, value.foreignConnectionId), { headers: http.headers("reader") }),
      fetch(http.path()),
      fetch(http.path(), { headers: http.headers("missing") }),
      fetch(http.path(), { headers: http.headers("deleted") }),
    ]) assert.equal((await request).status, 404);
    assert.equal((await fetch(http.path(), { headers: http.headers("reader") })).headers.get("cache-control"), "no-store, private");
  } finally { await http.close(); }
});

test("EPIC044 PASS8A PUT applies, replays, records stale outcomes, and does not start Voice work", async () => {
  const value = fixture(), http = await running(value);
  const put = (payload: unknown, actor = "manage") => fetch(http.path(), { method: "PUT", headers: http.headers(actor), body: JSON.stringify(payload) });
  try {
    const applied = await put(body("apply-8a"));
    assert.equal(applied.status, 200); assert.deepEqual(await applied.json(), { voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", version: 2 });
    const replay = await put(body("apply-8a"));
    assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), { voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", version: 2 });
    assert.deepEqual(await (await fetch(http.path(), { headers: http.headers("reader") })).json(), { voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", version: 2 });
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM whatsapp_voice_policy_operations WHERE operation_id='apply-8a'").get() as { count: number }).count, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM audio_transcription_requests").get() as { count: number }).count, 0);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM voice_synthesis_requests").get() as { count: number }).count, 0);
    assert.equal((await put(body("stale-8a", 1))).status, 409);
    assert.equal((await put(body("stale-8a", 1))).status, 409);
    assert.equal((await put(body("apply-8a", 2, false, "text_only"))).status, 409);
    assert.deepEqual(await (await fetch(http.path(), { headers: http.headers("reader") })).json(), { voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", version: 2 });
  } finally { await http.close(); }
});

test("EPIC044 PASS8A validates PUT input, bounds JSON, and requires manage plus same-origin CSRF", async () => {
  const value = fixture(), http = await running(value);
  try {
    for (const invalid of [{}, { ...body("extra"), extra: true }, body("", 1), body("zero", 0), { ...body("bool"), voiceAiEnabled: "true" }, { ...body("mode"), audioResponseMode: "voice" }]) assert.equal((await fetch(http.path(), { method: "PUT", headers: http.headers(), body: JSON.stringify(invalid) })).status, 400);
    assert.equal((await fetch(http.path(), { method: "PUT", headers: http.headers(), body: "{" })).status, 400);
    assert.equal((await fetch(http.path(), { method: "PUT", headers: http.headers(undefined, { "content-type": "text/plain" }), body: JSON.stringify(body("media-type")) })).status, 400);
    const oversized = await fetch(http.path(), { method: "PUT", headers: http.headers(), body: JSON.stringify({ ...body("large"), padding: "x".repeat(100 * 1024) }) });
    assert.equal(oversized.status, 413); assert.deepEqual(await oversized.json(), { error: { code: "knowledge_input_too_large", message: "Knowledge input is too large." } });
    for (const [headers, operationId] of [[http.headers("reader"), "denied-reader"], [http.headers("manage", { "x-csrf-token": "bad" }), "denied-csrf"], [http.headers("manage", { origin: "https://foreign.test" }), "denied-origin"], [http.headers("manage", { "sec-fetch-site": "cross-site" }), "denied-site"], [{ "content-type": "application/json" }, "denied-session"]] as const) assert.equal((await fetch(http.path(), { method: "PUT", headers, body: JSON.stringify(body(operationId)) })).status, 404);
    assert.equal((await fetch(http.path("wsp_default", value.other.id, value.connectionId), { method: "PUT", headers: http.headers(), body: JSON.stringify(body("wrong-company")) })).status, 404);
  } finally { await http.close(); }
});

test("EPIC044 PASS8A two SQLite connections produce one applied policy CAS and one durable stale result", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-voice-policy-cas-")), path = join(directory, "atlas.sqlite");
  let first: DatabaseSync | null = null, second: DatabaseSync | null = null;
  try {
    first = new DatabaseSync(path); first.exec("PRAGMA foreign_keys=ON"); runMigrations(first);
    const context = createWorkspaceContext(new WorkspaceRepository(first).resolveDefault()), company = new CompanyRepository(first).create(context, { name: "CAS", website: "https://cas.test" }), connectionId = addConnection(first, context, company.id, "cas");
    second = new DatabaseSync(path); second.exec("PRAGMA foreign_keys=ON");
    const one = new WhatsAppVoiceRepository(first).applyPolicy(context, company.id, connectionId, { actorId: "one", operationId: "cas-one", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", occurredAt: at });
    const two = new WhatsAppVoiceRepository(second).applyPolicy(context, company.id, connectionId, { actorId: "two", operationId: "cas-two", expectedVersion: 1, voiceAiEnabled: false, audioResponseMode: "text_only", occurredAt: at });
    assert.deepEqual([one.kind, two.kind].sort(), ["applied", "stale_version"]);
    assert.deepEqual(new WhatsAppVoiceRepository(first).findPolicy(context, company.id, connectionId) && { version: new WhatsAppVoiceRepository(first).findPolicy(context, company.id, connectionId)!.version, voiceAiEnabled: new WhatsAppVoiceRepository(first).findPolicy(context, company.id, connectionId)!.voiceAiEnabled }, { version: 2, voiceAiEnabled: true });
  } finally { if (second?.isOpen) second.close(); if (first?.isOpen) first.close(); rmSync(directory, { recursive: true, force: true }); }
});
