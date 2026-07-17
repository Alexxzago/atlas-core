import type { AuthenticationIdentityId, UserId } from "./user.js";

export type CredentialState = "active" | "replaced";
export type SessionState = "active" | "replaced" | "revoked" | "expired";
export type AuthenticationStrategy = "password";

export interface PasswordCredential {
  readonly id: string;
  readonly authenticationIdentityId: AuthenticationIdentityId;
  readonly state: CredentialState;
  readonly algorithm: "scrypt";
  readonly algorithmVersion: "scrypt-v1";
  readonly parameters: string;
  readonly salt: string;
  readonly confirmation: string;
  readonly credentialVersion: number;
  readonly createdAt: string;
  readonly replacedAt: string | null;
  readonly upgradedAt: string | null;
}

export interface Session {
  readonly id: string;
  readonly userId: UserId;
  readonly authenticationIdentityId: AuthenticationIdentityId;
  readonly strategy: AuthenticationStrategy;
  readonly authenticationVersion: number;
  readonly credentialVersion: number;
  readonly digestVersion: "sha256-v1";
  readonly identifierDigest: string;
  readonly csrfDigest: string;
  readonly csrfGeneration: number;
  readonly state: SessionState;
  readonly issuedAt: string;
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly predecessorId: string | null;
  readonly replacedAt: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
}

export class PasswordPolicyError extends Error {}

export interface CommonPasswordBlocklist {
  contains(password: string): boolean;
}

export class PasswordPolicy {
  public constructor(
    private readonly blocklist: CommonPasswordBlocklist,
    public readonly minimumCodePoints = 15,
    public readonly maximumCodePoints = 128,
  ) {}

  public validate(password: string, confirmation: string): void {
    if (password !== confirmation) throw new PasswordPolicyError("Password confirmation does not match.");
    const length = Array.from(password).length;
    if (length < this.minimumCodePoints || length > this.maximumCodePoints) {
      throw new PasswordPolicyError("Password length is outside the allowed range.");
    }
    if (this.blocklist.contains(password)) throw new PasswordPolicyError("Password is not permitted.");
  }
}

export class BuiltInCommonPasswordBlocklist implements CommonPasswordBlocklist {
  private readonly values = new Set(["password", "password123456", "123456789012345", "qwertyuiop12345", "letmeinletmeinlet"]);
  public contains(password: string): boolean { return this.values.has(password.normalize("NFKC").toLocaleLowerCase("en-US")); }
}

export function isSessionCurrent(session: Session, now: string): boolean {
  const instant = Date.parse(now);
  return session.state === "active" && instant < Date.parse(session.idleExpiresAt) && instant < Date.parse(session.absoluteExpiresAt);
}
