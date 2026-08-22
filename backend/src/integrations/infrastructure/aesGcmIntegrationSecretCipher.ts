import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { IntegrationSecretCipherPort } from "../application/ports.js";

export class IntegrationSecretCipherError extends Error {}
export class AesGcmIntegrationSecretCipher implements IntegrationSecretCipherPort {
  public constructor(private readonly key: Uint8Array) { if (key.byteLength !== 32) throw new IntegrationSecretCipherError("Integration encryption key is invalid."); }
  public encrypt(value: string): string {
    if (!value) throw new IntegrationSecretCipherError("Integration secret is invalid.");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv), ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]), tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }
  public decrypt(value: string): string {
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new IntegrationSecretCipherError("Encrypted Integration secret is invalid.");
    try { const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"); }
    catch { throw new IntegrationSecretCipherError("Encrypted Integration secret is invalid."); }
  }
}

export class IntegrationSecretCipherConfigurationError extends Error {}
export function integrationSecretCipherFromEnvironment(value: string | undefined): AesGcmIntegrationSecretCipher | null { const normalized = value?.trim() ?? ""; if (!normalized) return null; if (!/^[a-f0-9]{64}$/i.test(normalized)) throw new IntegrationSecretCipherConfigurationError("ATLAS_INTEGRATION_SECRET_KEY must be 64 hexadecimal characters."); return new AesGcmIntegrationSecretCipher(Buffer.from(normalized, "hex")); }
