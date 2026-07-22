import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { createDatabase } from "../config/database.js";
import { createRegistrationController, createResendVerificationController, createVerifyEmailController } from "../controllers/identityController.js";
import type { Clock, EmailVerificationDeliveryPort, RandomProvider, VerificationDeliveryOutcome, VerificationHashProvider } from "../identity/application/ports.js";
import { authorizeCurrentEmailVerification, consumeVerification, invalidateVerification, isVerificationCurrent, reconstructEmailVerification, supersedeVerification, verificationPurpose } from "../identity/domain/emailVerification.js";
import { formatVerificationProof, InvalidVerificationProofError, parseVerificationProof } from "../identity/domain/proof.js";
import { activateUserFromEmailVerification, createPendingUser, InvalidIdentityStateError, userId } from "../identity/domain/user.js";
import { DevelopmentVerificationDelivery } from "../identity/infrastructure/developmentVerificationDelivery.js";
import { SecureRandomProvider, Sha256VerificationHashProvider } from "../identity/infrastructure/securityProviders.js";
import { DeterministicRandomProvider, DeterministicVerificationHashProvider, InMemoryVerificationDelivery } from "../identity/infrastructure/testingAdapters.js";
import { RegistrationService } from "../identity/services/registrationService.js";
import { ResendEmailVerificationService } from "../identity/services/resendEmailVerificationService.js";
import { VerifyEmailService } from "../identity/services/verifyEmailService.js";
import { EmailVerificationRepository } from "../repositories/emailVerificationRepository.js";
import { SqliteIdentityTransaction } from "../repositories/identityTransaction.js";
import { UserRepository } from "../repositories/userRepository.js";
import { createIdentityRouter } from "../routes/identity.js";

class FixedClock implements Clock {
  public constructor(public value = "2026-07-16T12:00:00.000Z") {}
  public now(): string { return this.value; }
}

class ThrowingRandom implements RandomProvider {
  public secureBytes(): Uint8Array { throw new Error("RANDOM_UNAVAILABLE"); }
}

class ThrowingHash implements VerificationHashProvider {
  public readonly version = "sha256-v1" as const;
  public digest(): never { throw new Error("HASH_UNAVAILABLE"); }
}

function bytes(length: number, value: number): Uint8Array { return new Uint8Array(length).fill(value); }
function randomForRegistration(seed = 1): DeterministicRandomProvider {
  return new DeterministicRandomProvider([bytes(16, seed), bytes(16, seed + 1), bytes(32, seed + 2), bytes(16, seed + 3)]);
}
function randomForResend(seed = 10): DeterministicRandomProvider {
  return new DeterministicRandomProvider([bytes(32, seed), bytes(16, seed + 1)]);
}

function services(database: DatabaseSync, delivery: EmailVerificationDeliveryPort, clock = new FixedClock(), random = randomForRegistration()) {
  const transaction = new SqliteIdentityTransaction(database);
  const hash = new DeterministicVerificationHashProvider();
  return {
    clock,
    hash,
    transaction,
    registration: new RegistrationService(transaction, random, hash, clock, delivery, "http://atlas.test", 3_600_000),
    resend: (resendRandom = randomForResend()) => new ResendEmailVerificationService(
      transaction, resendRandom, hash, clock, delivery, "http://atlas.test", 3_600_000, 60_000,
    ),
    verify: new VerifyEmailService(transaction, hash, clock),
  };
}

function proofFrom(delivery: InMemoryVerificationDelivery, index = 0): string {
  const request = delivery.requests[index];
  assert.ok(request);
  return new URL(request.verificationUrl).searchParams.get("proof") ?? "";
}

test("verification purpose, proof formatting, workflow lifecycle and expiration are strict", () => {
  assert.equal(verificationPurpose("email_verification"), "email_verification");
  assert.throws(() => verificationPurpose("password_reset"));
  assert.throws(() => reconstructEmailVerification({
    id: "unsupported", userId: "user" as never, authenticationIdentityId: "identity" as never,
    purpose: "email_verification", digestVersion: "sha256-v2" as never, tokenDigest: "digest" as never,
    status: "pending", deliveryStatus: "pending", issuedAt: "2026-07-16T12:00:00.000Z",
    expiresAt: "2026-07-16T13:00:00.000Z", consumedAt: null, supersededAt: null,
    invalidatedAt: null, createdAt: "2026-07-16T12:00:00.000Z", updatedAt: "2026-07-16T12:00:00.000Z",
  }));
  const proof = formatVerificationProof(bytes(32, 1));
  assert.equal(proof, "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
  assert.equal(parseVerificationProof(proof), proof);
  assert.ok(!proof.includes("="));
  assert.throws(() => formatVerificationProof(bytes(31, 1)), InvalidVerificationProofError);
  assert.throws(() => parseVerificationProof(`${proof}=`), InvalidVerificationProofError);

  const workflow = reconstructEmailVerification({
    id: "evf-1", userId: "user-1" as never, authenticationIdentityId: "identity-1" as never,
    purpose: "email_verification", digestVersion: "sha256-v1", tokenDigest: "digest" as never,
    status: "pending", deliveryStatus: "pending", issuedAt: "2026-07-16T12:00:00.000Z",
    expiresAt: "2026-07-16T13:00:00.000Z", consumedAt: null, supersededAt: null,
    invalidatedAt: null, createdAt: "2026-07-16T12:00:00.000Z", updatedAt: "2026-07-16T12:00:00.000Z",
  });
  assert.equal(isVerificationCurrent(workflow, "2026-07-16T12:59:59.999Z"), true);
  assert.equal(isVerificationCurrent(workflow, workflow.expiresAt), false);
  assert.equal(consumeVerification(workflow, "2026-07-16T12:30:00.000Z").status, "consumed");
  assert.equal(supersedeVerification(workflow, "2026-07-16T12:30:00.000Z").status, "superseded");
  assert.equal(invalidateVerification(workflow, "2026-07-16T12:30:00.000Z").status, "invalidated");
});

test("only verification authority activates the matching pending User", () => {
  const user = createPendingUser({ userId: "user-1", authenticationIdentityId: "identity-1", email: "user@example.com", locale: "en", timestamp: "2026-07-16T12:00:00.000Z" });
  const workflow = reconstructEmailVerification({
    id: "evf-1", userId: user.id, authenticationIdentityId: user.authenticationIdentities[0]!.id,
    purpose: "email_verification", digestVersion: "sha256-v1", tokenDigest: "digest" as never,
    status: "pending", deliveryStatus: "accepted", issuedAt: "2026-07-16T12:00:00.000Z",
    expiresAt: "2026-07-16T13:00:00.000Z", consumedAt: null, supersededAt: null,
    invalidatedAt: null, createdAt: "2026-07-16T12:00:00.000Z", updatedAt: "2026-07-16T12:00:00.000Z",
  });
  const active = activateUserFromEmailVerification(user, authorizeCurrentEmailVerification(workflow, "2026-07-16T12:30:00.000Z"), "2026-07-16T12:30:00.000Z");
  assert.equal(active.status, "active");
  assert.equal(active.authenticationIdentities[0]?.emailVerified, true);
  const otherWorkflow = reconstructEmailVerification({ ...workflow, id: "evf-other", userId: userId("other") });
  assert.throws(() => activateUserFromEmailVerification(user, authorizeCurrentEmailVerification(otherWorkflow, "2026-07-16T12:30:00.000Z"), "2026-07-16T12:30:00.000Z"), InvalidIdentityStateError);
});

test("random providers enforce exact lengths, deterministic exhaustion and production entropy length", () => {
  const deterministic = new DeterministicRandomProvider([bytes(32, 7)]);
  assert.deepEqual(deterministic.secureBytes(32), bytes(32, 7));
  assert.throws(() => deterministic.secureBytes(32));
  assert.throws(() => new DeterministicRandomProvider([bytes(31, 1)]).secureBytes(32));
  assert.equal(new SecureRandomProvider().secureBytes(32).byteLength, 32);
  assert.throws(() => new SecureRandomProvider().secureBytes(0));
});

test("verification hashing is deterministic, purpose/version separated and matches a fixed vector", () => {
  const proof = formatVerificationProof(bytes(32, 1));
  const production = new Sha256VerificationHashProvider();
  assert.equal(production.digest(proof, "email_verification"), "1fa863361eef93da42b7e6bfa6a6a23f25d407f505bf1b6fce72de6d376e6685");
  const deterministic = new DeterministicVerificationHashProvider();
  assert.equal(deterministic.digest(proof, "email_verification"), `test:sha256-v1:email_verification:${proof}`);
  assert.notEqual(deterministic.digest(proof, "email_verification"), `test:sha256-v2:email_verification:${proof}`);
});

test("development delivery fails closed outside explicit development mode", () => {
  assert.throws(() => new DevelopmentVerificationDelivery("production", () => undefined));
  assert.doesNotThrow(() => new DevelopmentVerificationDelivery("development", () => undefined));
});

test("registration creates one pending User, persists no raw proof, and duplicate casing is generic", async () => {
  const database = createDatabase(":memory:");
  const delivery = new InMemoryVerificationDelivery();
  const setup = services(database, delivery);
  const first = await setup.registration.register("User@Example.com", "en");
  const duplicate = await setup.registration.register("USER@example.COM", "en");
  assert.equal(first.status, "verification_requested");
  assert.deepEqual(duplicate, { status: "verification_requested" });
  assert.equal(delivery.requests.length, 1);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 1);
  const proof = proofFrom(delivery);
  const stored = database.prepare("SELECT * FROM email_verifications").get() as Record<string, unknown>;
  assert.ok(!Object.values(stored).includes(proof));
  assert.equal("raw_token" in stored, false);
  database.close();
});

test("random and hash failures create neither persistence nor delivery", async () => {
  for (const provider of [new ThrowingRandom(), randomForRegistration()]) {
    const database = createDatabase(":memory:");
    const delivery = new InMemoryVerificationDelivery();
    const transaction = new SqliteIdentityTransaction(database);
    const service = new RegistrationService(transaction, provider,
      provider instanceof ThrowingRandom ? new DeterministicVerificationHashProvider() : new ThrowingHash(),
      new FixedClock(), delivery, "http://atlas.test", 3_600_000);
    await assert.rejects(service.register("user@example.com", "en"));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 0);
    assert.equal(delivery.requests.length, 0);
    database.close();
  }
});

test("registration records all delivery outcomes and invalidates definitive failures", async () => {
  const outcomes: VerificationDeliveryOutcome[] = ["accepted", "temporary_failure", "permanent_failure", "uncertain"];
  for (const [index, outcome] of outcomes.entries()) {
    const database = createDatabase(":memory:");
    const setup = services(database, new InMemoryVerificationDelivery(outcome), new FixedClock(), randomForRegistration(index + 1));
    const result = await setup.registration.register(`user${index}@example.com`, "en");
    assert.equal(result.deliveryOutcome, outcome);
    const status = (database.prepare("SELECT status FROM email_verifications").get() as { status: string }).status;
    assert.equal(status, outcome === "temporary_failure" || outcome === "permanent_failure" ? "invalidated" : "pending");
    database.close();
  }
});

test("resend is enumeration safe, enforces cooldown, supersedes and leaves one current proof", async () => {
  const database = createDatabase(":memory:");
  const delivery = new InMemoryVerificationDelivery();
  const setup = services(database, delivery);
  await setup.registration.register("user@example.com", "en");
  assert.deepEqual(await setup.resend().resend("missing@example.com", "en"), { status: "verification_requested" });
  assert.deepEqual(await setup.resend().resend("user@example.com", "en"), { status: "verification_requested" });
  assert.equal(delivery.requests.length, 1);
  setup.clock.value = "2026-07-16T12:01:00.000Z";
  const resent = await setup.resend().resend("USER@example.com", "es");
  assert.equal(resent.deliveryOutcome, "accepted");
  assert.equal(delivery.requests.length, 2);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE status = 'pending'").get() as { count: number }).count, 1);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE status = 'superseded'").get() as { count: number }).count, 1);
  database.close();
});

test("verification succeeds once and invalid, expired, superseded and invalidated proofs do not activate", async () => {
  const database = createDatabase(":memory:");
  const delivery = new InMemoryVerificationDelivery();
  const setup = services(database, delivery);
  await setup.registration.register("user@example.com", "en");
  const initialProof = proofFrom(delivery);
  setup.clock.value = "2026-07-16T12:01:00.000Z";
  await setup.resend().resend("user@example.com", "en");
  const currentProof = proofFrom(delivery, 1);
  assert.equal(setup.verify.verify(initialProof), "invalid_or_expired");
  assert.equal(setup.verify.verify("invalid"), "invalid_or_expired");
  assert.equal(setup.verify.verify(currentProof), "verified");
  assert.equal(setup.verify.verify(currentProof), "invalid_or_expired");
  const user = new UserRepository(database).findById((database.prepare("SELECT id FROM users").get() as { id: string }).id as never);
  assert.equal(user?.status, "active");
  assert.equal(user?.authenticationIdentities[0]?.emailVerified, true);
  assert.deepEqual(await setup.registration.register("USER@example.com", "en"), { status: "verification_requested" });
  assert.equal(delivery.requests.length, 2);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {count:number}).count,0);
  database.close();

  const expiredDb = createDatabase(":memory:");
  const expiredDelivery = new InMemoryVerificationDelivery();
  const expired = services(expiredDb, expiredDelivery);
  await expired.registration.register("expired@example.com", "en");
  expired.clock.value = "2026-07-16T13:00:00.000Z";
  assert.equal(expired.verify.verify(proofFrom(expiredDelivery)), "invalid_or_expired");
  assert.equal(new UserRepository(expiredDb).findByNormalizedEmail("expired@example.com" as never)?.status, "pending_verification");
  expiredDb.close();

  const invalidatedDb = createDatabase(":memory:");
  const failedDelivery = new InMemoryVerificationDelivery("permanent_failure");
  const invalidated = services(invalidatedDb, failedDelivery);
  await invalidated.registration.register("invalidated@example.com", "en");
  assert.equal(invalidated.verify.verify(proofFrom(failedDelivery)), "invalid_or_expired");
  assert.equal(new UserRepository(invalidatedDb).findByNormalizedEmail("invalidated@example.com" as never)?.status, "pending_verification");
  invalidatedDb.close();
});

test("concurrent resends supersede once and leave exactly one current workflow", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-0082-resend-"));
  const path = join(directory, "atlas.sqlite");
  const db1 = createDatabase(path);
  const db2 = createDatabase(path);
  try {
    const initialDelivery = new InMemoryVerificationDelivery();
    const initial = services(db1, initialDelivery);
    await initial.registration.register("user@example.com", "en");
    const clock = new FixedClock("2026-07-16T12:01:00.000Z");
    const delivery1 = new InMemoryVerificationDelivery();
    const delivery2 = new InMemoryVerificationDelivery();
    const hash = new DeterministicVerificationHashProvider();
    const resend1 = new ResendEmailVerificationService(new SqliteIdentityTransaction(db1), randomForResend(30), hash,
      clock, delivery1, "http://atlas.test", 3_600_000, 60_000);
    const resend2 = new ResendEmailVerificationService(new SqliteIdentityTransaction(db2), randomForResend(40), hash,
      clock, delivery2, "http://atlas.test", 3_600_000, 60_000);
    await Promise.all([resend1.resend("user@example.com", "en"), resend2.resend("USER@example.com", "es")]);
    assert.equal(delivery1.requests.length + delivery2.requests.length, 1);
    assert.equal((db1.prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE status = 'pending'").get() as { count: number }).count, 1);
    assert.equal((db1.prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE status = 'superseded'").get() as { count: number }).count, 1);
  } finally {
    db1.close(); db2.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent registration and verification each have exactly one successful state change", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-0082-concurrent-"));
  const path = join(directory, "atlas.sqlite");
  const db1 = createDatabase(path);
  const db2 = createDatabase(path);
  try {
    const delivery1 = new InMemoryVerificationDelivery();
    const delivery2 = new InMemoryVerificationDelivery();
    const s1 = services(db1, delivery1, new FixedClock(), randomForRegistration(1));
    const s2 = services(db2, delivery2, new FixedClock(), randomForRegistration(20));
    await Promise.all([s1.registration.register("same@example.com", "en"), s2.registration.register("SAME@example.com", "en")]);
    assert.equal((db1.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 1);
    assert.equal(delivery1.requests.length + delivery2.requests.length, 1);
    const proof = delivery1.requests.length ? proofFrom(delivery1) : proofFrom(delivery2);
    const results = await Promise.all([Promise.resolve().then(() => s1.verify.verify(proof)), Promise.resolve().then(() => s2.verify.verify(proof))]);
    assert.equal(results.filter((result) => result === "verified").length, 1);
    assert.equal(results.filter((result) => result === "invalid_or_expired").length, 1);
  } finally {
    db1.close(); db2.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 4 is restart safe, indexed, contains no raw token and rolls back on failure", () => {
  const database = createDatabase(":memory:");
  const columns = database.prepare("PRAGMA table_info(email_verifications)").all() as Array<{ name: string }>;
  assert.ok(columns.some(({ name }) => name === "token_digest"));
  assert.ok(!columns.some(({ name }) => name.includes("raw") || name === "token"));
  const digestPlan = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM email_verifications WHERE purpose = ? AND digest_version = ? AND token_digest = ?")
    .all("email_verification", "sha256-v1", "digest") as Array<{ detail: string }>;
  assert.ok(digestPlan.some(({ detail }) => detail.includes("INDEX")));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();

  const directory = mkdtempSync(join(tmpdir(), "atlas-0082-rollback-"));
  const path = join(directory, "atlas.sqlite");
  try {
    createDatabase(path).close();
    const prepared = new DatabaseSync(path);
    prepared.exec("DELETE FROM schema_migrations WHERE id = 4; DROP TABLE email_verifications; CREATE TABLE email_verifications (id TEXT PRIMARY KEY);");
    prepared.close();
    assert.throws(() => createDatabase(path));
    const inspected = new DatabaseSync(path);
    assert.equal(inspected.prepare("SELECT id FROM schema_migrations WHERE id = 4").get(), undefined);
    inspected.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("migration 4 upgrades migration-3 identity data and rejects checksum tampering", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-0082-upgrade-"));
  const path = join(directory, "atlas.sqlite");
  try {
    const initial = createDatabase(path);
    new UserRepository(initial).create(createPendingUser({
      userId: "preserved-user", authenticationIdentityId: "preserved-identity",
      email: "preserved@example.com", locale: "es", timestamp: "2026-07-16T12:00:00.000Z",
    }));
    initial.exec("DELETE FROM schema_migrations WHERE id = 4; DROP TABLE email_verifications;");
    initial.close();

    const upgraded = createDatabase(path);
    assert.equal(new UserRepository(upgraded).findById(userId("preserved-user"))?.locale, "es");
    assert.equal((upgraded.prepare("SELECT COUNT(*) AS count FROM workspaces WHERE key = 'default'").get() as { count: number }).count, 1);
    assert.equal((upgraded.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count, 10);
    upgraded.prepare("UPDATE schema_migrations SET checksum = ? WHERE id = 4").run("tampered");
    upgraded.close();
    assert.throws(() => createDatabase(path), /checksum mismatch/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("HTTP registration, resend and verification are controlled and leak no identity or workspace authority", async () => {
  const database = createDatabase(":memory:");
  const delivery = new InMemoryVerificationDelivery();
  const setup = services(database, delivery);
  const app = express();
  app.use(express.json());
  app.use("/identity", createIdentityRouter({
    register: createRegistrationController(setup.registration),
    resend: createResendVerificationController(setup.resend()),
    verify: createVerifyEmailController(setup.verify),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  try {
    const invalid = await fetch(`http://127.0.0.1:${port}/identity/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "bad", locale: "en" }) });
    assert.equal(invalid.status, 400);
    const invalidLocale = await fetch(`http://127.0.0.1:${port}/identity/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "user@example.com", locale: "fr" }) });
    assert.equal(invalidLocale.status, 400);
    const workspace = await fetch(`http://127.0.0.1:${port}/identity/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "user@example.com", locale: "en", workspaceId: 1 }) });
    assert.equal(workspace.status, 400);
    const registered = await fetch(`http://127.0.0.1:${port}/identity/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "user@example.com", locale: "en" }) });
    const body = await registered.json() as Record<string, unknown>;
    assert.equal(registered.status, 202);
    assert.deepEqual(body, { status: "verification_requested" });
    assert.equal("userId" in body, false);
    const resent = await fetch(`http://127.0.0.1:${port}/identity/resend-verification`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "missing@example.com", locale: "es" }) });
    assert.deepEqual(await resent.json(), { status: "verification_requested" });
    const verified = await fetch(`http://127.0.0.1:${port}/identity/verify-email?proof=${encodeURIComponent(proofFrom(delivery))}`);
    assert.deepEqual(await verified.json(), { status: "verified" });
    const replay = await fetch(`http://127.0.0.1:${port}/identity/verify-email?proof=${encodeURIComponent(proofFrom(delivery))}`);
    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { status: "invalid_or_expired" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  }
});
