import assert from "node:assert/strict";
import test from "node:test";
import { productionConfiguration, productionConfigurationInventory } from "../config/productionConfiguration.js";
import { productionDatabaseConfiguration } from "../config/database.js";

const core = (): NodeJS.ProcessEnv => ({ NODE_ENV: "production", DATABASE_PROVIDER: "libsql", TURSO_DATABASE_URL: "libsql://atlas.example.test", TURSO_AUTH_TOKEN: "database-token", ATLAS_VERIFICATION_ORIGIN: "https://portal.example.test", ATLAS_BOOTSTRAP_SECRET: "b".repeat(32), ATLAS_MEDIA_STORAGE_PROVIDER: "s3", ATLAS_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com", ATLAS_S3_REGION: "auto", ATLAS_S3_BUCKET: "atlas-media", ATLAS_S3_ACCESS_KEY_ID: "access-key", ATLAS_S3_SECRET_ACCESS_KEY: "secret-key", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "email-token", RESEND_FROM: "atlas@example.test" });

test("EPIC047 valid core production configuration composes deterministically without provider I/O", () => {
  const environment = core(); let calls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => { calls += 1; throw new Error("unexpected provider call"); }) as typeof fetch;
  try { assert.deepEqual(productionConfiguration(environment), productionConfiguration({ ...environment })); assert.equal(productionConfiguration(environment).whatsAppWebhookEnabled, false); assert.equal(calls, 0); }
  finally { globalThis.fetch = previous; }
});

test("EPIC047 production keeps local SQLite rejected and fails safely for missing database configuration", () => {
  assert.throws(() => productionDatabaseConfiguration({ NODE_ENV: "production", DATABASE_PROVIDER: "sqlite" }), /local SQLite/);
  assert.throws(() => productionConfiguration({ ...core(), TURSO_AUTH_TOKEN: "" }), /TURSO_DATABASE_URL and TURSO_AUTH_TOKEN/);
});

test("EPIC047 absent optional providers and unavailable Voice do not block core configuration", () => { assert.doesNotThrow(() => productionConfiguration(core())); });

test("EPIC047 selected providers fail closed without required configuration", () => {
  assert.throws(() => productionConfiguration({ ...core(), BILLING_PROVIDERS: "stripe" }), /enabled provider/);
  assert.throws(() => productionConfiguration({ ...core(), WHATSAPP_APP_SECRET: "app-secret" }), /enabled provider/);
});

test("EPIC047 production durable media requires explicit S3 configuration without a local fallback", () => {
  assert.throws(() => productionConfiguration({ ...core(), ATLAS_MEDIA_STORAGE_PROVIDER: "local" }), /durable media storage/);
  assert.throws(() => productionConfiguration({ ...core(), ATLAS_S3_BUCKET: "" }), /durable media storage/);
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
