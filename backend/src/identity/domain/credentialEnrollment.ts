import type { AuthenticationIdentityId, UserId } from "./user.js";

export type CredentialEnrollmentStatus = "pending" | "consumed" | "superseded" | "invalidated";
export interface CredentialEnrollment {
  readonly id: string;
  readonly userId: UserId;
  readonly authenticationIdentityId: AuthenticationIdentityId;
  readonly purpose: "credential_enrollment";
  readonly digestVersion: "sha256-v1";
  readonly proofDigest: string;
  readonly status: CredentialEnrollmentStatus;
  readonly deliveryStatus: "pending" | "accepted" | "temporary_failure" | "permanent_failure" | "uncertain";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly supersededAt: string | null;
  readonly invalidatedAt: string | null;
  readonly updatedAt: string;
}
