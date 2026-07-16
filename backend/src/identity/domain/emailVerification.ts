import type { AuthenticationIdentityId, UserId } from "./user.js";

export type VerificationPurpose = "email_verification";
export type VerificationStatus = "pending" | "consumed" | "superseded" | "invalidated";
export type VerificationDeliveryStatus = "pending" | "accepted" | "temporary_failure" | "permanent_failure" | "uncertain";
export type EmailVerificationId = string & { readonly __brand: "EmailVerificationId" };
export type TokenDigest = string & { readonly __brand: "TokenDigest" };
export type DigestAlgorithmVersion = "sha256-v1";

export interface EmailVerificationWorkflow {
  readonly id: EmailVerificationId;
  readonly userId: UserId;
  readonly authenticationIdentityId: AuthenticationIdentityId;
  readonly purpose: VerificationPurpose;
  readonly digestVersion: DigestAlgorithmVersion;
  readonly tokenDigest: TokenDigest;
  readonly status: VerificationStatus;
  readonly deliveryStatus: VerificationDeliveryStatus;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly supersededAt: string | null;
  readonly invalidatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EmailVerificationWorkflowInput extends Omit<EmailVerificationWorkflow, "id"> {
  id: string;
}

export class InvalidVerificationWorkflowError extends Error {}

const emailVerificationAuthorityMarker = Symbol("EmailVerificationAuthority");
export interface EmailVerificationAuthority {
  readonly purpose: "email_verification";
  readonly userId: UserId;
  readonly authenticationIdentityId: AuthenticationIdentityId;
  readonly marker: typeof emailVerificationAuthorityMarker;
}

export function authorizeCurrentEmailVerification(
  workflow: EmailVerificationWorkflow,
  now: string,
): EmailVerificationAuthority {
  if (!isVerificationCurrent(workflow, now)) throw new InvalidVerificationWorkflowError("Verification cannot authorize activation.");
  return Object.freeze({
    purpose: "email_verification",
    userId: workflow.userId,
    authenticationIdentityId: workflow.authenticationIdentityId,
    marker: emailVerificationAuthorityMarker,
  });
}

export function isEmailVerificationAuthority(value: EmailVerificationAuthority): boolean {
  return value.marker === emailVerificationAuthorityMarker;
}

export function verificationPurpose(value: string): VerificationPurpose {
  if (value !== "email_verification") throw new InvalidVerificationWorkflowError("Verification purpose is unsupported.");
  return value;
}

export function emailVerificationId(value: string): EmailVerificationId {
  if (value.trim().length === 0) throw new InvalidVerificationWorkflowError("Verification workflow ID is required.");
  return value as EmailVerificationId;
}

export function tokenDigest(value: string): TokenDigest {
  if (value.length === 0) throw new InvalidVerificationWorkflowError("Token digest is required.");
  return value as TokenDigest;
}

export function reconstructEmailVerification(input: EmailVerificationWorkflowInput): EmailVerificationWorkflow {
  const issued = Date.parse(input.issuedAt);
  const expires = Date.parse(input.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) {
    throw new InvalidVerificationWorkflowError("Verification expiration is invalid.");
  }
  verificationPurpose(input.purpose);
  if (input.digestVersion !== "sha256-v1") throw new InvalidVerificationWorkflowError("Digest version is unsupported.");
  return Object.freeze({ ...input, id: emailVerificationId(input.id), tokenDigest: tokenDigest(input.tokenDigest) });
}

export function isVerificationCurrent(workflow: EmailVerificationWorkflow, now: string): boolean {
  return workflow.status === "pending" && Date.parse(now) < Date.parse(workflow.expiresAt);
}

export function mayResendVerification(
  workflow: EmailVerificationWorkflow | null,
  now: string,
  cooldownMilliseconds: number,
): boolean {
  if (!workflow) return true;
  return Date.parse(now) - Date.parse(workflow.issuedAt) >= cooldownMilliseconds;
}

export function supersedeVerification(workflow: EmailVerificationWorkflow, now: string): EmailVerificationWorkflow {
  if (workflow.status !== "pending") throw new InvalidVerificationWorkflowError("Only pending verification can be superseded.");
  return reconstructEmailVerification({ ...workflow, status: "superseded", supersededAt: now, updatedAt: now });
}

export function invalidateVerification(workflow: EmailVerificationWorkflow, now: string): EmailVerificationWorkflow {
  if (workflow.status !== "pending") throw new InvalidVerificationWorkflowError("Only pending verification can be invalidated.");
  return reconstructEmailVerification({ ...workflow, status: "invalidated", invalidatedAt: now, updatedAt: now });
}

export function consumeVerification(workflow: EmailVerificationWorkflow, now: string): EmailVerificationWorkflow {
  if (!isVerificationCurrent(workflow, now)) throw new InvalidVerificationWorkflowError("Verification is not current.");
  return reconstructEmailVerification({ ...workflow, status: "consumed", consumedAt: now, updatedAt: now });
}
