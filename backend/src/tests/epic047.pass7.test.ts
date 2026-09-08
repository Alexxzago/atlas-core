import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { AesGcmIntegrationSecretCipher, integrationSecretCipherRingFromEnvironment } from "../integrations/infrastructure/aesGcmIntegrationSecretCipher.js";
import { CredentialReencryptionMaintenance } from "../security/credentialReencryptionMaintenance.js";
import { AesGcmWhatsAppCredentialCipher } from "../whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";

const active = Buffer.alloc(32, 1), previous = Buffer.alloc(32, 2), legacy = Buffer.alloc(32, 3);
const ring = () => ({ activeKeyId: "rotation_2026", activeKey: active, previousKeyId: "rotation_2025", previousKey: previous, legacyV1Key: legacy });

test("EPIC047 PASS7 emits v2 active envelopes, accepts only configured overlap keys, and isolates domains", () => {
  const whatsApp = new AesGcmWhatsAppCredentialCipher(ring()), integration = new AesGcmIntegrationSecretCipher({ ...ring(), activeKey: Buffer.alloc(32, 4), previousKey: Buffer.alloc(32, 5), legacyV1Key: Buffer.alloc(32, 6) });
  const first = whatsApp.encrypt("token"), second = whatsApp.encrypt("token"), old = new AesGcmWhatsAppCredentialCipher(previous).encrypt("old"), legacyValue = new AesGcmWhatsAppCredentialCipher(legacy).encrypt("legacy");
  assert.match(first, /^v2\.rotation_2026\./u); assert.notEqual(first, second); assert.equal(whatsApp.decrypt(first), "token");
  assert.equal(new AesGcmWhatsAppCredentialCipher(ring()).decrypt(`v2.rotation_2025.${old.split(".").slice(1).join(".")}`), "old");
  assert.equal(whatsApp.decrypt(legacyValue), "legacy");
  const activeOnly=new AesGcmWhatsAppCredentialCipher({activeKeyId:"rotation_2026",activeKey:active});assert.throws(()=>activeOnly.decrypt(`v2.rotation_2025.${old.split(".").slice(1).join(".")}`));assert.throws(()=>activeOnly.decrypt(legacyValue));assert.equal(activeOnly.decrypt(first),"token");
  assert.throws(() => whatsApp.decrypt(first.replace("rotation_2026", "unknown"))); assert.throws(() => integration.decrypt(first));
});

test("EPIC047 PASS7 validates integration key-ring configuration without secret leakage", () => {
  const environment = { ATLAS_INTEGRATION_SECRET_ACTIVE_KEY_ID: "active", ATLAS_INTEGRATION_SECRET_ACTIVE_KEY: "a".repeat(64), ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY_ID: "previous", ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY: "b".repeat(64), ATLAS_INTEGRATION_SECRET_KEY: "c".repeat(64) } as NodeJS.ProcessEnv;
  const cipher = integrationSecretCipherRingFromEnvironment(environment); assert.ok(cipher); assert.match(cipher!.encrypt("secret"), /^v2\.active\./u);
  assert.throws(() => integrationSecretCipherRingFromEnvironment({ ...environment, ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY: "" }), (error: unknown) => error instanceof Error && !error.message.includes("a".repeat(64)));
});

test("EPIC047 PASS7 key-ring configurations reject incomplete, duplicate, malformed, and secret-leaking inputs in both domains", () => {
  const valid={activeKeyId:"active",activeKey:active},both=[AesGcmWhatsAppCredentialCipher,AesGcmIntegrationSecretCipher] as const;
  for(const Cipher of both){assert.doesNotThrow(()=>new Cipher(valid));assert.doesNotThrow(()=>new Cipher({...valid,previousKeyId:"previous",previousKey:previous}));assert.doesNotThrow(()=>new Cipher({...valid,legacyV1Key:legacy}));assert.doesNotThrow(()=>new Cipher({...valid,previousKeyId:"previous",previousKey:previous,legacyV1Key:legacy}));for(const invalid of [{activeKeyId:"",activeKey:active},{activeKeyId:"active",activeKey:Buffer.alloc(31)},{activeKeyId:"bad.id",activeKey:active},{...valid,previousKeyId:"active",previousKey:previous},{...valid,previousKey:previous},{...valid,previousKeyId:"previous"}])assert.throws(()=>new Cipher(invalid as never),error=>error instanceof Error&&!error.message.includes("rotation"));}
});

test("EPIC047 PASS7 maintenance returns authoritative post-run retirement counts across legacy, previous, and active envelopes", () => {
  const database = createDatabase(":memory:"), whatsApp = new AesGcmWhatsAppCredentialCipher(ring()), integration = new AesGcmIntegrationSecretCipher(ring()), oldWhatsApp = new AesGcmWhatsAppCredentialCipher(legacy).encrypt("token"), previousIntegration = new AesGcmIntegrationSecretCipher({activeKeyId:"rotation_2025",activeKey:previous}).encrypt("previous-secret"), activeIntegration = integration.encrypt("active-secret");
  try {
    database.exec("PRAGMA foreign_keys=OFF"); database.prepare("INSERT INTO whatsapp_connection_credentials(whatsapp_connection_id,encrypted_access_token,created_at,updated_at) VALUES(?,?,?,?)").run("wac_test", oldWhatsApp, "2026-01-01", "2026-01-01"); database.prepare("INSERT INTO integration_connection_secrets(integration_connection_id,encrypted_secret,created_at,updated_at) VALUES(?,?,?,?)").run("inc_previous", previousIntegration, "2026-01-01", "2026-01-01"); database.prepare("INSERT INTO integration_connection_secrets(integration_connection_id,encrypted_secret,created_at,updated_at) VALUES(?,?,?,?)").run("inc_active", activeIntegration, "2026-01-01", "2026-01-01");
    const maintenance = new CredentialReencryptionMaintenance(database, whatsApp, integration), first = maintenance.run(1), second = maintenance.run(1);
    assert.deepEqual(first, { scanned:3,alreadyActive:1,reencrypted:2,failed:0,legacyV1Remaining:0,previousKeyRemaining:0,activeV2:3 }); assert.deepEqual(second, { scanned:3,alreadyActive:3,reencrypted:0,failed:0,legacyV1Remaining:0,previousKeyRemaining:0,activeV2:3 });
    assert.match((database.prepare("SELECT encrypted_access_token value FROM whatsapp_connection_credentials").get() as { value: string }).value, /^v2\.rotation_2026\./u);
    const migrated=database.prepare("SELECT encrypted_secret value FROM integration_connection_secrets WHERE integration_connection_id='inc_previous'").get() as {value:string};assert.match(migrated.value,/^v2\.rotation_2026\./u);assert.equal(new AesGcmIntegrationSecretCipher({activeKeyId:"rotation_2026",activeKey:active}).decrypt(migrated.value),"previous-secret");
  } finally { database.close(); }
});

test("EPIC047 PASS7 maintenance preserves failed ciphertext, recounts it, and resumes safely", () => {
  const database=createDatabase(":memory:"),cipher=new AesGcmWhatsAppCredentialCipher(ring()),old=new AesGcmWhatsAppCredentialCipher(legacy).encrypt("recoverable-token");
  try { database.exec("PRAGMA foreign_keys=OFF");database.prepare("INSERT INTO whatsapp_connection_credentials(whatsapp_connection_id,encrypted_access_token,created_at,updated_at) VALUES(?,?,?,?)").run("wac_failed",old,"2026-01-01","2026-01-01");database.exec("CREATE TRIGGER reject_rotation BEFORE UPDATE ON whatsapp_connection_credentials BEGIN SELECT RAISE(ABORT,'reject'); END");const maintenance=new CredentialReencryptionMaintenance(database,cipher,new AesGcmIntegrationSecretCipher(ring())),failed=maintenance.run();assert.deepEqual({reencrypted:failed.reencrypted,failed:failed.failed,legacy:failed.legacyV1Remaining},{reencrypted:0,failed:1,legacy:1});assert.equal((database.prepare("SELECT encrypted_access_token value FROM whatsapp_connection_credentials").get()as{value:string}).value,old);assert.equal(cipher.decrypt(old),"recoverable-token");database.exec("DROP TRIGGER reject_rotation");const retried=maintenance.run();assert.deepEqual({reencrypted:retried.reencrypted,failed:retried.failed,legacy:retried.legacyV1Remaining},{reencrypted:1,failed:0,legacy:0}); } finally { database.close(); }
});
