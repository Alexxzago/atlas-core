import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../config/database.js";
import { createEmailAddress, createNormalizedEmail, InvalidEmailAddressError, normalizeEmail } from "../identity/domain/email.js";
import { createPendingUser, InvalidIdentityStateError, reconstructUser, userId, type User } from "../identity/domain/user.js";
import { InvalidUserStatusTransitionError, transitionUserStatus } from "../identity/domain/userLifecyclePolicy.js";
import { NormalizedEmailAlreadyExistsError, UserRepository } from "../repositories/userRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";

const firstTimestamp = "2026-07-16T12:00:00.000Z";
const secondTimestamp = "2026-07-16T13:00:00.000Z";

function pendingUser(id: string, identityId: string, email: string): User {
  return createPendingUser({
    userId: id,
    authenticationIdentityId: identityId,
    email,
    locale: "en",
    timestamp: firstTimestamp,
  });
}

test("email validation and normalization are deterministic and provider neutral", () => {
  const email = createEmailAddress("  First.Last+tag@Example.COM  ");
  assert.equal(email, "First.Last+tag@Example.COM");
  assert.equal(normalizeEmail(email), "first.last+tag@example.com");
  assert.equal(createNormalizedEmail("FIRST.LAST+TAG@example.com"), "first.last+tag@example.com");
  assert.throws(() => createEmailAddress("not-an-email"), InvalidEmailAddressError);
  assert.throws(() => createEmailAddress("a..b@example.com"), InvalidEmailAddressError);
});

test("a pending user owns one unverified authentication identity", () => {
  const user = pendingUser("user-1", "identity-1", "Owner@Example.com");
  assert.equal(user.status, "pending_verification");
  assert.equal(user.locale, "en");
  assert.equal(user.authenticationIdentities.length, 1);
  assert.equal(user.authenticationIdentities[0]?.normalizedEmail, "owner@example.com");
  assert.equal(user.authenticationIdentities[0]?.emailVerified, false);
  assert.ok(Object.isFrozen(user));
  assert.ok(Object.isFrozen(user.authenticationIdentities));
});

test("user reconstruction rejects inconsistent identity state", () => {
  assert.throws(() => reconstructUser({
    id: "user-1",
    status: "pending_verification",
    locale: "en",
    authenticationIdentities: [],
    createdAt: firstTimestamp,
    updatedAt: firstTimestamp,
  }), InvalidIdentityStateError);

  assert.throws(() => reconstructUser({
    id: "user-1",
    status: "pending_verification",
    locale: "en",
    authenticationIdentities: [{
      id: "identity-1",
      email: "user@example.com",
      normalizedEmail: "different@example.com",
      emailVerified: false,
      createdAt: firstTimestamp,
      updatedAt: firstTimestamp,
    }],
    createdAt: firstTimestamp,
    updatedAt: firstTimestamp,
  }), InvalidIdentityStateError);
});

test("user lifecycle rejects activation without verification authority and treats deleted as terminal", () => {
  const pending = pendingUser("user-1", "identity-1", "user@example.com");
  assert.throws(
    () => transitionUserStatus(pending, "active", secondTimestamp),
    InvalidUserStatusTransitionError,
  );
  const disabled = transitionUserStatus(pending, "disabled", secondTimestamp);
  assert.equal(disabled.status, "disabled");
  assert.throws(
    () => transitionUserStatus(disabled, "active", "2026-07-16T13:30:00.000Z"),
    InvalidUserStatusTransitionError,
  );
  const deleted = transitionUserStatus(disabled, "deleted", "2026-07-16T14:00:00.000Z");
  assert.throws(
    () => transitionUserStatus(deleted, "active", "2026-07-16T15:00:00.000Z"),
    InvalidUserStatusTransitionError,
  );
});

test("user lifecycle supports every approved non-verification transition", () => {
  const active = reconstructUser({
    id: "user-active",
    status: "active",
    locale: "es",
    authenticationIdentities: [{
      id: "identity-active",
      email: "verified@example.com",
      normalizedEmail: "verified@example.com",
      emailVerified: true,
      createdAt: firstTimestamp,
      updatedAt: firstTimestamp,
    }],
    createdAt: firstTimestamp,
    updatedAt: firstTimestamp,
  });

  const locked = transitionUserStatus(active, "locked", secondTimestamp);
  assert.equal(transitionUserStatus(locked, "active", "2026-07-16T14:00:00.000Z").status, "active");
  assert.equal(transitionUserStatus(locked, "disabled", "2026-07-16T14:00:00.000Z").status, "disabled");
  assert.equal(transitionUserStatus(active, "disabled", secondTimestamp).status, "disabled");
  const verifiedDisabled = transitionUserStatus(active, "disabled", secondTimestamp);
  assert.equal(transitionUserStatus(verifiedDisabled, "active", "2026-07-16T14:00:00.000Z").status, "active");
  assert.equal(transitionUserStatus(active, "deleted", secondTimestamp).status, "deleted");
  assert.equal(transitionUserStatus(pendingUser("pending", "pending-identity", "pending@example.com"), "deleted", secondTimestamp).status, "deleted");
});

test("repository creates, retrieves, updates, and finds a complete user aggregate by normalized email", () => {
  const database = createDatabase(":memory:");
  const repository = new UserRepository(database);
  const user = pendingUser("user-1", "identity-1", "User@Example.com");

  repository.create(user);
  assert.deepEqual(repository.findById(user.id), user);
  assert.deepEqual(repository.findByNormalizedEmail(createNormalizedEmail("USER@example.COM")), user);
  assert.equal(repository.findById(userId("missing")), null);
  assert.equal(repository.findByNormalizedEmail(createNormalizedEmail("missing@example.com")), null);

  const disabled = transitionUserStatus(user, "disabled", secondTimestamp);
  assert.deepEqual(repository.update(disabled), disabled);
  assert.equal(repository.findById(user.id)?.status, "disabled");
  assert.equal(repository.update(pendingUser("missing", "missing-identity", "missing@example.com")), null);
  database.close();
});

test("repository reports a controlled normalized email uniqueness error", () => {
  const database = createDatabase(":memory:");
  const repository = new UserRepository(database);
  repository.create(pendingUser("user-1", "identity-1", "same@example.com"));
  assert.throws(
    () => repository.create(pendingUser("user-2", "identity-2", "SAME@EXAMPLE.COM")),
    NormalizedEmailAlreadyExistsError,
  );
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 1);
  database.close();
});

test("concurrent creation of the same normalized email has exactly one winner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-identity-concurrent-"));
  const path = join(directory, "atlas.sqlite");
  const firstDatabase = createDatabase(path);
  const secondDatabase = createDatabase(path);
  try {
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => new UserRepository(firstDatabase).create(
        pendingUser("user-1", "identity-1", "same@example.com"),
      )),
      Promise.resolve().then(() => new UserRepository(secondDatabase).create(
        pendingUser("user-2", "identity-2", "SAME@EXAMPLE.COM"),
      )),
    ]);

    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof NormalizedEmailAlreadyExistsError);
    const count = firstDatabase.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    assert.equal(count.count, 1);
    assert.ok(new UserRepository(firstDatabase).findByNormalizedEmail(createNormalizedEmail("same@example.com")));
  } finally {
    firstDatabase.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("identity repository point operations use indexes", () => {
  const database = createDatabase(":memory:");
  const byId = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM users WHERE id = ?").all("user-1") as Array<{ detail: string }>;
  const byEmail = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM authentication_identities WHERE normalized_email = ?")
    .all("user@example.com") as Array<{ detail: string }>;
  const identitiesByUser = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM authentication_identities WHERE user_id = ?")
    .all("user-1") as Array<{ detail: string }>;
  assert.ok(byId.some(({ detail }) => detail.includes("INDEX") && detail.includes("id")));
  assert.ok(byEmail.some(({ detail }) => detail.includes("INDEX") && detail.includes("normalized_email")));
  assert.ok(identitiesByUser.some(({ detail }) => detail.includes("idx_authentication_identities_user_id")));
  database.close();
});

test("identity migration is additive, creates no users, and preserves the default workspace", () => {
  const database = createDatabase(":memory:");
  const migrations = database.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all()
    .map((migration) => ({ ...(migration as { id: number; name: string }) }));
  assert.deepEqual(migrations, [
    { id: 1, name: "0001_baseline" },
    { id: 2, name: "0002_workspace_foundation" },
    { id: 3, name: "0003_identity_foundation" },
    { id: 4, name: "0004_email_verification" },
    { id: 5, name: "0005_authentication_sessions" },
    { id: 6, name: "0006_workspace_memberships_invitations" },
    { id: 7, name: "0007_assistant_profiles" },
    { id: 8, name: "0008_session_csrf_generation" },
  ]);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 0);
  assert.equal(new WorkspaceRepository(database).resolveDefault().key, "default");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("identity migration restarts safely with persisted aggregate state", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-identity-restart-"));
  const path = join(directory, "atlas.sqlite");
  try {
    const database = createDatabase(path);
    new UserRepository(database).create(pendingUser("user-1", "identity-1", "user@example.com"));
    database.close();

    const restarted = createDatabase(path);
    assert.equal((restarted.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count, 8);
    assert.equal(new UserRepository(restarted).findById(userId("user-1"))?.authenticationIdentities.length, 1);
    assert.deepEqual(restarted.prepare("PRAGMA foreign_key_check").all(), []);
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("identity migration rolls back fully when its schema cannot be completed", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-identity-rollback-"));
  const path = join(directory, "atlas.sqlite");
  try {
    createDatabase(path).close();
    const prepared = new DatabaseSync(path);
    prepared.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM schema_migrations WHERE id >= 3;
      DROP TABLE email_verifications;
      DROP TABLE authentication_identities;
      DROP TABLE users;
      CREATE TABLE authentication_identities (id TEXT PRIMARY KEY);
    `);
    prepared.close();

    assert.throws(() => createDatabase(path));
    const inspected = new DatabaseSync(path);
    const usersTable = inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    const migration = inspected.prepare("SELECT id FROM schema_migrations WHERE id = 3").get();
    assert.equal(usersTable, undefined);
    assert.equal(migration, undefined);
    inspected.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
