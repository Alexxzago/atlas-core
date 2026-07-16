import { createHash, randomBytes } from "node:crypto";
import type { RandomProvider, VerificationHashProvider } from "../application/ports.js";
import { tokenDigest, type DigestAlgorithmVersion, type TokenDigest, type VerificationPurpose } from "../domain/emailVerification.js";
import type { VerificationProof } from "../domain/proof.js";

export class SecureRandomProvider implements RandomProvider {
  public secureBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 1) throw new Error("Secure random byte length is invalid.");
    return randomBytes(length);
  }
}

export class Sha256VerificationHashProvider implements VerificationHashProvider {
  public readonly version: DigestAlgorithmVersion = "sha256-v1";

  public digest(proof: VerificationProof, purpose: VerificationPurpose): TokenDigest {
    return tokenDigest(createHash("sha256")
      .update(`atlas:verification:${this.version}:${purpose}:`, "utf8")
      .update(proof, "utf8")
      .digest("hex"));
  }
}
