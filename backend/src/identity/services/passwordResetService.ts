import type { AuthenticationTransactionPort, Clock, PasswordHashProvider, PasswordResetDeliveryPort, RandomProvider, VerificationHashProvider } from "../application/ports.js";
import { createEmailAddress, createNormalizedEmail } from "../domain/email.js";
import { BuiltInCommonPasswordBlocklist, PasswordPolicy, type PasswordCredential } from "../domain/authentication.js";
import { consumeVerification, isVerificationCurrent, supersedeVerification } from "../domain/emailVerification.js";
import { parseVerificationProof } from "../domain/proof.js";
import { identityIdentifier, issuePasswordReset } from "./verificationIssuance.js";

export class PasswordResetError extends Error {}

export class PasswordResetService {
  private readonly policy = new PasswordPolicy(new BuiltInCommonPasswordBlocklist());
  public constructor(private readonly tx: AuthenticationTransactionPort, private readonly random: RandomProvider, private readonly hash: VerificationHashProvider, private readonly passwords: PasswordHashProvider, private readonly clock: Clock, private readonly delivery: PasswordResetDeliveryPort, private readonly origin: string, private readonly lifetimeMilliseconds = 30 * 60 * 1000) {}

  public async request(emailValue: string, localeValue: string): Promise<void> {
    let issued: { workflow: ReturnType<typeof issuePasswordReset>["workflow"]; proof: string; email: string; locale: "en" | "es" } | null = null;
    try {
      const email = createEmailAddress(emailValue);
      if (localeValue !== "en" && localeValue !== "es") return;
      issued = this.tx.execute(({ users, verifications, credentials }) => {
        const user = users.findByNormalizedEmail(createNormalizedEmail(email));
        const identity = user?.authenticationIdentities.find((candidate) => candidate.normalizedEmail === createNormalizedEmail(email) && candidate.emailVerified);
        if (!user || user.status !== "active" || !identity || !credentials.findCurrent(identity.id)) return null;
        const now = this.clock.now();
        const current = verifications.findCurrent(identity.id, "password_reset");
        if (current && !verifications.update(supersedeVerification(current, now), "pending")) return null;
        const next = issuePasswordReset(user.id, identity.id, this.random, this.hash, this.clock, this.lifetimeMilliseconds);
        verifications.create(next.workflow);
        return { workflow: next.workflow, proof: next.proof, email: identity.email, locale: user.locale };
      });
    } catch { return; }
    if (!issued) return;
    const url = new URL("/identity/password-reset/complete", this.origin);
    url.searchParams.set("proof", issued.proof);
    const outcome = await this.delivery.deliver({ recipient: createEmailAddress(issued.email), locale: issued.locale, resetUrl: url.toString(), expiresAt: issued.workflow.expiresAt, workflowId: issued.workflow.id });
    this.tx.execute(({ verifications }) => verifications.setDeliveryStatus(issued!.workflow.id, outcome, this.clock.now()));
  }

  public async complete(proofValue: string, password: string, confirmation: string): Promise<void> {
    this.policy.validate(password, confirmation);
    let proof;
    try { proof = parseVerificationProof(proofValue); } catch { throw new PasswordResetError(); }
    const protection = await this.passwords.protect(password);
    this.tx.execute(({ users, verifications, credentials, sessions }) => {
      const now = this.clock.now();
      const workflow = verifications.findByDigest("password_reset", this.hash.version, this.hash.digest(proof, "password_reset"));
      if (!workflow || !isVerificationCurrent(workflow, now)) throw new PasswordResetError();
      const user = users.findById(workflow.userId);
      const identity = user?.authenticationIdentities.find((candidate) => candidate.id === workflow.authenticationIdentityId && candidate.emailVerified);
      const current = identity ? credentials.findCurrent(identity.id) : null;
      if (!user || user.status !== "active" || !identity || !current) throw new PasswordResetError();
      if (!credentials.replace(this.credential(identity.id, current.credentialVersion + 1, protection, now), current.credentialVersion)) throw new PasswordResetError();
      if (!verifications.update(consumeVerification(workflow, now), "pending")) throw new PasswordResetError();
      const remaining = verifications.findCurrent(identity.id, "password_reset");
      if (remaining) verifications.update(supersedeVerification(remaining, now), "pending");
      sessions.revokeAll(user.id, now, "password_reset");
    });
  }

  private credential(identityId: PasswordCredential["authenticationIdentityId"], version: number, protection: Awaited<ReturnType<PasswordHashProvider["protect"]>>, now: string): PasswordCredential {
    return { id: identityIdentifier("aid", this.random).replace("aid_", "pwd_"), authenticationIdentityId: identityId, state: "active", ...protection, credentialVersion: version, createdAt: now, replacedAt: null, upgradedAt: null };
  }
}
