import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import type { Clock, EmailVerificationDeliveryPort, VerificationDeliveryOutcome } from "../identity/application/ports.js";
import { AuthenticationFailure, AuthenticationService } from "../identity/services/authenticationService.js";
import { RegistrationService } from "../identity/services/registrationService.js";
import { ResendEmailVerificationService } from "../identity/services/resendEmailVerificationService.js";
import { VerifyEmailService } from "../identity/services/verifyEmailService.js";
import { ScryptPasswordProvider, SecureRandomProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider, Sha256VerificationHashProvider } from "../identity/infrastructure/securityProviders.js";
import { SqliteAuthenticationTransaction, SqliteIdentityTransaction } from "../repositories/identityTransaction.js";

class FixedClock implements Clock { public now(): string { return "2026-09-03T00:00:00.000Z"; } }
class Delivery implements EmailVerificationDeliveryPort { public request: { verificationUrl: string } | null = null; public async deliver(request: Parameters<EmailVerificationDeliveryPort["deliver"]>[0]): Promise<VerificationDeliveryOutcome> { this.request = request; return "accepted"; } }

async function fixture(): Promise<{ database: ReturnType<typeof createDatabase>; authentication: AuthenticationService; resend: ResendEmailVerificationService; register(email: string): Promise<void>; password: string; }> {
  const database = createDatabase(":memory:"), clock = new FixedClock(), random = new SecureRandomProvider(), passwords = new ScryptPasswordProvider(), delivery = new Delivery(), password = "a valid durable password", hash = new Sha256VerificationHashProvider();
  const registration = new RegistrationService(new SqliteIdentityTransaction(database), random, hash, clock, delivery, "http://atlas.test", 3_600_000, passwords);
  const verification = new VerifyEmailService(new SqliteIdentityTransaction(database), hash, clock);
  const authentication = new AuthenticationService(new SqliteAuthenticationTransaction(database), random, new Sha256CredentialEnrollmentHashProvider(), passwords, new Sha256SessionIdentifierProvider(), clock, { deliver: async () => "accepted" }, "http://atlas.test", false);
  return { database, authentication, resend: new ResendEmailVerificationService(new SqliteIdentityTransaction(database), random, hash, clock, delivery, "http://atlas.test", 3_600_000, 60_000), password, async register(email: string): Promise<void> { await registration.register(email, "en", email, password, password); verification.verify(new URL(delivery.request!.verificationUrl).searchParams.get("proof")!); } };
}

test("EPIC047 composite login throttle blocks one identity without cross-throttling another on a shared peer", async () => {
  const value = await fixture();
  try {
    await value.register("a@example.test"); await value.register("b@example.test");
    for (let index = 0; index < 5; index += 1) await assert.rejects(() => value.authentication.login("a@example.test", "wrong password", "10.0.0.1"), AuthenticationFailure);
    await assert.rejects(() => value.authentication.login("a@example.test", value.password, "10.0.0.1"), AuthenticationFailure);
    await assert.doesNotReject(() => value.authentication.login("b@example.test", value.password, "10.0.0.1"));
    assert.deepEqual({ ...value.database.prepare("SELECT identity_key,origin_key,failure_count FROM login_throttles ORDER BY identity_key").get() as Record<string, unknown> }, { identity_key: "a@example.test", origin_key: "10.0.0.1", failure_count: 6 });
  } finally { value.database.close(); }
});

test("EPIC047 local peer throttling is deterministic, unknown identities remain generic, and success clears its composite row", async () => {
  const value = await fixture();
  try {
    await value.register("local@example.test");
    await assert.rejects(() => value.authentication.login("unknown@example.test", "wrong password", "127.0.0.1"), AuthenticationFailure);
    await assert.rejects(() => value.authentication.login("local@example.test", "wrong password", "127.0.0.1"), AuthenticationFailure);
    await assert.doesNotReject(() => value.authentication.login("local@example.test", value.password, "127.0.0.1"));
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM login_throttles WHERE identity_key='local@example.test' AND origin_key='127.0.0.1'").get() as { count: number }).count, 0);
  } finally { value.database.close(); }
});

test("EPIC047 registration, resend, and enrollment never create a client-origin throttle bucket", async () => {
  const value = await fixture();
  try {
    await value.resend.resend("flow@example.test", "en");
    await value.register("flow@example.test");
    await value.authentication.requestEnrollment("flow@example.test");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM login_throttles").get() as { count: number }).count, 0);
  } finally { value.database.close(); }
});
