import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../config/database.js";
import type { Clock, EmailVerificationDeliveryRequest, EmailVerificationDeliveryPort, VerificationDeliveryOutcome } from "../identity/application/ports.js";
import { ScryptPasswordProvider, SecureRandomProvider, Sha256VerificationHashProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider } from "../identity/infrastructure/securityProviders.js";
import { RegistrationService } from "../identity/services/registrationService.js";
import { VerifyEmailService } from "../identity/services/verifyEmailService.js";
import { AuthenticationService } from "../identity/services/authenticationService.js";
import { SqliteIdentityTransaction, SqliteAuthenticationTransaction } from "../repositories/identityTransaction.js";

class FixedClock implements Clock {
  public value = "2026-07-30T12:00:00.000Z";
  public now(): string { return this.value; }
}

class Delivery implements EmailVerificationDeliveryPort {
  public verification: EmailVerificationDeliveryRequest | null = null;
  public async deliver(request: EmailVerificationDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    this.verification = request;
    return "accepted";
  }
}

test("registration verification and login journey succeeds with original password", async () => {
  const database = createDatabase(":memory:"), clock = new FixedClock(), random = new SecureRandomProvider(), hash = new Sha256VerificationHashProvider(), passwords = new ScryptPasswordProvider(), delivery = new Delivery();
  const registration = new RegistrationService(new SqliteIdentityTransaction(database), random, hash, clock, delivery, "http://atlas.test", 3_600_000, passwords);
  const verificationService = new VerifyEmailService(new SqliteIdentityTransaction(database), hash, clock);
  const authentication = new AuthenticationService(
    new SqliteAuthenticationTransaction(database),
    random,
    new Sha256CredentialEnrollmentHashProvider(),
    passwords,
    new Sha256SessionIdentifierProvider(),
    clock,
    { deliver: async () => "accepted" },
    "http://atlas.test",
    false
  );

  const email = "journey@example.test";
  const password = "secure-acceptance-password-123";

  // 1. Register User
  await registration.register(email, "en", "Journey User", password, password);

  // Assert verification link structure is correct (using /verify-email publicly, not /identity/verify-email)
  assert.ok(delivery.verification);
  const verificationUrl = new URL(delivery.verification.verificationUrl);
  assert.equal(verificationUrl.pathname, "/verify-email");
  assert.ok(verificationUrl.searchParams.get("proof"));

  // 2. Capture verification proof
  const proof = verificationUrl.searchParams.get("proof")!;

  // 3. Verify email
  const verifyResult = verificationService.verify(proof);
  assert.equal(verifyResult, "verified");

  // 4. Verify DB state
  const user = database.prepare("SELECT status FROM users").get() as { status: string };
  assert.equal(user.status, "active");
  const identity = database.prepare("SELECT email_verified FROM authentication_identities").get() as { email_verified: number };
  assert.equal(identity.email_verified, 1);
  const verificationWorkflow = database.prepare("SELECT status FROM email_verifications").get() as { status: string };
  assert.equal(verificationWorkflow.status, "consumed");

  // 5. Login using original password
  const grant = await authentication.login(email, password, "127.0.0.1");
  assert.ok(grant.rawIdentifier);
  assert.equal(grant.csrfGeneration, 1);

  database.close();
});
