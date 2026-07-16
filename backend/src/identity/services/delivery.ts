import type { Clock, EmailVerificationDeliveryPort, IdentityTransactionPort, VerificationDeliveryOutcome } from "../application/ports.js";
import { invalidateVerification, type EmailVerificationWorkflow } from "../domain/emailVerification.js";
import type { EmailAddress } from "../domain/email.js";
import type { Locale } from "../domain/user.js";
import type { VerificationProof } from "../domain/proof.js";

export async function deliverVerification(
  workflow: EmailVerificationWorkflow,
  proof: VerificationProof,
  email: EmailAddress,
  locale: Locale,
  origin: string,
  delivery: EmailVerificationDeliveryPort,
  transaction: IdentityTransactionPort,
  clock: Clock,
): Promise<VerificationDeliveryOutcome> {
  const url = new URL("/identity/verify-email", origin);
  url.searchParams.set("proof", proof);
  const outcome = await delivery.deliver({ recipient: email, locale, verificationUrl: url.toString(), expiresAt: workflow.expiresAt, workflowId: workflow.id });
  const now = clock.now();
  transaction.execute(({ verifications }) => {
    if (outcome === "temporary_failure" || outcome === "permanent_failure") {
      const current = verifications.findByDigest(workflow.purpose, workflow.digestVersion, workflow.tokenDigest);
      if (current?.status === "pending") verifications.update(invalidateVerification(current, now), "pending");
    } else {
      verifications.setDeliveryStatus(workflow.id, outcome, now);
    }
  });
  return outcome;
}
