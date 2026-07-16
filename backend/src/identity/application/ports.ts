import type { EmailAddress } from "../domain/email.js";
import type { DigestAlgorithmVersion, EmailVerificationWorkflow, TokenDigest, VerificationDeliveryStatus, VerificationPurpose } from "../domain/emailVerification.js";
import type { VerificationProof } from "../domain/proof.js";
import type { Locale } from "../domain/user.js";
import type { UserRepositoryPort } from "../../application/ports/repositories.js";

export interface RandomProvider {
  secureBytes(length: number): Uint8Array;
}

export interface VerificationHashProvider {
  readonly version: DigestAlgorithmVersion;
  digest(proof: VerificationProof, purpose: VerificationPurpose): TokenDigest;
}

export interface Clock {
  now(): string;
}

export interface EmailVerificationRepositoryPort {
  findByDigest(purpose: VerificationPurpose, version: DigestAlgorithmVersion, digest: TokenDigest): EmailVerificationWorkflow | null;
  findCurrent(authenticationIdentityId: string, purpose: VerificationPurpose): EmailVerificationWorkflow | null;
  create(workflow: EmailVerificationWorkflow): EmailVerificationWorkflow;
  update(workflow: EmailVerificationWorkflow, expectedStatus: EmailVerificationWorkflow["status"]): boolean;
  setDeliveryStatus(id: string, status: VerificationDeliveryStatus, updatedAt: string): boolean;
}

export interface IdentityRepositories {
  users: UserRepositoryPort;
  verifications: EmailVerificationRepositoryPort;
}

export interface IdentityTransactionPort {
  execute<T>(operation: (repositories: IdentityRepositories) => T): T;
}

export type VerificationDeliveryOutcome = "accepted" | "temporary_failure" | "permanent_failure" | "uncertain";

export interface EmailVerificationDeliveryRequest {
  recipient: EmailAddress;
  locale: Locale;
  verificationUrl: string;
  expiresAt: string;
  workflowId: string;
}

export interface EmailVerificationDeliveryPort {
  deliver(request: EmailVerificationDeliveryRequest): Promise<VerificationDeliveryOutcome>;
}
