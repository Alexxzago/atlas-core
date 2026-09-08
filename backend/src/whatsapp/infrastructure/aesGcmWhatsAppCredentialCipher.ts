import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { WhatsAppCredentialCipherPort } from "../application/ports.js";
import { VersionedAesGcmCipher, type CiphertextState, type VersionedAesGcmKeyRingConfiguration } from "../../security/versionedAesGcmCipher.js";

export class WhatsAppCredentialCipherError extends Error {}
export function whatsAppCredentialCipherFromEnvironment(environment:NodeJS.ProcessEnv=process.env,strict=false):AesGcmWhatsAppCredentialCipher|{encrypt(value:string):string;decrypt(value:string):string}{ const activeId=environment.WHATSAPP_PLATFORM_ENCRYPTION_ACTIVE_KEY_ID?.trim(),active=environment.WHATSAPP_PLATFORM_ENCRYPTION_ACTIVE_KEY?.trim(),previousId=environment.WHATSAPP_PLATFORM_ENCRYPTION_PREVIOUS_KEY_ID?.trim(),previous=environment.WHATSAPP_PLATFORM_ENCRYPTION_PREVIOUS_KEY?.trim(),legacy=environment.WHATSAPP_PLATFORM_ENCRYPTION_KEY?.trim();if(activeId||active||previousId||previous){if(!activeId||!active||Boolean(previousId)!==Boolean(previous))throw new WhatsAppCredentialCipherError("WhatsApp encryption key-ring configuration is invalid.");return new AesGcmWhatsAppCredentialCipher({activeKeyId:activeId,activeKey:key(active),...(previousId&&previous?{previousKeyId:previousId,previousKey:key(previous)}:{}),...(legacy?{legacyV1Key:key(legacy)}:{})});}if(!legacy&&!strict)return {encrypt:()=>{throw new WhatsAppCredentialCipherError("WhatsApp credentials are unavailable.");},decrypt:()=>{throw new WhatsAppCredentialCipherError("WhatsApp credentials are unavailable.");}};return new AesGcmWhatsAppCredentialCipher(key(legacy)); }
function key(value:string|undefined):Uint8Array { const normalized=value?.trim()??"";if(!normalized)throw new WhatsAppCredentialCipherError("WhatsApp credential encryption key is unavailable.");const result=/^[0-9a-f]{64}$/iu.test(normalized)?Buffer.from(normalized,"hex"):Buffer.from(normalized,"base64url");if(result.byteLength!==32)throw new WhatsAppCredentialCipherError("WhatsApp credential encryption key is invalid.");return result; }

export class AesGcmWhatsAppCredentialCipher implements WhatsAppCredentialCipherPort {
  private readonly ring: VersionedAesGcmCipher | null;
  public constructor(private readonly key: Uint8Array | VersionedAesGcmKeyRingConfiguration) {
    if (key instanceof Uint8Array) { if (key.byteLength !== 32) throw new WhatsAppCredentialCipherError("WhatsApp credential encryption key is invalid."); this.ring = null; }
    else { try { this.ring = new VersionedAesGcmCipher(key); } catch { throw new WhatsAppCredentialCipherError("WhatsApp credential encryption key is invalid."); } }
  }

  public encrypt(accessToken: string): string {
    if (!accessToken) throw new WhatsAppCredentialCipherError("WhatsApp access token is invalid.");
    if (this.ring) { try { return this.ring.encrypt(accessToken); } catch { throw new WhatsAppCredentialCipherError("WhatsApp access token is invalid."); } }
    const key = this.key as Uint8Array;
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv), encrypted = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]), tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  public decrypt(value: string): string {
    if (this.ring) { try { return this.ring.decrypt(value); } catch { throw new WhatsAppCredentialCipherError("Encrypted WhatsApp credentials are invalid."); } }
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || iv === undefined || tag === undefined || ciphertext === undefined) throw new WhatsAppCredentialCipherError("Encrypted WhatsApp credentials are invalid.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key as Uint8Array, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new WhatsAppCredentialCipherError("Encrypted WhatsApp credentials are invalid.");
    }
  }
  public state(value: string): CiphertextState { if (this.ring) { try { return this.ring.state(value); } catch { throw new WhatsAppCredentialCipherError("Encrypted WhatsApp credentials are invalid."); } } this.decrypt(value); return "legacy"; }
}
