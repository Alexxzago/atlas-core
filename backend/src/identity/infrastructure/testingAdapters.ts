import type { EmailVerificationDeliveryPort, EmailVerificationDeliveryRequest, RandomProvider, VerificationDeliveryOutcome, VerificationHashProvider } from "../application/ports.js";
import { tokenDigest, type DigestAlgorithmVersion, type TokenDigest, type VerificationPurpose } from "../domain/emailVerification.js";
import type { VerificationProof } from "../domain/proof.js";

export class DeterministicRandomProvider implements RandomProvider {
  public constructor(private readonly outputs: Uint8Array[]) {}
  public secureBytes(length: number): Uint8Array {
    const output = this.outputs.shift();
    if (!output || output.byteLength !== length) throw new Error("Deterministic random output is unavailable.");
    return output;
  }
}

export class DeterministicVerificationHashProvider implements VerificationHashProvider {
  public readonly version: DigestAlgorithmVersion = "sha256-v1";
  public digest(proof: VerificationProof, purpose: VerificationPurpose): TokenDigest {
    return tokenDigest(`test:${this.version}:${purpose}:${proof}`);
  }
}

export class InMemoryVerificationDelivery implements EmailVerificationDeliveryPort {
  public readonly requests: EmailVerificationDeliveryRequest[] = [];
  public constructor(private readonly outcome: VerificationDeliveryOutcome = "accepted") {}
  public async deliver(request: EmailVerificationDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    this.requests.push(request);
    return this.outcome;
  }
}
