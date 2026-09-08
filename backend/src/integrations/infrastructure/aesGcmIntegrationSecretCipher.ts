import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { IntegrationSecretCipherPort } from "../application/ports.js";
import { VersionedAesGcmCipher, type CiphertextState, type VersionedAesGcmKeyRingConfiguration } from "../../security/versionedAesGcmCipher.js";

export class IntegrationSecretCipherError extends Error {}
export class AesGcmIntegrationSecretCipher implements IntegrationSecretCipherPort {
  private readonly ring: VersionedAesGcmCipher | null;
  public constructor(private readonly key: Uint8Array | VersionedAesGcmKeyRingConfiguration) { if (key instanceof Uint8Array) { if (key.byteLength !== 32) throw new IntegrationSecretCipherError("Integration encryption key is invalid."); this.ring=null; } else { try { this.ring=new VersionedAesGcmCipher(key); } catch { throw new IntegrationSecretCipherError("Integration encryption key is invalid."); } } }
  public encrypt(value: string): string {
    if (!value) throw new IntegrationSecretCipherError("Integration secret is invalid.");
    if(this.ring){try{return this.ring.encrypt(value);}catch{throw new IntegrationSecretCipherError("Integration secret is invalid.");}}const key=this.key as Uint8Array;const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv), ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]), tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }
  public decrypt(value: string): string {
    if(this.ring){try{return this.ring.decrypt(value);}catch{throw new IntegrationSecretCipherError("Encrypted Integration secret is invalid.");}}
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new IntegrationSecretCipherError("Encrypted Integration secret is invalid.");
    try { const decipher = createDecipheriv("aes-256-gcm", this.key as Uint8Array, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"); }
    catch { throw new IntegrationSecretCipherError("Encrypted Integration secret is invalid."); }
  }
  public state(value: string): CiphertextState { if(this.ring){try{return this.ring.state(value);}catch{throw new IntegrationSecretCipherError("Encrypted Integration secret is invalid.");}}this.decrypt(value);return "legacy"; }
}

export class IntegrationSecretCipherConfigurationError extends Error {}
export function integrationSecretCipherFromEnvironment(value: string | undefined): AesGcmIntegrationSecretCipher | null { const normalized = value?.trim() ?? ""; if (!normalized) return null; if (!/^[a-f0-9]{64}$/i.test(normalized)) throw new IntegrationSecretCipherConfigurationError("ATLAS_INTEGRATION_SECRET_KEY must be 64 hexadecimal characters."); return new AesGcmIntegrationSecretCipher(Buffer.from(normalized, "hex")); }
export function integrationSecretCipherRingFromEnvironment(environment: NodeJS.ProcessEnv = process.env): AesGcmIntegrationSecretCipher | null {
  const activeId=environment.ATLAS_INTEGRATION_SECRET_ACTIVE_KEY_ID?.trim(),active=environment.ATLAS_INTEGRATION_SECRET_ACTIVE_KEY?.trim(),previousId=environment.ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY_ID?.trim(),previous=environment.ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY?.trim();
  if (!activeId && !active && !previousId && !previous) return integrationSecretCipherFromEnvironment(environment.ATLAS_INTEGRATION_SECRET_KEY);
  if (!activeId || !active || Boolean(previousId) !== Boolean(previous)) throw new IntegrationSecretCipherConfigurationError("Integration encryption key-ring configuration is invalid.");
  try { return new AesGcmIntegrationSecretCipher({activeKeyId:activeId,activeKey:key(active),...(previousId&&previous?{previousKeyId:previousId,previousKey:key(previous)}:{}),...(environment.ATLAS_INTEGRATION_SECRET_KEY?.trim()?{legacyV1Key:key(environment.ATLAS_INTEGRATION_SECRET_KEY)}:{})}); } catch { throw new IntegrationSecretCipherConfigurationError("Integration encryption key-ring configuration is invalid."); }
}
function key(value:string):Uint8Array { if(!/^[a-f0-9]{64}$/i.test(value))throw new Error();return Buffer.from(value,"hex"); }
