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
import { AesGcmIntegrationSecretCipher } from "../integrations/infrastructure/aesGcmIntegrationSecretCipher.js";
import { GoogleCalendarOAuthService, type GoogleCalendarAuthorizationProvider } from "../integrations/application/googleCalendarOAuth.js";
import { IntegrationConnectionService } from "../integrations/services/integrationConnectionService.js";
import { IntegrationConnectionRepository } from "../repositories/integrationConnectionRepository.js";
import { GoogleCalendarOAuthRepository } from "../repositories/googleCalendarOAuthRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { createGoogleCalendarOAuthCallbackRouter } from "../routes/googleCalendarOAuthCallback.js";
import { setOperationalLogSinkForTests } from "../observability/operationalLogger.js";
import type { UserId } from "../identity/domain/user.js";

class Clock { public value = "2026-09-28T12:00:00.000Z"; public now(): string { return this.value; } }
class Provider implements GoogleCalendarAuthorizationProvider {
  public exchanges = 0; public exchange: "success" | "unavailable" | "unauthorized" = "success"; public listed: "success" | "revoked" | "unavailable" = "success";
  public async exchangeAuthorizationCode(): Promise<Awaited<ReturnType<GoogleCalendarAuthorizationProvider["exchangeAuthorizationCode"]>>> { this.exchanges += 1; return this.exchange === "success" ? { kind: "success", subject: "google-subject-opaque", refreshToken: "refresh-token-secret" } : { kind: this.exchange }; }
  public async listCalendars(): Promise<Awaited<ReturnType<GoogleCalendarAuthorizationProvider["listCalendars"]>>> { return this.listed === "success" ? { kind: "success", subject: "google-subject-opaque", calendars: [{ id: "calendar-write", displayName: "Writable", accessRole: "writer" }, { id: "calendar-read", displayName: "Read", accessRole: "reader" }] } : { kind: this.listed }; }
}

test("EPIC057 OAuth callback uses the original session, consumes state once, and persists an active encrypted connection through libSQL restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-google-oauth-")), path = join(directory, "atlas.sqlite"), userId = "usr_google_oauth" as UserId, clock = new Clock(), provider = new Provider();
  let sync = new DatabaseSync(path), database: SqlDatabase | null = null, server: ReturnType<typeof createApp>["listen"] | null = null;
  try {
    sync.exec("PRAGMA foreign_keys=ON"); runMigrations(sync);
    const context = createWorkspaceContext(new WorkspaceRepository(sync).resolveDefault()), company = new CompanyRepository(sync).create(context, { name: "OAuth", website: "https://oauth.test" });
    sync.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES(?,?,?,?,?)").run(userId, "active", "en", clock.now(), clock.now());
    sync.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); await runAsyncMigrations(database);
    const cipher = new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 7)), integrations = new IntegrationConnectionService(new IntegrationConnectionRepository(database), cipher, { validate: async () => ({ status: "valid" as const }) }, clock), service = new GoogleCalendarOAuthService(new GoogleCalendarOAuthRepository(database), provider, cipher, integrations, { clientId: "client-id", redirectUri: "https://api.atlas.test/oauth/google-calendar/callback" }, clock);
    const start = await service.start(context, userId, company.id), state = new URL(start.authorizationUrl).searchParams.get("state")!;
    const logs: Record<string, unknown>[] = [], restore = setOperationalLogSinkForTests(line => logs.push(JSON.parse(line) as Record<string, unknown>));
    const callback = createGoogleCalendarOAuthCallbackRouter({ cookieName: () => "atlas", current: async raw => raw === "session-a" ? { userId } : null } as never, service, "https://portal.atlas.test");
    const empty = Router(); server = createApp({ authorizedCompaniesRouter: empty, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty, googleCalendarOAuthCallbackRouter: callback }).listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, callbackUrl = `${origin}/oauth/google-calendar/callback?code=authorization-code-secret&state=${encodeURIComponent(state)}`;
    const [first, concurrent] = await Promise.all([fetch(callbackUrl, { headers: { cookie: "atlas=session-a" }, redirect: "manual" }), fetch(callbackUrl, { headers: { cookie: "atlas=session-a" }, redirect: "manual" })]);
    for (const response of [first, concurrent]) { assert.equal(response.status, 303); assert.equal(response.headers.get("location"), `https://portal.atlas.test/companies/${company.id}/assistant`); assert.equal(response.headers.get("cache-control"), "no-store, private"); assert.equal(await response.text(), "See Other. Redirecting to https://portal.atlas.test/companies/1/assistant"); }
    assert.equal(provider.exchanges, 1); const secret = (await database.query<{ encrypted_secret: string }>("SELECT encrypted_secret FROM integration_connection_secrets", []))[0]?.encrypted_secret; assert.ok(secret); assert.doesNotMatch(secret!, /refresh-token-secret|google-subject-opaque/); assert.equal(cipher.decrypt(secret!), "refresh-token-secret"); assert.deepEqual((await database.query<{ status: string; validation_state: string }>("SELECT c.status,s.validation_state FROM integration_connections c JOIN integration_connection_operational_states s ON s.integration_connection_id=c.id", []))[0], { status: "active", validation_state: "valid" }); assert.deepEqual((await database.query<{ google_subject: string; access_role: string }>("SELECT a.google_subject,x.access_role FROM google_calendar_authorizations a JOIN google_calendar_accesses x ON x.integration_connection_id=a.integration_connection_id WHERE x.calendar_id='calendar-write'", []))[0], { google_subject: "google-subject-opaque", access_role: "writer" });
    assert.doesNotMatch(JSON.stringify(logs), /authorization-code-secret|refresh-token-secret|google-subject-opaque|code_verifier|state=/); restore();
    await database.close(); database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); assert.equal((await new GoogleCalendarOAuthRepository(database).authorization(context, company.id))?.status, "active");
    const absent = await fetch(`${origin}/oauth/google-calendar/callback?code=authorization-code-secret&state=${encodeURIComponent(state)}`, { redirect: "manual" }), wrong = await fetch(`${origin}/oauth/google-calendar/callback?code=authorization-code-secret&state=${encodeURIComponent(state)}`, { headers: { cookie: "atlas=other" }, redirect: "manual" }); assert.equal(absent.headers.get("location"), "https://portal.atlas.test/companies"); assert.equal(wrong.headers.get("location"), "https://portal.atlas.test/companies");
  } finally { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } if (sync.isOpen) sync.close(); if (database) { await database.close(); await new Promise<void>(resolve => setImmediate(resolve)); } try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});

test("EPIC057 OAuth callback fails closed for missing, changed, expired, and provider-failed authorization input", async () => {
  const records = new Map<string, import("../integrations/application/googleCalendarOAuth.js").GoogleCalendarOAuthAttempt>(); const clock = new Clock(), provider = new Provider(), cipher = new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 9)), user = "usr_original" as UserId, context = { workspaceId: 1, workspaceKey: "one" }, repository = { createAttempt: async (_: unknown, value: import("../integrations/application/googleCalendarOAuth.js").GoogleCalendarOAuthAttempt) => (records.set(value.id, value), true), findAttempt: async () => null, findAttemptForCallback: async (id: string) => records.get(id) ?? null, consumeAttempt: async (_: unknown, _company: number, _user: UserId, id: string) => { const value = records.get(id); if (!value || value.status !== "started") return false; records.set(id, { ...value, status: "completed", consumedAt: clock.now() }); return true; }, saveAuthorization: async () => undefined, authorization: async () => null, revoke: async () => undefined, blockBindings: async () => undefined, hasCalendar: async () => false, createBinding: async () => false, removeBinding: async () => undefined } as never, connections = { createWithReservedId: async () => ({ connection: { id: "inc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }), validate: async () => ({ id: "inc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), activate: async () => ({ id: "inc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }) } as never, service = new GoogleCalendarOAuthService(repository, provider, cipher, connections, { clientId: "client", redirectUri: "https://api.atlas.test/oauth/google-calendar/callback" }, clock);
  const started = await service.start(context, user, 7), state = new URL(started.authorizationUrl).searchParams.get("state")!;
  assert.equal(await service.completeCallback(user, "", "code"), null); assert.equal((await service.completeCallback(user, `${state}changed`, "code"))?.kind, "invalid_state"); assert.equal(await service.completeCallback("usr_other" as UserId, state, "code"), null);
  clock.value = "2026-09-28T12:11:00.000Z"; assert.equal((await service.completeCallback(user, state, "code"))?.kind, "expired");
  const retry = await service.start(context, user, 7), retryState = new URL(retry.authorizationUrl).searchParams.get("state")!; provider.exchange = "unavailable"; assert.equal((await service.completeCallback(user, retryState, "code"))?.kind, "unavailable");
});
