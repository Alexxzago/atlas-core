import type { EmailAddress, NormalizedEmail } from "../domain/email.js";
import type { DigestAlgorithmVersion, EmailVerificationWorkflow, TokenDigest, VerificationDeliveryStatus, VerificationPurpose } from "../domain/emailVerification.js";
import type { VerificationProof } from "../domain/proof.js";
import type { Locale, User, UserId } from "../domain/user.js";
import type { PasswordCredential, Session } from "../domain/authentication.js";
import type { CredentialEnrollment } from "../domain/credentialEnrollment.js";

export interface RandomProvider { secureBytes(length: number): Uint8Array; }
export interface VerificationHashProvider { readonly version: DigestAlgorithmVersion; digest(proof: VerificationProof, purpose: VerificationPurpose): TokenDigest; }
export interface Clock { now(): string; }
export interface IdentityUserRepositoryPort { findById(id: UserId): Promise<User | null>; findByNormalizedEmail(email: NormalizedEmail): Promise<User | null>; create(user: User): Promise<User>; update(user: User): Promise<User | null>; }
export interface EmailVerificationRepositoryPort { findByDigest(purpose: VerificationPurpose, version: DigestAlgorithmVersion, digest: TokenDigest): Promise<EmailVerificationWorkflow | null>; findCurrent(authenticationIdentityId: string, purpose: VerificationPurpose): Promise<EmailVerificationWorkflow | null>; create(workflow: EmailVerificationWorkflow): Promise<EmailVerificationWorkflow>; update(workflow: EmailVerificationWorkflow, expectedStatus: EmailVerificationWorkflow["status"]): Promise<boolean>; setDeliveryStatus(id: string, status: VerificationDeliveryStatus, updatedAt: string): Promise<boolean>; }
export interface PasswordCredentialRepositoryPort { findCurrent(authenticationIdentityId: string): Promise<PasswordCredential | null>; create(value: PasswordCredential): Promise<PasswordCredential>; replace(value: PasswordCredential, expectedVersion: number): Promise<boolean>; }
export interface CredentialEnrollmentRepositoryPort { findCurrent(authenticationIdentityId: string): Promise<CredentialEnrollment | null>; findByDigest(digest: string): Promise<CredentialEnrollment | null>; create(value: CredentialEnrollment): Promise<CredentialEnrollment>; update(value: CredentialEnrollment, expectedStatus: CredentialEnrollment["status"]): Promise<boolean>; setDeliveryStatus(id: string, status: CredentialEnrollment["deliveryStatus"], updatedAt: string): Promise<boolean>; }
export interface SessionRepositoryPort { findByDigest(digest: string): Promise<Session | null>; create(value: Session): Promise<Session>; replace(currentId: string, expectedState: Session["state"], replacement: Session): Promise<boolean>; rotateCsrf(id: string, expectedGeneration: number, csrfDigest: string, at: string, idleExpiresAt: string): Promise<boolean>; revoke(id: string, at: string, reason: string): Promise<boolean>; revokeAll(userId: string, at: string, reason: string): Promise<number>; touch(id: string, at: string, idleExpiresAt: string): Promise<boolean>; }
export interface LoginThrottleRepositoryPort { recordFailure(identityKey: string, originKey: string, at: string, expiresAt: string): Promise<number>; isBlocked(identityKey: string, originKey: string, now: string, maximum: number): Promise<boolean>; clear(identityKey: string, originKey: string): Promise<void>; cleanup(now: string): Promise<number>; }

export interface IdentityRepositories { users: IdentityUserRepositoryPort; verifications: EmailVerificationRepositoryPort; credentials: PasswordCredentialRepositoryPort; }
export interface AuthenticationRepositories extends IdentityRepositories { enrollments: CredentialEnrollmentRepositoryPort; sessions: SessionRepositoryPort; throttles: LoginThrottleRepositoryPort; }
export interface IdentityTransactionPort { execute<T>(operation: (repositories: IdentityRepositories) => Promise<T>): Promise<T>; }
export interface AuthenticationTransactionPort { execute<T>(operation: (repositories: AuthenticationRepositories) => Promise<T>): Promise<T>; }

export type VerificationDeliveryOutcome = "accepted" | "temporary_failure" | "permanent_failure" | "uncertain";
export interface EmailVerificationDeliveryRequest { recipient: EmailAddress; locale: Locale; verificationUrl: string; expiresAt: string; workflowId: string; }
export interface EmailVerificationDeliveryPort { deliver(request: EmailVerificationDeliveryRequest): Promise<VerificationDeliveryOutcome>; }
export interface PasswordResetDeliveryRequest { recipient: EmailAddress; locale: Locale; resetUrl: string; expiresAt: string; workflowId: string; }
export interface PasswordResetDeliveryPort { deliver(request: PasswordResetDeliveryRequest): Promise<VerificationDeliveryOutcome>; }
export interface PasswordProtection { algorithm: "scrypt"; algorithmVersion: "scrypt-v1"; parameters: string; salt: string; confirmation: string; }
export interface PasswordVerificationResult { matches: boolean; needsUpgrade: boolean; }
export interface PasswordHashProvider { protect(password: string): Promise<PasswordProtection>; }
export interface PasswordVerificationProvider { verify(password: string, protection: PasswordProtection): Promise<PasswordVerificationResult>; dummyVerify(password: string): Promise<void>; }
export interface SessionIdentifier { raw: string; digest: string; digestVersion: "sha256-v1"; }
export interface SessionIdentifierProvider { create(): SessionIdentifier; parse(raw: string): SessionIdentifier | null; digestSecret(value: string, purpose: "csrf"): string; }
export interface CredentialEnrollmentHashProvider { digest(proof: VerificationProof): string; }
export interface CredentialEnrollmentDeliveryRequest { recipient: EmailAddress; locale: Locale; enrollmentUrl: string; expiresAt: string; workflowId: string; }
export interface CredentialEnrollmentDeliveryPort { deliver(request: CredentialEnrollmentDeliveryRequest): Promise<VerificationDeliveryOutcome>; }
