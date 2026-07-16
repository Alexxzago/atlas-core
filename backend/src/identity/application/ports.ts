import type { EmailAddress } from "../domain/email.js";
import type { DigestAlgorithmVersion, EmailVerificationWorkflow, TokenDigest, VerificationDeliveryStatus, VerificationPurpose } from "../domain/emailVerification.js";
import type { VerificationProof } from "../domain/proof.js";
import type { Locale } from "../domain/user.js";
import type { UserRepositoryPort } from "../../application/ports/repositories.js";
import type { PasswordCredential, Session } from "../domain/authentication.js";
import type { CredentialEnrollment } from "../domain/credentialEnrollment.js";

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

export interface PasswordProtection { algorithm: "scrypt"; algorithmVersion: "scrypt-v1"; parameters: string; salt: string; confirmation: string; }
export interface PasswordVerificationResult { matches: boolean; needsUpgrade: boolean; }
export interface PasswordHashProvider { protect(password: string): Promise<PasswordProtection>; }
export interface PasswordVerificationProvider { verify(password: string, protection: PasswordProtection): Promise<PasswordVerificationResult>; dummyVerify(password: string): Promise<void>; }
export interface SessionIdentifier { raw: string; digest: string; digestVersion: "sha256-v1"; }
export interface SessionIdentifierProvider { create(): SessionIdentifier; parse(raw: string): SessionIdentifier | null; digestSecret(value: string, purpose: "csrf"): string; }
export interface CredentialEnrollmentHashProvider { digest(proof: VerificationProof): string; }
export interface PasswordCredentialRepositoryPort { findCurrent(authenticationIdentityId: string): PasswordCredential | null; create(value: PasswordCredential): PasswordCredential; replace(value: PasswordCredential, expectedVersion: number): boolean; }
export interface CredentialEnrollmentRepositoryPort { findCurrent(authenticationIdentityId: string): CredentialEnrollment | null; findByDigest(digest: string): CredentialEnrollment | null; create(value: CredentialEnrollment): CredentialEnrollment; update(value: CredentialEnrollment, expectedStatus: CredentialEnrollment["status"]): boolean; setDeliveryStatus(id: string, status: CredentialEnrollment["deliveryStatus"], updatedAt: string): boolean; }
export interface SessionRepositoryPort { findByDigest(digest: string): Session | null; create(value: Session): Session; replace(currentId: string, expectedState: Session["state"], replacement: Session): boolean; revoke(id: string, at: string, reason: string): boolean; revokeAll(userId: string, at: string, reason: string): number; touch(id: string, at: string, idleExpiresAt: string): boolean; }
export interface LoginThrottleRepositoryPort { recordFailure(identityKey: string, originKey: string, at: string, expiresAt: string): number; isBlocked(identityKey: string, originKey: string, now: string, maximum: number): boolean; clear(identityKey: string, originKey: string): void; cleanup(now: string): number; }
export interface AuthenticationRepositories extends IdentityRepositories { credentials: PasswordCredentialRepositoryPort; enrollments: CredentialEnrollmentRepositoryPort; sessions: SessionRepositoryPort; throttles: LoginThrottleRepositoryPort; }
export interface AuthenticationTransactionPort { execute<T>(operation: (repositories: AuthenticationRepositories) => T): T; }
export interface CredentialEnrollmentDeliveryRequest { recipient: EmailAddress; locale: Locale; enrollmentUrl: string; expiresAt: string; workflowId: string; }
export interface CredentialEnrollmentDeliveryPort { deliver(request: CredentialEnrollmentDeliveryRequest): Promise<VerificationDeliveryOutcome>; }
