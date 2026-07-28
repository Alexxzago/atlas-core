import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { WhatsAppCredentialCipherPort } from "../application/ports.js";

export class WhatsAppCredentialCipherError extends Error {}

export class AesGcmWhatsAppCredentialCipher implements WhatsAppCredentialCipherPort {
  public constructor(private readonly key: Uint8Array) {
    if (key.byteLength !== 32) throw new WhatsAppCredentialCipherError("WhatsApp credential encryption key is invalid.");
  }

  public encrypt(accessToken: string): string {
    if (!accessToken) throw new WhatsAppCredentialCipherError("WhatsApp access token is invalid.");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv), encrypted = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]), tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  public decrypt(value: string): string {
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || iv === undefined || tag === undefined || ciphertext === undefined) throw new WhatsAppCredentialCipherError("Encrypted WhatsApp credentials are invalid.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new WhatsAppCredentialCipherError("Encrypted WhatsApp credentials are invalid.");
    }
  }
}
