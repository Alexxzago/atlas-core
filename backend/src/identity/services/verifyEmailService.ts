import type { Clock, IdentityTransactionPort, VerificationHashProvider } from "../application/ports.js";
import { authorizeCurrentEmailVerification, consumeVerification, isVerificationCurrent } from "../domain/emailVerification.js";
import { parseVerificationProof } from "../domain/proof.js";
import { activateUserFromEmailVerification } from "../domain/user.js";

export type VerifyEmailResult = "verified" | "invalid_or_expired";

export class VerifyEmailService {
  public constructor(
    private readonly transaction: IdentityTransactionPort,
    private readonly hash: VerificationHashProvider,
    private readonly clock: Clock,
  ) {}

  public async verify(proofValue: string): Promise<VerifyEmailResult> {
    let proof;
    try { proof = parseVerificationProof(proofValue); } catch { return "invalid_or_expired"; }
    const digest = this.hash.digest(proof, "email_verification");
    return this.transaction.execute(async ({ users, verifications }) => {
      const workflow = await verifications.findByDigest("email_verification", this.hash.version, digest);
      const now = this.clock.now();
      if (!workflow || !isVerificationCurrent(workflow, now)) return "invalid_or_expired";
      const user = await users.findById(workflow.userId);
      if (!user || user.status !== "pending_verification") return "invalid_or_expired";
      const activated = activateUserFromEmailVerification(user, authorizeCurrentEmailVerification(workflow, now), now);
      const consumed = consumeVerification(workflow, now);
      if (!await verifications.update(consumed, "pending")) return "invalid_or_expired";
      if (!await users.update(activated)) throw new Error("Verified User could not be persisted.");
      return "verified";
    });
  }
}
