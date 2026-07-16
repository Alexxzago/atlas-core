import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { CredentialEnrollmentHashProvider, PasswordHashProvider, PasswordProtection, PasswordVerificationProvider, RandomProvider, SessionIdentifierProvider, VerificationHashProvider } from "../application/ports.js";
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

const SCRYPT_PARAMETERS = Object.freeze({ N: 16_384, r: 8, p: 1, keyLength: 32 });

export class ScryptPasswordProvider implements PasswordHashProvider, PasswordVerificationProvider {
  private readonly parameters = JSON.stringify(SCRYPT_PARAMETERS);
  private active=0;
  private readonly waiters:Array<()=>void>=[];
  public async protect(password: string): Promise<PasswordProtection> {
    const salt = randomBytes(16).toString("base64url");
    const confirmation = await this.derive(password, salt, SCRYPT_PARAMETERS);
    return { algorithm: "scrypt", algorithmVersion: "scrypt-v1", parameters: this.parameters, salt, confirmation };
  }
  public async verify(password: string, protection: PasswordProtection): Promise<{ matches: boolean; needsUpgrade: boolean }> {
    if (protection.algorithm !== "scrypt" || protection.algorithmVersion !== "scrypt-v1") throw new Error("Unsupported password protection version.");
    const parsed = JSON.parse(protection.parameters) as typeof SCRYPT_PARAMETERS;
    const actual = Buffer.from(await this.derive(password, protection.salt, parsed), "base64url");
    const expected = Buffer.from(protection.confirmation, "base64url");
    return { matches: actual.length === expected.length && timingSafeEqual(actual, expected), needsUpgrade: protection.parameters !== this.parameters };
  }
  public async dummyVerify(password: string): Promise<void> {
    await this.derive(password, "YXRsYXMtZHVtbXktc2FsdA", SCRYPT_PARAMETERS);
  }
  private async derive(password: string, salt: string, parameters: typeof SCRYPT_PARAMETERS): Promise<string> {
    await this.acquire();
    try{
      const key = await new Promise<Buffer>((resolve,reject)=>scrypt(Buffer.from(password,"utf8"),Buffer.from(salt,"base64url"),parameters.keyLength,
        {N:parameters.N,r:parameters.r,p:parameters.p,maxmem:64*1024*1024},(error,derived)=>error?reject(error):resolve(derived)));
      return key.toString("base64url");
    }finally{this.release();}
  }
  private async acquire():Promise<void>{if(this.active<4){this.active+=1;return;}await new Promise<void>(resolve=>this.waiters.push(resolve));this.active+=1;}
  private release():void{this.active-=1;this.waiters.shift()?.();}
}

export class Sha256SessionIdentifierProvider implements SessionIdentifierProvider {
  public create(): { raw: string; digest: string; digestVersion: "sha256-v1" } {
    const raw = randomBytes(32).toString("base64url");
    return { raw, digest: this.digest(raw, "identifier"), digestVersion: "sha256-v1" };
  }
  public parse(raw: string): { raw: string; digest: string; digestVersion: "sha256-v1" } | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw) || Buffer.from(raw, "base64url").byteLength !== 32) return null;
    return { raw, digest: this.digest(raw, "identifier"), digestVersion: "sha256-v1" };
  }
  public digestSecret(value: string, purpose: "csrf"): string { return this.digest(value, purpose); }
  private digest(value: string, purpose: string): string { return createHash("sha256").update(`atlas:session:sha256-v1:${purpose}:`).update(value).digest("hex"); }
}

export class Sha256CredentialEnrollmentHashProvider implements CredentialEnrollmentHashProvider {
  public digest(proof: VerificationProof): string { return createHash("sha256").update("atlas:credential-enrollment:sha256-v1:").update(proof).digest("hex"); }
}
