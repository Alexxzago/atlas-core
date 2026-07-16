import type { Clock, RandomProvider, VerificationHashProvider } from "../application/ports.js";
import { reconstructEmailVerification, type EmailVerificationWorkflow } from "../domain/emailVerification.js";
import { formatVerificationProof, type VerificationProof } from "../domain/proof.js";
import type { AuthenticationIdentityId, UserId } from "../domain/user.js";

export interface IssuedVerification {
  workflow: EmailVerificationWorkflow;
  proof: VerificationProof;
}

function identifier(prefix: string, random: RandomProvider): string {
  return `${prefix}_${Buffer.from(random.secureBytes(16)).toString("base64url")}`;
}

export function identityIdentifier(prefix: "usr" | "aid", random: RandomProvider): string {
  return identifier(prefix, random);
}

export function issueEmailVerification(
  userId: UserId,
  authenticationIdentityId: AuthenticationIdentityId,
  random: RandomProvider,
  hash: VerificationHashProvider,
  clock: Clock,
  lifetimeMilliseconds: number,
): IssuedVerification {
  const now = clock.now();
  const proof = formatVerificationProof(random.secureBytes(32));
  return {
    proof,
    workflow: reconstructEmailVerification({
      id: identifier("evf", random),
      userId,
      authenticationIdentityId,
      purpose: "email_verification",
      digestVersion: hash.version,
      tokenDigest: hash.digest(proof, "email_verification"),
      status: "pending",
      deliveryStatus: "pending",
      issuedAt: now,
      expiresAt: new Date(Date.parse(now) + lifetimeMilliseconds).toISOString(),
      consumedAt: null,
      supersededAt: null,
      invalidatedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  };
}
