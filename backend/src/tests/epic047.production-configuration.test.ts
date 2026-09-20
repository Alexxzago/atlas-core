import assert from "node:assert/strict";
import test from "node:test";
import { productionConfiguration, productionConfigurationInventory } from "../config/productionConfiguration.js";
import { createProductionRuntimeDatabase, productionDatabaseConfiguration } from "../config/database.js";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../config/migrations.js";
import { UnavailableMediaStorage } from "../media/infrastructure/unavailableMediaStorage.js";
import { MediaDomainError } from "../media/domain/media.js";
import { CompanyOperationalStatusService } from "../company/services/companyOperationalStatusService.js";
import { markRuntimeReady, registerRuntimeWorker, resetRuntimeReadinessForTests, runtimeMissingRequiredWorkers, runtimeReadinessStatus, runtimeWorkerCycleSucceeded, runtimeWorkerStarted } from "../config/runtimeReadiness.js";

const core = (): NodeJS.ProcessEnv => ({ NODE_ENV: "production", DATABASE_PROVIDER: "libsql", TURSO_DATABASE_URL: "libsql://atlas.example.test", TURSO_AUTH_TOKEN: "database-token", ATLAS_VERIFICATION_ORIGIN: "https://portal.example.test", ATLAS_BOOTSTRAP_SECRET: "b".repeat(32), ATLAS_MEDIA_STORAGE_PROVIDER: "s3", ATLAS_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com", ATLAS_S3_REGION: "auto", ATLAS_S3_BUCKET: "atlas-media", ATLAS_S3_ACCESS_KEY_ID: "access-key", ATLAS_S3_SECRET_ACCESS_KEY: "secret-key", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "email-token", RESEND_FROM: "atlas@example.test" });
const noMedia = (): NodeJS.ProcessEnv => { const environment = core(); delete environment.ATLAS_MEDIA_STORAGE_PROVIDER; delete environment.ATLAS_S3_ENDPOINT; delete environment.ATLAS_S3_REGION; delete environment.ATLAS_S3_BUCKET; delete environment.ATLAS_S3_ACCESS_KEY_ID; delete environment.ATLAS_S3_SECRET_ACCESS_KEY; return environment; };

test("EPIC047 valid full S3 production configuration composes deterministically without provider I/O", () => {
  const environment = core(); let calls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => { calls += 1; throw new Error("unexpected provider call"); }) as typeof fetch;
  try { assert.deepEqual(productionConfiguration(environment), productionConfiguration({ ...environment })); assert.equal(productionConfiguration(environment).mediaCapability, "available"); assert.equal(productionConfiguration(environment).whatsAppWebhookEnabled, false); assert.equal(calls, 0); }
  finally { globalThis.fetch = previous; }
});

test("EPIC047 production keeps local SQLite rejected and fails safely for missing database configuration", () => {
  assert.throws(() => productionDatabaseConfiguration({ NODE_ENV: "production", DATABASE_PROVIDER: "sqlite" }), /local SQLite/);
  assert.throws(() => productionConfiguration({ ...core(), TURSO_AUTH_TOKEN: "" }), /TURSO_DATABASE_URL and TURSO_AUTH_TOKEN/);
});

test("EPIC047 zero-media production preflight is healthy without a local fallback and Voice remains unavailable", () => {
  const configuration = productionConfiguration(noMedia());
  assert.equal(configuration.mediaStorage, null);
  assert.equal(configuration.mediaCapability, "unavailable");
  assert.doesNotThrow(() => productionConfiguration(noMedia()));
  resetRuntimeReadinessForTests(); registerRuntimeWorker("billing_reconciliation"); registerRuntimeWorker("whatsapp_recovery"); runtimeWorkerStarted("billing_reconciliation"); runtimeWorkerStarted("whatsapp_recovery"); runtimeWorkerCycleSucceeded("billing_reconciliation"); runtimeWorkerCycleSucceeded("whatsapp_recovery"); markRuntimeReady();
  assert.equal(runtimeReadinessStatus(), "ready");
  assert.deepEqual(runtimeMissingRequiredWorkers(), []);
  resetRuntimeReadinessForTests();
  const status = new CompanyOperationalStatusService({ findById: () => ({}) } as never, { findLatest: () => null } as never, { listByCompany: () => [], findOperationalState: () => null } as never).get({} as never, 1);
  assert.equal(status.voice.status, "unavailable");
});

test("EPIC047 selected providers fail closed without required configuration", () => {
  assert.throws(() => productionConfiguration({ ...core(), BILLING_PROVIDERS: "stripe" }), /enabled provider/);
  assert.throws(() => productionConfiguration({ ...core(), WHATSAPP_APP_SECRET: "app-secret" }), /enabled provider/);
});

test("EPIC047 partial or invalid production durable media fails closed", () => {
  assert.throws(() => productionConfiguration({ ...core(), ATLAS_MEDIA_STORAGE_PROVIDER: "local" }), /durable media storage/);
  assert.throws(() => productionConfiguration({ ...core(), ATLAS_S3_BUCKET: "" }), /durable media storage/);
  assert.throws(() => productionConfiguration({ ...noMedia(), ATLAS_S3_BUCKET: "atlas-media" }), /durable media storage/);
});

test("EPIC047 unavailable media operations are bounded and never expose storage failures", async () => {
  const storage = new UnavailableMediaStorage(), secret = "RAW_PROVIDER_ERROR_SECRET";
  await assert.rejects(storage.stage("mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", (async function* () { yield Buffer.from(secret); })(), { workspaceId: 1, companyId: 1 }), (error: unknown) => error instanceof MediaDomainError && error.code === "media_unavailable" && !error.message.includes(secret));
  await assert.rejects(storage.read("workspaces/1/companies/1/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object", 1), (error: unknown) => error instanceof MediaDomainError && error.code === "media_unavailable");
});

test("EPIC047 production preflight occurs before runtime connection or migration", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON"); runMigrations(database, 68);
    let opened = false;
    assert.throws(() => createProductionRuntimeDatabase({ ...noMedia(), ATLAS_BOOTSTRAP_SECRET: "invalid" }, () => { opened = true; return database; }), /ATLAS_BOOTSTRAP_SECRET/);
    assert.equal(opened, false);
    assert.equal((database.prepare("SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as { name: string }).name, "0068_billing_operations_provider_events_reconciliation");
  } finally { database.close(); }
});

test("EPIC047 valid production preflight permits the normal 0068 to 0069 migration", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON"); runMigrations(database, 68);
    const runtime = createProductionRuntimeDatabase(noMedia(), () => database);
    assert.equal(runtime.configuration.mediaCapability, "unavailable");
    assert.equal((database.prepare("SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as { name: string }).name, "0075_activation_verification_attempts");
    assert.doesNotThrow(() => createProductionRuntimeDatabase(noMedia(), () => database));
  } finally { database.close(); }
});

test("EPIC047 malformed configuration errors redact secret values", () => {
  const secret = "do-not-print-this-secret";
  assert.throws(() => productionConfiguration({ ...core(), TURSO_AUTH_TOKEN: secret, ATLAS_INTEGRATION_SECRET_KEY: "not-a-key" }), (error: unknown) => error instanceof Error && !error.message.includes(secret));
});

test("EPIC047 release inventory classifies DR maintenance and release identity without requiring Voice", () => {
  const inventory = productionConfigurationInventory.map(entry => ({ name: entry.name, classification: entry.classification, enabledBy: entry.enabledBy }));
  assert.ok(inventory.some(entry => entry.name.includes("ATLAS_BACKUP_S3_ENDPOINT") && entry.classification === "REQUIRED_WHEN_ENABLED"));
  assert.ok(inventory.some(entry => entry.name.includes("ATLAS_DEPLOYMENT_VERSION") && entry.classification === "OPTIONAL"));
  assert.equal(JSON.stringify(inventory).includes("VOICE"), false);
});
