import type { Clock, EmailVerificationDeliveryPort, IdentityTransactionPort, PasswordHashProvider, RandomProvider, VerificationDeliveryOutcome, VerificationHashProvider } from "../application/ports.js";
import { createEmailAddress, createNormalizedEmail } from "../domain/email.js";
import { BuiltInCommonPasswordBlocklist, PasswordPolicy, type PasswordCredential } from "../domain/authentication.js";
import { createPendingUser, fullName, locale, type User } from "../domain/user.js";
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
    private readonly passwords?: PasswordHashProvider,
  ) {}

  public async register(emailValue: string, localeValue: string, nameValue?: string, password?: string, confirmation?: string): Promise<RegistrationResult> {
    const email = createEmailAddress(emailValue);
    const normalized = createNormalizedEmail(email);
    const selectedLocale = locale(localeValue);
    const name = nameValue === undefined ? null : fullName(nameValue);
    if (password !== undefined || confirmation !== undefined) new PasswordPolicy(new BuiltInCommonPasswordBlocklist()).validate(password ?? "", confirmation ?? "");
    if (name !== null && !this.passwords) throw new Error("Password provider is required for full registration.");
    const protection = name === null ? null : await this.passwords!.protect(password!);
    let created: { user: User; workflow: ReturnType<typeof issueEmailVerification>["workflow"]; proof: ReturnType<typeof issueEmailVerification>["proof"] } | null = null;
    try {
      created = this.transaction.execute(({ users, verifications, credentials }) => {
        if (users.findByNormalizedEmail(normalized)) return null;
        const now = this.clock.now();
        const user = createPendingUser({
          userId: identityIdentifier("usr", this.random),
          authenticationIdentityId: identityIdentifier("aid", this.random),
          email,
          fullName: name,
          locale: selectedLocale,
          timestamp: now,
        });
        const identity = user.authenticationIdentities[0];
        if (!identity) throw new Error("Pending User has no authentication identity.");
        const issued = issueEmailVerification(user.id, identity.id, this.random, this.hash, this.clock, this.lifetimeMilliseconds);
        users.create(user);
        if (protection) credentials.create(this.credential(identity.id, protection, now));
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

  private credential(identityId: PasswordCredential["authenticationIdentityId"], protection: Awaited<ReturnType<PasswordHashProvider["protect"]>>, now: string): PasswordCredential {
    return { id: identityIdentifier("aid", this.random).replace("aid_", "pwd_"), authenticationIdentityId: identityId, state: "active", ...protection, credentialVersion: 1, createdAt: now, replacedAt: null, upgradedAt: null };
  }
}
