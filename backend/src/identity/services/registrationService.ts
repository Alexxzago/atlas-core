import type { Clock, EmailVerificationDeliveryPort, IdentityTransactionPort, RandomProvider, VerificationDeliveryOutcome, VerificationHashProvider } from "../application/ports.js";
import { createEmailAddress, createNormalizedEmail } from "../domain/email.js";
import { createPendingUser, locale, type User } from "../domain/user.js";
import { NormalizedEmailAlreadyExistsError } from "../../repositories/userRepository.js";
import { deliverVerification } from "./delivery.js";
import { identityIdentifier, issueEmailVerification } from "./verificationIssuance.js";

export interface RegistrationResult {
  status: "verification_requested";
  deliveryOutcome?: VerificationDeliveryOutcome;
}

export class RegistrationService {
  public constructor(
    private readonly transaction: IdentityTransactionPort,
    private readonly random: RandomProvider,
    private readonly hash: VerificationHashProvider,
    private readonly clock: Clock,
    private readonly delivery: EmailVerificationDeliveryPort,
    private readonly verificationOrigin: string,
    private readonly lifetimeMilliseconds: number,
  ) {}

  public async register(emailValue: string, localeValue: string): Promise<RegistrationResult> {
    const email = createEmailAddress(emailValue);
    const normalized = createNormalizedEmail(email);
    const selectedLocale = locale(localeValue);
    let created: { user: User; workflow: ReturnType<typeof issueEmailVerification>["workflow"]; proof: ReturnType<typeof issueEmailVerification>["proof"] } | null = null;
    try {
      created = this.transaction.execute(({ users, verifications }) => {
        if (users.findByNormalizedEmail(normalized)) return null;
        const now = this.clock.now();
        const user = createPendingUser({
          userId: identityIdentifier("usr", this.random),
          authenticationIdentityId: identityIdentifier("aid", this.random),
          email,
          locale: selectedLocale,
          timestamp: now,
        });
        const identity = user.authenticationIdentities[0];
        if (!identity) throw new Error("Pending User has no authentication identity.");
        const issued = issueEmailVerification(user.id, identity.id, this.random, this.hash, this.clock, this.lifetimeMilliseconds);
        users.create(user);
        verifications.create(issued.workflow);
        return { user, workflow: issued.workflow, proof: issued.proof };
      });
    } catch (error: unknown) {
      if (error instanceof NormalizedEmailAlreadyExistsError) return { status: "verification_requested" };
      throw error;
    }
    if (!created) return { status: "verification_requested" };
    const outcome = await deliverVerification(created.workflow, created.proof, email, selectedLocale, this.verificationOrigin,
      this.delivery, this.transaction, this.clock);
    return { status: "verification_requested", deliveryOutcome: outcome };
  }
}
