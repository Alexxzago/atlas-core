export type VerificationProof = string & { readonly __brand: "VerificationProof" };

export class InvalidVerificationProofError extends Error {
  public constructor() { super("Verification proof is invalid."); }
}

export function formatVerificationProof(bytes: Uint8Array): VerificationProof {
  if (bytes.byteLength < 32) throw new InvalidVerificationProofError();
  return Buffer.from(bytes).toString("base64url") as VerificationProof;
}

export function parseVerificationProof(value: string): VerificationProof {
  if (!/^[A-Za-z0-9_-]{43,}$/.test(value) || value.includes("=")) throw new InvalidVerificationProofError();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength < 32 || decoded.toString("base64url") !== value) throw new InvalidVerificationProofError();
  return value as VerificationProof;
}
