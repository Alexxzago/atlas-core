import type { Clock, EmailVerificationDeliveryPort, IdentityTransactionPort, RandomProvider, VerificationDeliveryOutcome, VerificationHashProvider } from "../application/ports.js";
import { createEmailAddress, createNormalizedEmail } from "../domain/email.js";
import { mayResendVerification, supersedeVerification } from "../domain/emailVerification.js";
import { locale } from "../domain/user.js";
import { deliverVerification } from "./delivery.js";
import { issueEmailVerification } from "./verificationIssuance.js";

export interface ResendResult { status: "verification_requested"; deliveryOutcome?: VerificationDeliveryOutcome }

export class ResendEmailVerificationService {
  public constructor(
    private readonly transaction: IdentityTransactionPort,
    private readonly random: RandomProvider,
    private readonly hash: VerificationHashProvider,
    private readonly clock: Clock,
    private readonly delivery: EmailVerificationDeliveryPort,
    private readonly verificationOrigin: string,
    private readonly lifetimeMilliseconds: number,
    private readonly cooldownMilliseconds: number,
  ) {}

  public async resend(emailValue: string, localeValue: string): Promise<ResendResult> {
    const email = createEmailAddress(emailValue);
    const normalized = createNormalizedEmail(email);
    const selectedLocale = locale(localeValue);
    const issued = this.transaction.execute(({ users, verifications }) => {
      const user = users.findByNormalizedEmail(normalized);
      if (!user || user.status !== "pending_verification") return null;
      const identity = user.authenticationIdentities.find((candidate) => candidate.normalizedEmail === normalized);
      if (!identity) return null;
      const current = verifications.findCurrent(identity.id, "email_verification");
      const now = this.clock.now();
      if (!mayResendVerification(current, now, this.cooldownMilliseconds)) return null;
      const replacement = issueEmailVerification(user.id, identity.id, this.random, this.hash, this.clock, this.lifetimeMilliseconds);
      if (current && !verifications.update(supersedeVerification(current, now), "pending")) return null;
      verifications.create(replacement.workflow);
      return replacement;
    });
    if (!issued) return { status: "verification_requested" };
    const outcome = await deliverVerification(issued.workflow, issued.proof, email, selectedLocale, this.verificationOrigin,
      this.delivery, this.transaction, this.clock);
    return { status: "verification_requested", deliveryOutcome: outcome };
  }
}
