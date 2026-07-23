import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Clock, PasswordHashProvider, RandomProvider, SessionIdentifierProvider } from "../application/ports.js";
import { createEmailAddress } from "../domain/email.js";
import { BuiltInCommonPasswordBlocklist, PasswordPolicy, type PasswordCredential, type Session } from "../domain/authentication.js";
import { createVerifiedUser, locale } from "../domain/user.js";
import type { Membership, MembershipId } from "../../workspace/domain/membership.js";
import type { PlatformBootstrapTransactionPort } from "../../repositories/platformBootstrapTransaction.js";

export class PlatformBootstrapError extends Error {}
export class PlatformBootstrapConflict extends Error {}

export interface PlatformBootstrapResult {
  readonly rawSessionIdentifier: string;
  readonly csrfToken: string;
  readonly csrfGeneration: number;
  readonly absoluteExpiresAt: string;
}

export class PlatformBootstrapService {
  private readonly passwordPolicy = new PasswordPolicy(new BuiltInCommonPasswordBlocklist());

  public constructor(
    private readonly transaction: PlatformBootstrapTransactionPort,
    private readonly random: RandomProvider,
    private readonly passwords: PasswordHashProvider,
    private readonly identifiers: SessionIdentifierProvider,
    private readonly clock: Clock,
    private readonly setupSecret: string,
    private readonly idleMilliseconds = 30 * 60 * 1000,
    private readonly absoluteMilliseconds = 12 * 60 * 60 * 1000,
  ) {}

  public initialized(): boolean {
    return this.transaction.execute((repositories) => repositories.isClaimed() || repositories.users.count() > 0);
  }

  public async bootstrap(input: { email: string; locale: string; password: string; confirmation: string; setupSecret: string }): Promise<PlatformBootstrapResult> {
    if (this.setupSecret.length < 32 || input.setupSecret.length !== this.setupSecret.length
      || !timingSafeEqual(Buffer.from(input.setupSecret), Buffer.from(this.setupSecret))) throw new PlatformBootstrapError();
    this.passwordPolicy.validate(input.password, input.confirmation);
    const email = createEmailAddress(input.email);
    const selectedLocale = locale(input.locale);
    const protection = await this.passwords.protect(input.password);
    const identifier = this.identifiers.create();
    const csrfToken = Buffer.from(this.random.secureBytes(32)).toString("base64url");
    const result = this.transaction.execute((repositories) => {
      if (repositories.isClaimed() || repositories.users.count() > 0) throw new PlatformBootstrapConflict();
      const workspace = repositories.workspaces.findByKey("default");
      if (!workspace || repositories.memberships.countActiveOwners(workspace.id) !== 0) throw new PlatformBootstrapConflict();
      const now = this.clock.now();
      const user = createVerifiedUser({
        userId: this.id("usr"), authenticationIdentityId: this.id("aid"), email, locale: selectedLocale, timestamp: now,
      });
      const identity = user.authenticationIdentities[0];
      if (!identity) throw new Error("Bootstrap user has no authentication identity.");
      const credential: PasswordCredential = {
        id: this.id("pwd"), authenticationIdentityId: identity.id, state: "active", ...protection,
        credentialVersion: 1, createdAt: now, replacedAt: null, upgradedAt: null,
      };
      const absoluteExpiresAt = new Date(Date.parse(now) + this.absoluteMilliseconds).toISOString();
      const session: Session = {
        id: this.id("ses"), userId: user.id, authenticationIdentityId: identity.id, strategy: "password",
        authenticationVersion: 1, credentialVersion: credential.credentialVersion, digestVersion: "sha256-v1",
        identifierDigest: identifier.digest, csrfDigest: this.identifiers.digestSecret(csrfToken, "csrf"), csrfGeneration: 1,
        state: "active", issuedAt: now, lastSeenAt: now,
        idleExpiresAt: new Date(Date.parse(now) + this.idleMilliseconds).toISOString(), absoluteExpiresAt,
        predecessorId: null, replacedAt: null, revokedAt: null, revocationReason: null,
      };
      const membership: Membership = {
        id: this.id("mem") as MembershipId, workspaceId: workspace.id, userId: user.id, role: "owner", status: "active", version: 1,
        createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null,
      };
      repositories.users.create(user);
      repositories.credentials.create(credential);
      repositories.memberships.create(membership);
      repositories.selections.save(user.id, workspace.id, now);
      repositories.sessions.create(session);
      if (!repositories.claim(user.id, now)) throw new PlatformBootstrapConflict();
      return { absoluteExpiresAt };
    });
    return { rawSessionIdentifier: identifier.raw, csrfToken, csrfGeneration: 1, absoluteExpiresAt: result.absoluteExpiresAt };
  }

  private id(prefix: string): string { return `${prefix}_${randomUUID().replaceAll("-", "")}`; }
}
