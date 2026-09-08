import { database } from "../config/database.js";
import { integrationSecretCipher, whatsAppCredentialCipher } from "../composition.js";
import { CredentialReencryptionMaintenance, type RotationCipher } from "../security/credentialReencryptionMaintenance.js";

const batchSize = Number(process.env.ATLAS_CREDENTIAL_REENCRYPTION_BATCH_SIZE ?? "100");
if (!integrationSecretCipher || !("state" in integrationSecretCipher) || !("state" in whatsAppCredentialCipher)) throw new Error("Credential re-encryption requires configured active encryption key rings.");
const result = new CredentialReencryptionMaintenance(database, whatsAppCredentialCipher as RotationCipher, integrationSecretCipher as RotationCipher).run(batchSize);
console.info(JSON.stringify({ operation: "credential_reencryption", scanned: result.scanned, alreadyActive: result.alreadyActive, reencrypted: result.reencrypted, failed: result.failed, legacyV1Remaining: result.legacyV1Remaining, previousKeyRemaining: result.previousKeyRemaining, activeV2: result.activeV2 }));
