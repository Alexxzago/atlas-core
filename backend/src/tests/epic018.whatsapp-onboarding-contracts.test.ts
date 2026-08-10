import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { assistantProfileId, reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import { createConfigureWhatsAppCredentialsController, createActivateWhatsAppConnectionController, createValidateWhatsAppConnectionController } from "../controllers/WhatsAppConnectionController.js";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";
import { reconstructWhatsAppConnection } from "../whatsapp/domain/whatsappConnection.js";
import { WhatsAppConnectionOnboardingDomainError, reconstructEncryptedWhatsAppConnectionCredentials, reconstructWhatsAppConnectionOperationalState } from "../whatsapp/domain/whatsappConnectionOnboarding.js";
import { AesGcmWhatsAppCredentialCipher, WhatsAppCredentialCipherError } from "../whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";
import { WhatsAppCredentialResolver } from "../whatsapp/services/WhatsAppCredentialResolver.js";
import { WhatsAppConnectionService } from "../whatsapp/services/WhatsAppConnectionService.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

const connectionId = whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef");
const now = "2026-07-28T12:00:00.000Z";

test("EPIC-018 defines encrypted credential and redacted operational state contracts", () => {
  const credentials = reconstructEncryptedWhatsAppConnectionCredentials({ whatsAppConnectionId: connectionId, encryptedAccessToken: "ciphertext", createdAt: now, updatedAt: now });
  const state = reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: connectionId, validationState: "valid", validatedAt: now, validationFailureCode: null, healthState: "healthy", lastProviderActivityAt: now, lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: now });
  assert.equal(credentials.encryptedAccessToken, "ciphertext");
  assert.equal(state.validationState, "valid");
  assert.equal(state.healthState, "healthy");
  assert.ok(Object.isFrozen(credentials));
  assert.ok(Object.isFrozen(state));
});

test("EPIC-018 rejects operational states that could disclose or contradict validation facts", () => {
  assert.throws(() => reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: connectionId, validationState: "valid", validatedAt: null, validationFailureCode: null, healthState: "healthy", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: now }), WhatsAppConnectionOnboardingDomainError);
  assert.throws(() => reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: connectionId, validationState: "invalid", validatedAt: now, validationFailureCode: null, healthState: "degraded", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: "provider_unavailable", updatedAt: now }), WhatsAppConnectionOnboardingDomainError);
});

test("EPIC-018 migration is additive, restart safe, and seeds no credential material", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    runMigrations(database, 20);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_connection_credentials'").get(), undefined);
    runMigrations(database);
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_connection_credentials'").get());
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_connection_operational_states'").get());
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM whatsapp_connection_credentials").get() as { count: number }).count, 0);
    runMigrations(database);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=22").get() as { count: number }).count, 1);
  } finally { database.close(); }
});

test("migration 35 preserves operational states and accepts expanded validation failure codes", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;"); runMigrations(database, 34);
    const workspaces = new WorkspaceRepository(database), context = createWorkspaceContext(workspaces.resolveDefault()), companies = new CompanyRepository(database), company = companies.create(context, { name: "Migration", website: "https://migration.test" }), profiles = new AssistantProfileRepository(database), profile = reconstructAssistantProfile({ id: assistantProfileId("asp_11111111111111111111111111111111"), companyId: company.id, name: "Migration", normalizedName: "migration", description: null, businessRole: null, objective: null, audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: null, fallbackMessage: "Fallback", status: "ready", createdAt: now, updatedAt: now, archivedAt: null }), repository = new WhatsAppConnectionRepository(database), id = whatsAppConnectionId("wac_11111111111111111111111111111111");
    profiles.create(context, company.id, profile); repository.create(context, reconstructWhatsAppConnection({ id, workspaceId: context.workspaceId, companyId: company.id, assistantProfileId: profile.id, phoneNumberId: "phone-migration", whatsappBusinessAccountId: "waba-migration", status: "inactive", createdAt: now, updatedAt: now }));
    runMigrations(database); assert.equal(repository.findOperationalState(context, company.id, id)?.validationState, "not_validated");
    const saved = repository.replaceOperationalState(context, company.id, reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: id, validationState: "invalid", validatedAt: now, validationFailureCode: "provider_timeout", healthState: "degraded", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: "provider_timeout", updatedAt: now })); assert.equal(saved?.validationFailureCode, "provider_timeout"); assert.equal((database.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE id=35").get() as { count: number }).count, 1); runMigrations(database);
  } finally { database.close(); }
});

test("EPIC-018 persists ciphertext and redacted operational state only through the owning connection", () => {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), context = createWorkspaceContext(workspaces.resolveDefault()), companies = new CompanyRepository(database), company = companies.create(context, { name: "Company", website: "https://company.test", status: "ready" }), profiles = new AssistantProfileRepository(database), profile = reconstructAssistantProfile({ id: assistantProfileId("asp_0123456789abcdef0123456789abcdef"), companyId: company.id, name: "WhatsApp", normalizedName: "whatsapp", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: now, updatedAt: now, archivedAt: null }), repository = new WhatsAppConnectionRepository(database);
  try {
    profiles.create(context, company.id, profile);
    const connection = reconstructWhatsAppConnection({ id: connectionId, workspaceId: context.workspaceId, companyId: company.id, assistantProfileId: profile.id, phoneNumberId: "phone", whatsappBusinessAccountId: "waba", status: "inactive", createdAt: now, updatedAt: now });
    assert.ok(repository.create(context, connection));
    assert.deepEqual(repository.findOperationalState(context, company.id, connection.id), reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: connection.id, validationState: "not_validated", validatedAt: null, validationFailureCode: null, healthState: "inactive", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: now }));
    const saved = repository.replaceCredentials(context, company.id, reconstructEncryptedWhatsAppConnectionCredentials({ whatsAppConnectionId: connection.id, encryptedAccessToken: "v1.ciphertext", createdAt: now, updatedAt: "2026-07-28T12:01:00.000Z" }));
    assert.equal(saved?.encryptedAccessToken, "v1.ciphertext");
    const foreignContext = createWorkspaceContext(workspaces.createForSystemUse({ key: "foreign", name: "Foreign" }));
    assert.equal(repository.findCredentials(foreignContext, company.id, connection.id), null);
    const updated = repository.replaceOperationalState(context, company.id, reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: connection.id, validationState: "valid", validatedAt: "2026-07-28T12:01:00.000Z", validationFailureCode: null, healthState: "healthy", lastProviderActivityAt: "2026-07-28T12:01:00.000Z", lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: "2026-07-28T12:01:00.000Z" }));
    assert.equal(updated?.healthState, "healthy");
    assert.equal((database.prepare("SELECT encrypted_access_token FROM whatsapp_connection_credentials WHERE whatsapp_connection_id=?").get(connection.id) as { encrypted_access_token: string }).encrypted_access_token, "v1.ciphertext");
  } finally { database.close(); }
});

test("EPIC-018 credential cipher uses authenticated platform-key encryption", () => {
  const cipher = new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 7)), token = "company-access-token", encrypted = cipher.encrypt(token);
  assert.notEqual(encrypted, token);
  assert.equal(encrypted.includes(token), false);
  assert.equal(cipher.decrypt(encrypted), token);
  assert.throws(() => new AesGcmWhatsAppCredentialCipher(Buffer.alloc(31)), WhatsAppCredentialCipherError);
  assert.throws(() => new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 8)).decrypt(encrypted), WhatsAppCredentialCipherError);
});

test("EPIC-018 resolves Company credentials before global fallback and rejects unauthenticated ciphertext", () => {
  const cipher = new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 9));
  const stored = reconstructEncryptedWhatsAppConnectionCredentials({ whatsAppConnectionId: connectionId, encryptedAccessToken: cipher.encrypt("company-token"), createdAt: now, updatedAt: now });
  const context = createWorkspaceContext({ id: 1, publicId: "wsp_default", key: "default", name: "Default", timezone: null, defaultLocale: null, createdAt: now });
  const resolver = new WhatsAppCredentialResolver({ findCredentials: () => stored, replaceCredentials: () => stored }, cipher, "global-token");
  assert.equal(resolver.resolve(context, 1, connectionId), "company-token");
  const fallback = new WhatsAppCredentialResolver({ findCredentials: () => null, replaceCredentials: () => null }, cipher, " global-token ");
  assert.equal(fallback.resolve(context, 1, connectionId), "global-token");
  assert.equal(new WhatsAppCredentialResolver({ findCredentials: () => null, replaceCredentials: () => null }, cipher, " ").resolve(context, 1, connectionId), null);
  const [version, iv, tag, ciphertext] = stored.encryptedAccessToken.split("."), tampered = `${version}.${iv}.${tag!.startsWith("A") ? "B" : "A"}${tag!.slice(1)}.${ciphertext}`;
  assert.throws(() => new WhatsAppCredentialResolver({ findCredentials: () => ({ ...stored, encryptedAccessToken: tampered }), replaceCredentials: () => null }, cipher, "global-token").resolve(context, 1, connectionId), WhatsAppCredentialCipherError);
});

test("EPIC-018 selects the stored credential belonging to each Company connection", () => {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), context = createWorkspaceContext(workspaces.resolveDefault()), companies = new CompanyRepository(database), profiles = new AssistantProfileRepository(database), connections = new WhatsAppConnectionRepository(database), cipher = new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 10));
  try {
    const first = companies.create(context, { name: "First", website: "https://first.test", status: "ready" }), second = companies.create(context, { name: "Second", website: "https://second.test", status: "ready" });
    const firstProfile = reconstructAssistantProfile({ id: assistantProfileId("asp_3123456789abcdef0123456789abcdef"), companyId: first.id, name: "First", normalizedName: "first", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: now, updatedAt: now, archivedAt: null });
    const secondProfile = reconstructAssistantProfile({ ...firstProfile, id: assistantProfileId("asp_4123456789abcdef0123456789abcdef"), companyId: second.id, name: "Second", normalizedName: "second" });
    profiles.create(context, first.id, firstProfile); profiles.create(context, second.id, secondProfile);
    const firstConnection = reconstructWhatsAppConnection({ id: connectionId, workspaceId: context.workspaceId, companyId: first.id, assistantProfileId: firstProfile.id, phoneNumberId: "phone-first", whatsappBusinessAccountId: "waba-first", status: "inactive", createdAt: now, updatedAt: now });
    const secondConnection = reconstructWhatsAppConnection({ ...firstConnection, id: whatsAppConnectionId("wac_1123456789abcdef0123456789abcdef"), companyId: second.id, assistantProfileId: secondProfile.id, phoneNumberId: "phone-second", whatsappBusinessAccountId: "waba-second" });
    connections.create(context, firstConnection); connections.create(context, secondConnection);
    connections.replaceCredentials(context, first.id, reconstructEncryptedWhatsAppConnectionCredentials({ whatsAppConnectionId: firstConnection.id, encryptedAccessToken: cipher.encrypt("first-token"), createdAt: now, updatedAt: now }));
    connections.replaceCredentials(context, second.id, reconstructEncryptedWhatsAppConnectionCredentials({ whatsAppConnectionId: secondConnection.id, encryptedAccessToken: cipher.encrypt("second-token"), createdAt: now, updatedAt: now }));
    const resolver = new WhatsAppCredentialResolver(connections, cipher, "global-token");
    assert.equal(resolver.resolve(context, first.id, firstConnection.id), "first-token");
    assert.equal(resolver.resolve(context, second.id, secondConnection.id), "second-token");
  } finally { database.close(); }
});

test("EPIC-018 preserves EPIC-017 outbound delivery through the injected credential resolver and API factory", async () => {
  const connection = reconstructWhatsAppConnection({ id: connectionId, workspaceId: 1, companyId: 7, assistantProfileId: assistantProfileId("asp_5123456789abcdef0123456789abcdef"), phoneNumberId: "phone", whatsappBusinessAccountId: "waba", status: "active", createdAt: now, updatedAt: now });
  const factoryTokens: string[] = [], sent: unknown[] = [];
  const service = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, { resolveActiveByPhoneNumberId: () => connection } as never, { findBinding: () => null, createBinding: () => ({ conversationId: "conversation", customerParticipantId: "customer", assistantParticipantId: "assistant" }) } as never, { claim: () => ({ claimed: true, event: { id: "event" } }), updateState: () => true } as never, { open: () => ({ id: "conversation" }), addParticipant: (_context: unknown, _company: unknown, _conversation: unknown, input: { type: string }) => ({ id: input.type === "assistant" ? "assistant" : "customer" }) } as never, { execute: async () => ({ inbound: { id: "cmsg_0123456789abcdef0123456789abcdef" }, outbound: { id: "cmsg_1123456789abcdef0123456789abcdef", content: "Answer" } }) } as never, { now: () => now }, { create: (value: { id: string }) => value, attachExternalMessageId: () => true } as never, { create: () => ({ id: "delivery" }), updateState: () => true } as never, undefined, { resolve: () => "company-token" }, (token) => { factoryTokens.push(token); return { sendText: async (...args: unknown[]) => { sent.push(args); return "wamid-out"; } }; });
  await service.receive(Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages: [{ type: "text", from: "wa", id: "wamid-in", text: { body: "Hello" } }] } }] }] })));
  assert.deepEqual(factoryTokens, ["company-token"]);
  assert.deepEqual(sent, [["phone", "wa", "Answer"]]);
});

test("EPIC-018 authenticated lifecycle configures, validates, and activates only after the required gates", async () => {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), context = createWorkspaceContext(workspaces.resolveDefault()), companies = new CompanyRepository(database), profiles = new AssistantProfileRepository(database), connections = new WhatsAppConnectionRepository(database), cipher = new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 11));
  const company = companies.create(context, { name: "Company", website: "https://company.test", status: "ready" });
  const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_6123456789abcdef0123456789abcdef"), companyId: company.id, name: "WhatsApp", normalizedName: "whatsapp", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: now, updatedAt: now, archivedAt: null });
  profiles.create(context, company.id, profile);
  const resolver = new WhatsAppCredentialResolver(connections, cipher, "");
  const service = new WhatsAppConnectionService(companies, profiles, connections, { now: () => now }, { credentials: connections, states: connections, cipher, resolver, validator: { validateConnection: async ({ accessToken }) => { assert.equal(accessToken, "company-token"); return { status: "valid" }; } }, knowledge: { loadPublished: () => ({}) } as never });
  const connection = service.create(context, company.id, { assistantProfileId: profile.id, phoneNumberId: "phone", whatsappBusinessAccountId: "waba" });
  const app = express(); app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "manage" ? { userId: "manage" } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "valid" } as never, users: { findById: (id: string) => id === "manage" ? { id } : null } as never, authorization: { authorize: () => ({ userId: "manage", membershipId: "membership", role: "operator", capabilities: [] }) } as never, resolver: { resolve: () => context } as never, controllers: {} as never, assistantControllers: {} as never, whatsAppConnectionControllers: { list: () => (() => undefined) as never, create: () => (() => undefined) as never, get: () => (() => undefined) as never, update: () => (() => undefined) as never, configureCredentials: (value) => createConfigureWhatsAppCredentialsController(service, value), validate: (value) => createValidateWhatsAppConnectionController(service, value), activate: (value) => createActivateWhatsAppConnectionController(service, value) } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, path = `${origin}/workspaces/wsp_default/companies/${company.id}/whatsapp-connections/${connection.id}`, headers = { "content-type": "application/json", cookie: "atlas=manage", origin, "sec-fetch-site": "same-origin", "x-csrf-token": "valid" };
  try {
    assert.equal((await fetch(`${path}/activation`, { method: "POST", headers })).status, 409);
    assert.equal((await fetch(`${path}/credentials`, { method: "PUT", headers, body: JSON.stringify({ accessToken: "company-token" }) })).status, 200);
    assert.equal((await fetch(`${path}/activation`, { method: "POST", headers })).status, 409);
    const validated = await fetch(`${path}/validation`, { method: "POST", headers }); assert.equal(validated.status, 200); assert.equal((await validated.json()).validationState, "valid");
    const activated = await fetch(`${path}/activation`, { method: "POST", headers }); assert.equal(activated.status, 200); assert.equal((await activated.json()).connection.status, "active");
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); database.close(); }
});

test("EPIC-018 replacing credentials deactivates an active connection, requires revalidation, and returns no token", async () => {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), context = createWorkspaceContext(workspaces.resolveDefault()), companies = new CompanyRepository(database), profiles = new AssistantProfileRepository(database), connections = new WhatsAppConnectionRepository(database), cipher = new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 13));
  const company = companies.create(context, { name: "Company", website: "https://company.test", status: "ready" });
  const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_8123456789abcdef0123456789abcdef"), companyId: company.id, name: "WhatsApp", normalizedName: "whatsapp", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: now, updatedAt: now, archivedAt: null });
  profiles.create(context, company.id, profile);
  const resolver = new WhatsAppCredentialResolver(connections, cipher, "");
  const service = new WhatsAppConnectionService(companies, profiles, connections, { now: () => now }, { credentials: connections, states: connections, cipher, resolver, validator: { validateConnection: async () => ({ status: "valid" }) }, knowledge: { loadPublished: () => ({}) } as never });
  const connection = service.create(context, company.id, { assistantProfileId: profile.id, phoneNumberId: "phone", whatsappBusinessAccountId: "waba" });
  const app = express(); app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "manage" ? { userId: "manage" } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "valid" } as never, users: { findById: (id: string) => id === "manage" ? { id } : null } as never, authorization: { authorize: () => ({ userId: "manage", membershipId: "membership", role: "operator", capabilities: [] }) } as never, resolver: { resolve: () => context } as never, controllers: {} as never, assistantControllers: {} as never, whatsAppConnectionControllers: { list: () => (() => undefined) as never, create: () => (() => undefined) as never, get: () => (() => undefined) as never, update: () => (() => undefined) as never, configureCredentials: (value) => createConfigureWhatsAppCredentialsController(service, value), validate: (value) => createValidateWhatsAppConnectionController(service, value), activate: (value) => createActivateWhatsAppConnectionController(service, value) } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, path = `${origin}/workspaces/wsp_default/companies/${company.id}/whatsapp-connections/${connection.id}`, headers = { "content-type": "application/json", cookie: "atlas=manage", origin, "sec-fetch-site": "same-origin", "x-csrf-token": "valid" };
  try {
    await fetch(`${path}/credentials`, { method: "PUT", headers, body: JSON.stringify({ accessToken: "old-company-token" }) });
    await fetch(`${path}/validation`, { method: "POST", headers });
    assert.equal((await fetch(`${path}/activation`, { method: "POST", headers })).status, 200);
    const replacement = await fetch(`${path}/credentials`, { method: "PUT", headers, body: JSON.stringify({ accessToken: "new-company-token" }) });
    const body = await replacement.json() as Record<string, unknown>;
    assert.equal(replacement.status, 200);
    assert.equal((body.connection as { status: string }).status, "inactive");
    assert.equal(body.credentialsConfigured, true);
    assert.equal(body.validationState, "not_validated");
    assert.equal(body.healthState, "inactive");
    assert.equal("accessToken" in body, false);
    assert.equal(JSON.stringify(body).includes("old-company-token"), false);
    assert.equal(JSON.stringify(body).includes("new-company-token"), false);
    assert.equal(resolver.resolve(context, company.id, connection.id), "new-company-token");
    assert.equal((await fetch(`${path}/activation`, { method: "POST", headers })).status, 409);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); database.close(); }
});


test("WhatsApp configuration update preserves credentials and requires revalidation when provider identifiers change", () => {
  const database = createDatabase(":memory:");
  const workspaces = new WorkspaceRepository(database);
  const context = createWorkspaceContext(workspaces.resolveDefault());
  const companies = new CompanyRepository(database);
  const profiles = new AssistantProfileRepository(database);
  const connections = new WhatsAppConnectionRepository(database);
  const cipher = new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 12));

  try {
    const company = companies.create(context, {
      name: "Editable WhatsApp",
      website: "https://editable.test",
      status: "ready"
    });

    const profile = reconstructAssistantProfile({
      id: assistantProfileId("asp_7123456789abcdef0123456789abcdef"),
      companyId: company.id,
      name: "Editable",
      normalizedName: "editable",
      description: null,
      businessRole: "Advisor",
      objective: "Help",
      audience: null,
      tone: "friendly",
      assistantLanguage: "en",
      welcomeMessage: "Welcome",
      fallbackMessage: "Fallback",
      status: "ready",
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    });

    profiles.create(context, company.id, profile);

    const resolver = new WhatsAppCredentialResolver(connections, cipher, "");

    const service = new WhatsAppConnectionService(
      companies,
      profiles,
      connections,
      { now: () => "2026-07-28T13:00:00.000Z" },
      {
        credentials: connections,
        states: connections,
        cipher,
        resolver,
        validator: {
          validateConnection: async () => ({ status: "valid" })
        },
        knowledge: { loadPublished: () => ({}) } as never
      }
    );

    const created = service.create(context, company.id, {
      assistantProfileId: profile.id,
      phoneNumberId: "phone-old",
      whatsappBusinessAccountId: "waba-old"
    });

    service.configureCredentials(context, company.id, created.id, {
      accessToken: "persistent-token"
    });

    connections.replaceOperationalState(
      context,
      company.id,
      reconstructWhatsAppConnectionOperationalState({
        whatsAppConnectionId: created.id,
        validationState: "valid",
        validatedAt: "2026-07-28T12:30:00.000Z",
        validationFailureCode: null,
        healthState: "healthy",
        lastProviderActivityAt: "2026-07-28T12:30:00.000Z",
        lastWebhookActivityAt: null,
        healthFailureCode: null,
        updatedAt: "2026-07-28T12:30:00.000Z"
      })
    );

    const updated = service.update(context, company.id, created.id, {
      phoneNumberId: "phone-new",
      whatsappBusinessAccountId: "waba-new"
    });

    assert.equal(updated.phoneNumberId, "phone-new");
    assert.equal(updated.whatsappBusinessAccountId, "waba-new");
    assert.equal(updated.status, "inactive");

    const status = service.status(context, company.id, created.id);

    assert.equal(status.credentialsConfigured, true);
    assert.equal(status.validationState, "not_validated");
    assert.equal(status.validatedAt, null);
    assert.equal(status.healthState, "inactive");
    assert.equal(resolver.resolve(context, company.id, created.id), "persistent-token");
  } finally {
    database.close();
  }
});
