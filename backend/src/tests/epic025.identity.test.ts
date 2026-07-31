import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import type { Clock, EmailVerificationDeliveryRequest, EmailVerificationDeliveryPort, PasswordResetDeliveryPort, PasswordResetDeliveryRequest, VerificationDeliveryOutcome } from "../identity/application/ports.js";
import { ScryptPasswordProvider, SecureRandomProvider, Sha256VerificationHashProvider } from "../identity/infrastructure/securityProviders.js";
import { PasswordResetService } from "../identity/services/passwordResetService.js";
import { RegistrationService } from "../identity/services/registrationService.js";
import { VerifyEmailService } from "../identity/services/verifyEmailService.js";
import { SqliteAuthenticationTransaction, SqliteIdentityTransaction } from "../repositories/identityTransaction.js";

class FixedClock implements Clock { public value = "2026-07-30T12:00:00.000Z"; public now(): string { return this.value; } }
class Delivery implements EmailVerificationDeliveryPort, PasswordResetDeliveryPort {
  public verification: EmailVerificationDeliveryRequest | null = null;
  public reset: PasswordResetDeliveryRequest | null = null;
  public async deliver(request: EmailVerificationDeliveryRequest | PasswordResetDeliveryRequest): Promise<VerificationDeliveryOutcome> { if ("verificationUrl" in request) this.verification = request; else this.reset = request; return "accepted"; }
}

test("EPIC-025 migration 28 preserves legacy users and is restart-safe", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  runMigrations(database, 27);
  database.prepare("INSERT INTO users (id, status, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("usr_legacy", "active", "en", "2026-07-30T12:00:00.000Z", "2026-07-30T12:00:00.000Z");
  database.prepare("INSERT INTO authentication_identities (id, user_id, email, normalized_email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").run("aid_legacy", "usr_legacy", "legacy@example.test", "legacy@example.test", "2026-07-30T12:00:00.000Z", "2026-07-30T12:00:00.000Z");
  runMigrations(database);
  runMigrations(database);
  assert.equal((database.prepare("SELECT full_name FROM users WHERE id = 'usr_legacy'").get() as { full_name: string | null }).full_name, null);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = 28").get() as { count: number }).count, 1);
  database.close();
});

test("EPIC-025 registration atomically stores a pending named user, credential, and hashed email proof", async () => {
  const database = createDatabase(":memory:"), clock = new FixedClock(), random = new SecureRandomProvider(), hash = new Sha256VerificationHashProvider(), passwords = new ScryptPasswordProvider(), delivery = new Delivery();
  const registration = new RegistrationService(new SqliteIdentityTransaction(database), random, hash, clock, delivery, "http://atlas.test", 3_600_000, passwords);
  await registration.register("ada@example.test", "en", " Ada Lovelace ", "a sufficiently long unique password", "a sufficiently long unique password");
  const user = database.prepare("SELECT status, full_name FROM users").get() as { status: string; full_name: string };
  assert.equal(user.status, "pending_verification");
  assert.equal(user.full_name, "Ada Lovelace");
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM password_credentials").get() as { count: number }).count, 1);
  assert.equal((database.prepare("SELECT token_digest FROM email_verifications").get() as { token_digest: string }).token_digest.includes("a sufficiently"), false);
  const proof = new URL(delivery.verification!.verificationUrl).searchParams.get("proof")!;
  assert.equal(new VerifyEmailService(new SqliteIdentityTransaction(database), hash, clock).verify(proof), "verified");
  database.close();
});

test("EPIC-025 password reset is purpose-separated, superseded, single-use, and replaces the credential", async () => {
  const database = createDatabase(":memory:"), clock = new FixedClock(), random = new SecureRandomProvider(), hash = new Sha256VerificationHashProvider(), passwords = new ScryptPasswordProvider(), delivery = new Delivery();
  const registration = new RegistrationService(new SqliteIdentityTransaction(database), random, hash, clock, delivery, "http://atlas.test", 3_600_000, passwords);
  await registration.register("reset@example.test", "en", "Reset User", "an initial sufficiently long password", "an initial sufficiently long password");
  new VerifyEmailService(new SqliteIdentityTransaction(database), hash, clock).verify(new URL(delivery.verification!.verificationUrl).searchParams.get("proof")!);
  const reset = new PasswordResetService(new SqliteAuthenticationTransaction(database), random, hash, passwords, clock, delivery, "http://atlas.test");
  await reset.request("reset@example.test", "en");
  const first = new URL(delivery.reset!.resetUrl).searchParams.get("proof")!;
  await reset.request("reset@example.test", "en");
  const second = new URL(delivery.reset!.resetUrl).searchParams.get("proof")!;
  await assert.rejects(reset.complete(first, "a replacement sufficiently long password", "a replacement sufficiently long password"));
  await reset.complete(second, "a replacement sufficiently long password", "a replacement sufficiently long password");
  await assert.rejects(reset.complete(second, "another sufficiently long replacement", "another sufficiently long replacement"));
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE purpose = 'password_reset' AND status = 'consumed'").get() as { count: number }).count, 1);
  database.close();
});
