import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const keyId = /^[A-Za-z0-9_-]{1,32}$/u;
const encoded = /^[A-Za-z0-9_-]+$/u;
export type CiphertextState = "active" | "previous" | "legacy";
export interface VersionedAesGcmKeyRingConfiguration { readonly activeKeyId: string; readonly activeKey: Uint8Array; readonly previousKeyId?: string; readonly previousKey?: Uint8Array; readonly legacyV1Key?: Uint8Array; }

/** Shared envelope mechanics only. Domain adapters retain their own key material and ports. */
export class VersionedAesGcmCipher {
  public constructor(private readonly configuration: VersionedAesGcmKeyRingConfiguration) {
    if (!keyId.test(configuration.activeKeyId) || configuration.activeKey.byteLength !== 32) throw new Error("Encryption key configuration is invalid.");
    const previousConfigured = configuration.previousKeyId !== undefined || configuration.previousKey !== undefined;
    if (previousConfigured && (!configuration.previousKeyId || !configuration.previousKey || !keyId.test(configuration.previousKeyId) || configuration.previousKey.byteLength !== 32 || configuration.previousKeyId === configuration.activeKeyId)) throw new Error("Encryption key configuration is invalid.");
    if (configuration.legacyV1Key && configuration.legacyV1Key.byteLength !== 32) throw new Error("Encryption key configuration is invalid.");
  }
  public encrypt(value: string): string { if (!value) throw new Error("Encryption plaintext is invalid."); return envelope("v2", this.configuration.activeKeyId, this.configuration.activeKey, value); }
  public decrypt(value: string): string {
    const parsed = parse(value);
    if (parsed.version === "v1") { if (!this.configuration.legacyV1Key) throw new Error("Encrypted value is invalid."); return open(this.configuration.legacyV1Key, parsed.iv, parsed.tag, parsed.ciphertext); }
    const key = parsed.keyId === this.configuration.activeKeyId ? this.configuration.activeKey : parsed.keyId === this.configuration.previousKeyId ? this.configuration.previousKey : undefined;
    if (!key) throw new Error("Encrypted value is invalid.");
    return open(key, parsed.iv, parsed.tag, parsed.ciphertext);
  }
  public state(value: string): CiphertextState { const parsed = parse(value); if (parsed.version === "v1") return "legacy"; if (parsed.keyId === this.configuration.activeKeyId) return "active"; if (parsed.keyId === this.configuration.previousKeyId && this.configuration.previousKey) return "previous"; throw new Error("Encrypted value is invalid."); }
}

function envelope(version: "v2", id: string, key: Uint8Array, value: string): string { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv), ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]), tag = cipher.getAuthTag(); return `${version}.${id}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`; }
function open(key: Uint8Array, iv: string, tag: string, ciphertext: string): string { try { const nonce = Buffer.from(iv, "base64url"), authenticationTag = Buffer.from(tag, "base64url"), encrypted = Buffer.from(ciphertext, "base64url"); if (nonce.byteLength !== 12 || authenticationTag.byteLength !== 16 || !encrypted.byteLength) throw new Error(); const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAuthTag(authenticationTag); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"); } catch { throw new Error("Encrypted value is invalid."); } }
function parse(value: string): { readonly version: "v1"; readonly iv: string; readonly tag: string; readonly ciphertext: string } | { readonly version: "v2"; readonly keyId: string; readonly iv: string; readonly tag: string; readonly ciphertext: string } { const values = value.split("."); if (values[0] === "v1" && values.length === 4 && values[1] && values[2] && values[3] && encoded.test(values[1]) && encoded.test(values[2]) && encoded.test(values[3])) return { version: "v1", iv: values[1], tag: values[2], ciphertext: values[3] }; if (values[0] === "v2" && values.length === 5 && values[1] && values[2] && values[3] && values[4] && keyId.test(values[1]) && encoded.test(values[2]) && encoded.test(values[3]) && encoded.test(values[4])) return { version: "v2", keyId: values[1], iv: values[2], tag: values[3], ciphertext: values[4] }; throw new Error("Encrypted value is invalid."); }
