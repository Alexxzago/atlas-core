import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { assistantProfileId, reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import { reconstructUser, userId } from "../identity/domain/user.js";
import { AesGcmWhatsAppCredentialCipher } from "../whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";
import { WhatsAppCredentialResolver } from "../whatsapp/services/WhatsAppCredentialResolver.js";
import { WhatsAppConnectionService } from "../whatsapp/services/WhatsAppConnectionService.js";
import { MetaWhatsAppReadinessService } from "../whatsapp/application/metaWhatsAppReadinessService.js";
import { AesGcmIntegrationSecretCipher } from "../integrations/infrastructure/aesGcmIntegrationSecretCipher.js";
import { IntegrationConnectionService } from "../integrations/services/integrationConnectionService.js";
import { IntegrationConnectionRepository } from "../repositories/integrationConnectionRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { MetaEmbeddedSignupAttemptRepository } from "../repositories/metaEmbeddedSignupAttemptRepository.js";
import { UserRepository } from "../repositories/userRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import type { MetaWhatsAppVerifiedAsset } from "../whatsapp/application/metaEmbeddedSignup.js";
import { HmacMetaEmbeddedSignupDigestProvider, MetaEmbeddedSignupAttemptService } from "../whatsapp/application/metaEmbeddedSignupAttemptService.js";
import { SqlMetaEmbeddedSignupCompletionFinalizer } from "../whatsapp/application/metaEmbeddedSignupCompletionFinalizer.js";
import { MetaEmbeddedSignupCompletionService } from "../whatsapp/application/metaEmbeddedSignupCompletionService.js";
import { MetaWhatsAppIntegrationValidationProvider, metaWhatsAppIntegrationSecret } from "../whatsapp/application/metaEmbeddedSignupIntegration.js";
import type { MetaAssetVerificationOutcome, MetaCredentialOutcome, MetaEmbeddedSignupProvider } from "../whatsapp/providers/MetaEmbeddedSignupProvider.js";

const now = "2026-08-22T14:00:00.000Z", actor = userId("usr_epic042_orchestration");
const asset: MetaWhatsAppVerifiedAsset = Object.freeze({ whatsappBusinessAccountId: "123", phoneNumberId: "456", displayPhoneNumber: "+54 11 5555 0000" });

class ScriptedMetaProvider implements MetaEmbeddedSignupProvider {
  public exchanges = 0; public verifications = 0; public inspections = 0; public subscriptions = 0; public unsubscriptions = 0;
  public subscriptionOutcomes: Array<{ kind: "success"; subscribed: boolean } | { kind: "unauthorized" | "unavailable" | "timeout" }> = [{ kind: "success", subscribed: true }];
  public exchangeOutcomes: MetaCredentialOutcome[] = [{ kind: "success", credential: { accessToken: "transient-meta-token" } }];
  public verificationOutcomes: MetaAssetVerificationOutcome[] = [{ kind: "success", asset }, { kind: "success", asset }];
  public async exchangeAuthorizationCode(): Promise<MetaCredentialOutcome> { this.exchanges++; return this.exchangeOutcomes.shift() ?? { kind: "unavailable" }; }
  public async verifyAssets(): Promise<MetaAssetVerificationOutcome> { this.verifications++; return this.verificationOutcomes.shift() ?? { kind: "unavailable" }; }
  public async inspectWabaSubscription() { this.inspections++; return this.subscriptionOutcomes.shift() ?? { kind: "unavailable" as const }; }
  public async subscribeWaba() { this.subscriptions++; return { kind: "success" as const }; }
  public async unsubscribeWaba() { this.unsubscriptions++; return { kind: "success" as const }; }
}

interface OrchestrationFixture {
  readonly database: ReturnType<typeof createDatabase>; readonly context: ReturnType<typeof createWorkspaceContext>; readonly companyId: number; readonly profileId: string;
  readonly attempts: MetaEmbeddedSignupAttemptService; readonly integrations: IntegrationConnectionService; readonly provider: ScriptedMetaProvider; readonly completion: MetaEmbeddedSignupCompletionService;
}

function orchestrationFixture(path = ":memory:", provider = new ScriptedMetaProvider()): OrchestrationFixture {
  const database = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), clock = { now: () => now };
  new UserRepository(database).create(reconstructUser({ id: actor, status: "active", fullName: null, locale: "en", authenticationIdentities: [{ id: "aid_epic042_orchestration", email: "orchestration@example.test", normalizedEmail: "orchestration@example.test", emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  const company = new CompanyRepository(database).create(context, { name: "EPIC 042 Orchestration", website: "https://orchestration.test", status: "ready" });
  const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_22222222222222222222222222222222"), companyId: company.id, name: "Meta orchestration", normalizedName: "meta orchestration", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: now, updatedAt: now, archivedAt: null });
  new AssistantProfileRepository(database).create(context, company.id, profile);
  const attempts = new MetaEmbeddedSignupAttemptService(new MetaEmbeddedSignupAttemptRepository(new LocalSqlDatabase(database)), new HmacMetaEmbeddedSignupDigestProvider(Buffer.alloc(32, 42)), clock);
  const integrations = new IntegrationConnectionService(new IntegrationConnectionRepository(new LocalSqlDatabase(database)), new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 8)), new MetaWhatsAppIntegrationValidationProvider(provider), clock);
  const completion = new MetaEmbeddedSignupCompletionService(attempts, provider, integrations, new SqlMetaEmbeddedSignupCompletionFinalizer(new LocalSqlDatabase(database)), clock);
  return { database, context, companyId: company.id, profileId: profile.id, attempts, integrations, provider, completion };
}

async function launch(value: OrchestrationFixture, reconnect: string | null = null) { return value.attempts.start(value.context, actor, value.companyId, { assistantProfileId: value.profileId, targetWhatsAppConnectionId: reconnect }); }
function input(value: OrchestrationFixture, started: Awaited<ReturnType<typeof launch>>, overrides: Record<string, unknown> = {}) { return { workspaceId: value.context.workspaceId, companyId: value.companyId, actorId: actor, attemptId: started.attemptId, state: started.state, authorizationCode: "one-time-code", whatsappBusinessAccountIdHint: "123", phoneNumberIdHint: "456", ...overrides }; }
async function claimed(value: OrchestrationFixture, reserve = false) { const started = await launch(value), claim = await value.attempts.claimCompletion(value.context, actor, value.companyId, started.attemptId, started.state, "one-time-code"); if (claim.kind !== "claimed") throw new Error("expected claim"); if (!reserve) return { started, attempt: claim.authority.attempt }; const reserved = await value.attempts.reserveIntegrationConnection(value.context, actor, value.companyId, started.attemptId, claim.authority.attempt.version); if (reserved.kind !== "applied" || !reserved.attempt?.resolvedIntegrationConnectionId) throw new Error("expected reservation"); return { started, attempt: reserved.attempt }; }
function counts(value: OrchestrationFixture): Record<string, number> { return { attempts: (value.database.prepare("SELECT count(*) count FROM meta_embedded_signup_attempts").get() as { count: number }).count, integrations: (value.database.prepare("SELECT count(*) count FROM integration_connections").get() as { count: number }).count, secrets: (value.database.prepare("SELECT count(*) count FROM integration_connection_secrets").get() as { count: number }).count, wacs: (value.database.prepare("SELECT count(*) count FROM whatsapp_connections").get() as { count: number }).count, legacy: (value.database.prepare("SELECT count(*) count FROM whatsapp_connection_credentials").get() as { count: number }).count }; }
function insertReconnect(value: OrchestrationFixture, id: string, phone = "456"): void { value.database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'inactive',?,?)").run(id, value.context.workspaceId, value.companyId, value.profileId, phone, "123", now, now); }

test("EPIC-042 completion orchestration executes the full happy path and replays without repeating provider or durable writes", async () => {
  const value = orchestrationFixture(); try {
    const started = await launch(value), result = await value.completion.complete(input(value, started));
    assert.equal(result.kind, "completed"); if (result.kind !== "completed") throw new Error("expected completed");
    assert.deepEqual(result.verifiedAsset, asset); assert.doesNotMatch(JSON.stringify(result), /one-time-code|transient-meta-token|cipher/i);
    assert.deepEqual(counts(value), { attempts: 1, integrations: 1, secrets: 1, wacs: 1, legacy: 0 });
    assert.equal((value.database.prepare("SELECT status FROM meta_embedded_signup_attempts").get() as { status: string }).status, "completed");
    assert.deepEqual({ ...(value.database.prepare("SELECT status,integration_connection_id FROM whatsapp_connections").get() as Record<string, unknown>) }, { status: "inactive", integration_connection_id: (value.database.prepare("SELECT id FROM integration_connections").get() as { id: string }).id });
    const calls = { exchange: value.provider.exchanges, verify: value.provider.verifications }, replay = await value.completion.complete(input(value, started));
    assert.equal(replay.kind, "replayed"); assert.deepEqual({ exchange: value.provider.exchanges, verify: value.provider.verifications }, calls); assert.deepEqual(counts(value), { attempts: 1, integrations: 1, secrets: 1, wacs: 1, legacy: 0 });
    const invalid = await launch(value); assert.equal((await value.completion.complete(input(value, invalid, { authorizationCode: "" }))).kind, "validation_error");
    const persistedAttempt = JSON.stringify(value.database.prepare("SELECT * FROM meta_embedded_signup_attempts").get()); assert.doesNotMatch(persistedAttempt, /one-time-code|transient-meta-token/);
  } finally { value.database.close(); }
});

test("EPIC-042 browser hints are never authority and only exact server-verified assets become public Integration config", async () => {
  for (const mismatch of ["waba", "phone"] as const) {
    const provider = new ScriptedMetaProvider(); provider.verificationOutcomes = [{ kind: "success", asset: { ...asset, ...(mismatch === "waba" ? { whatsappBusinessAccountId: "999" } : { phoneNumberId: "999" }) } }];
    const value = orchestrationFixture(":memory:", provider); try { const started = await launch(value); assert.equal((await value.completion.complete(input(value, started))).kind, "validation_error"); assert.deepEqual(counts(value), { attempts: 1, integrations: 0, secrets: 0, wacs: 0, legacy: 0 }); } finally { value.database.close(); }
  }
  const value = orchestrationFixture(); try { const started = await launch(value); await value.completion.complete(input(value, started)); const config = JSON.parse((value.database.prepare("SELECT configuration_json FROM integration_connections").get() as { configuration_json: string }).configuration_json); assert.deepEqual(config, { wabaId: "123", phoneNumberId: "456", graphApiVersion: "v26.0", displayPhoneNumber: "+54 11 5555 0000" }); } finally { value.database.close(); }
});

test("EPIC-042 completing recovery reuses the exact reservation and reports consumed code honestly", async () => {
  const value = orchestrationFixture(); try {
    const prepared = await claimed(value, true), reservedId = prepared.attempt.resolvedIntegrationConnectionId;
    assert.equal((await value.completion.complete(input(value, prepared.started))).kind, "completed");
    assert.equal((value.database.prepare("SELECT id FROM integration_connections").get() as { id: string }).id, reservedId); assert.deepEqual(counts(value), { attempts: 1, integrations: 1, secrets: 1, wacs: 1, legacy: 0 });
  } finally { value.database.close(); }
  const provider = new ScriptedMetaProvider(); provider.exchangeOutcomes = [{ kind: "unauthorized" }];
  const consumed = orchestrationFixture(":memory:", provider); try { const prepared = await claimed(consumed, true); assert.equal((await consumed.completion.complete(input(consumed, prepared.started))).kind, "reconnect_required"); assert.deepEqual(counts(consumed), { attempts: 1, integrations: 0, secrets: 0, wacs: 0, legacy: 0 }); assert.equal((consumed.database.prepare("SELECT status FROM meta_embedded_signup_attempts").get() as { status: string }).status, "completing"); } finally { consumed.database.close(); }
});

test("EPIC-042 durable Integration authority resumes validation/finalization without another code exchange", async () => {
  for (const prevalidated of [false, true]) {
    const value = orchestrationFixture(); try {
      const prepared = await claimed(value, true), id = prepared.attempt.resolvedIntegrationConnectionId!;
      await value.integrations.createWithReservedId(value.context, value.companyId, id, { provider: "meta_whatsapp", kind: "cloud_api", configuration: { wabaId: "123", phoneNumberId: "456", graphApiVersion: "v26.0", displayPhoneNumber: "+54 11 5555 0000" }, plaintextSecret: metaWhatsAppIntegrationSecret("durable-token") });
      if (prevalidated) await value.integrations.validate(value.context, value.companyId, id);
      const exchanges = value.provider.exchanges, result = await value.completion.complete(input(value, prepared.started));
      assert.equal(result.kind, "completed"); assert.equal(value.provider.exchanges, exchanges); assert.deepEqual(counts(value), { attempts: 1, integrations: 1, secrets: 1, wacs: 1, legacy: 0 });
    } finally { value.database.close(); }
  }
});

test("EPIC-042 provider exchange and verification failures are safe, retryable, and never finalize", async () => {
  for (const failure of ["unauthorized", "forbidden", "rate_limited", "unavailable", "timeout", "invalid_response"] as const) {
    const provider = new ScriptedMetaProvider(); provider.exchangeOutcomes = [{ kind: failure }];
    const value = orchestrationFixture(":memory:", provider); try { const started = await launch(value), result = await value.completion.complete(input(value, started)); assert.equal(result.kind, failure); assert.deepEqual(counts(value), { attempts: 1, integrations: 0, secrets: 0, wacs: 0, legacy: 0 }); assert.doesNotMatch(JSON.stringify(result), /one-time-code|transient-meta-token/); } finally { value.database.close(); }
  }
});

test("EPIC-042 Integration validation failures never finalize and preserve durable recovery authority", async () => {
  for (const [failure, expected] of [["unauthorized", "reconnect_required"], ["timeout", "timeout"], ["unavailable", "unavailable"], ["invalid_response", "validation_error"]] as const) {
    const provider = new ScriptedMetaProvider(); provider.verificationOutcomes = [{ kind: "success", asset }, { kind: failure }];
    const value = orchestrationFixture(":memory:", provider); try { const started = await launch(value), result = await value.completion.complete(input(value, started)); assert.equal(result.kind, expected); assert.deepEqual(counts(value), { attempts: 1, integrations: 1, secrets: 1, wacs: 0, legacy: 0 }); assert.equal((value.database.prepare("SELECT status FROM meta_embedded_signup_attempts").get() as { status: string }).status, "completing"); } finally { value.database.close(); }
  }
});

test("EPIC-042 reconnect orchestration preserves same-phone identity and refuses changed-phone routing", async () => {
  const same = orchestrationFixture(); try { const id = "wac_33333333333333333333333333333333"; insertReconnect(same, id); const started = await launch(same, id), result = await same.completion.complete(input(same, started)); assert.equal(result.kind, "completed"); if (result.kind === "completed") assert.equal(result.whatsAppConnectionId, id); assert.equal((same.database.prepare("SELECT count(*) count FROM whatsapp_connections").get() as { count: number }).count, 1); } finally { same.database.close(); }
  const changed = orchestrationFixture(); try { const id = "wac_44444444444444444444444444444444"; insertReconnect(changed, id, "789"); const started = await launch(changed, id), before = { ...(changed.database.prepare("SELECT * FROM whatsapp_connections WHERE id=?").get(id) as Record<string, unknown>) }, result = await changed.completion.complete(input(changed, started)); assert.equal(result.kind, "asset_change_required"); assert.deepEqual({ ...(changed.database.prepare("SELECT * FROM whatsapp_connections WHERE id=?").get(id) as Record<string, unknown>) }, before); assert.equal((changed.database.prepare("SELECT status FROM meta_embedded_signup_attempts").get() as { status: string }).status, "completing"); } finally { changed.database.close(); }
});

test("EPIC-042 orchestration survives restart after durable Integration persistence and after finalizer commit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic042-orchestration-")), path = join(directory, "atlas.sqlite"), provider = new ScriptedMetaProvider(); let value = orchestrationFixture(path, provider);
  try {
    const prepared = await claimed(value, true), id = prepared.attempt.resolvedIntegrationConnectionId!;
    await value.integrations.createWithReservedId(value.context, value.companyId, id, { provider: "meta_whatsapp", kind: "cloud_api", configuration: { wabaId: "123", phoneNumberId: "456", graphApiVersion: "v26.0", displayPhoneNumber: "+54 11 5555 0000" }, plaintextSecret: metaWhatsAppIntegrationSecret("restart-token") });
    value.database.close(); value = orchestrationFixtureRestart(path, provider, value.companyId, value.profileId);
    assert.equal((await value.completion.complete(input(value, prepared.started))).kind, "completed"); const calls = provider.exchanges; value.database.close();
    value = orchestrationFixtureRestart(path, provider, value.companyId, value.profileId); assert.equal((await value.completion.complete(input(value, prepared.started))).kind, "replayed"); assert.equal(provider.exchanges, calls); assert.deepEqual(counts(value), { attempts: 1, integrations: 1, secrets: 1, wacs: 1, legacy: 0 }); value.database.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function orchestrationFixtureRestart(path: string, provider: ScriptedMetaProvider, companyId: number, profileId: string): OrchestrationFixture {
  const database = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), clock = { now: () => now }, attempts = new MetaEmbeddedSignupAttemptService(new MetaEmbeddedSignupAttemptRepository(new LocalSqlDatabase(database)), new HmacMetaEmbeddedSignupDigestProvider(Buffer.alloc(32, 42)), clock), integrations = new IntegrationConnectionService(new IntegrationConnectionRepository(new LocalSqlDatabase(database)), new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 8)), new MetaWhatsAppIntegrationValidationProvider(provider), clock), completion = new MetaEmbeddedSignupCompletionService(attempts, provider, integrations, new SqlMetaEmbeddedSignupCompletionFinalizer(new LocalSqlDatabase(database)), clock);
  return { database, context, companyId, profileId, attempts, integrations, provider, completion };
}


function readiness(value: OrchestrationFixture): { readonly service: MetaWhatsAppReadinessService; readonly whatsApp: WhatsAppConnectionService; readonly resolver: WhatsAppCredentialResolver } {
  const repository = new WhatsAppConnectionRepository(value.database), legacyCipher = new AesGcmWhatsAppCredentialCipher(Buffer.alloc(32, 7)), integrationCipher = new AesGcmIntegrationSecretCipher(Buffer.alloc(32, 8)), resolver = new WhatsAppCredentialResolver(repository, legacyCipher, "global-token", { repository, cipher: integrationCipher });
  const whatsApp = new WhatsAppConnectionService(new CompanyRepository(value.database), new AssistantProfileRepository(value.database), repository, { now: () => now }, { credentials: repository, states: repository, cipher: legacyCipher, resolver, validator: { validateConnection: async () => ({ status: "valid" as const }) }, knowledge: { loadPublished: () => ({ companyName: "Ready" }) } as never });
  return { service: new MetaWhatsAppReadinessService(repository, resolver, value.integrations, whatsApp, value.provider), whatsApp, resolver };
}

test("EPIC-042 readiness subscribes then confirms observationally before canonical activation and replays idempotently", async () => {
  const value = orchestrationFixture(); try {
    const started = await launch(value), completed = await value.completion.complete(input(value, started)); assert.equal(completed.kind, "completed"); if (completed.kind !== "completed") throw new Error("expected completion");
    value.provider.subscriptionOutcomes = [{ kind: "success", subscribed: false }, { kind: "success", subscribed: true }, { kind: "success", subscribed: true }];
    const ready = readiness(value), result = await ready.service.ensureReady({ workspaceId: value.context.workspaceId, companyId: value.companyId, whatsAppConnectionId: completed.whatsAppConnectionId, setupSubscription: true });
    assert.equal(result.kind, "ready"); assert.equal(value.provider.subscriptions, 1); assert.equal(value.provider.unsubscriptions, 0);
    assert.equal((value.database.prepare("SELECT status FROM whatsapp_connections").get() as { status: string }).status, "active");
    assert.equal((value.database.prepare("SELECT status FROM integration_connections").get() as { status: string }).status, "active");
    assert.equal(ready.resolver.resolve(value.context, value.companyId, completed.whatsAppConnectionId as never), "transient-meta-token");
    assert.equal((value.database.prepare("SELECT count(*) count FROM whatsapp_connection_credentials").get() as { count: number }).count, 0);
    assert.equal((await ready.service.ensureReady({ workspaceId: value.context.workspaceId, companyId: value.companyId, whatsAppConnectionId: completed.whatsAppConnectionId, setupSubscription: true })).kind, "replayed");
    ready.whatsApp.deactivate(value.context, value.companyId, completed.whatsAppConnectionId);
    assert.equal((value.database.prepare("SELECT count(*) count FROM integration_connection_secrets").get() as { count: number }).count, 1); assert.equal(value.provider.unsubscriptions, 0);
  } finally { value.database.close(); }
});

test("EPIC-042 readiness never activates from POST alone or unavailable/unauthorized inspection", async () => {
  for (const outcomes of [[{ kind: "success" as const, subscribed: false }, { kind: "success" as const, subscribed: false }], [{ kind: "unavailable" as const }], [{ kind: "unauthorized" as const }]]) {
    const provider = new ScriptedMetaProvider(), value = orchestrationFixture(":memory:", provider); try {
      const started = await launch(value), completed = await value.completion.complete(input(value, started)); if (completed.kind !== "completed") throw new Error("expected completion");
      provider.subscriptionOutcomes = outcomes; const result = await readiness(value).service.ensureReady({ workspaceId: value.context.workspaceId, companyId: value.companyId, whatsAppConnectionId: completed.whatsAppConnectionId, setupSubscription: true });
      assert.equal(["unready", "unavailable", "reconnect_required"].includes(result.kind), true); assert.equal((value.database.prepare("SELECT status FROM whatsapp_connections").get() as { status: string }).status, "inactive"); assert.equal(provider.unsubscriptions, 0);
    } finally { value.database.close(); }
  }
});
