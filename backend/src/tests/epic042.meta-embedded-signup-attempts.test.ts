import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { migrationHead, runMigrations } from "../config/migrations.js";
import {
  assistantProfileId,
  reconstructAssistantProfile,
} from "../assistant/domain/assistantProfile.js";
import {
  reconstructUser,
  userId,
  type UserId,
} from "../identity/domain/user.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { MetaEmbeddedSignupAttemptRepository } from "../repositories/metaEmbeddedSignupAttemptRepository.js";
import { UserRepository } from "../repositories/userRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import {
  createWorkspaceContext,
  type WorkspaceContext,
} from "../types/workspaceContext.js";
import {
  HmacMetaEmbeddedSignupDigestProvider,
  MetaEmbeddedSignupAttemptService,
  metaEmbeddedSignupStateHmacKeyFromEnvironment,
} from "../whatsapp/application/metaEmbeddedSignupAttemptService.js";
import { SqlMetaEmbeddedSignupCompletionFinalizer } from "../whatsapp/application/metaEmbeddedSignupCompletionFinalizer.js";

const actor = userId("usr_epic042");
const now = "2026-08-22T12:00:00.000Z";

interface Fixture {
  database: ReturnType<typeof createDatabase>;
  service: MetaEmbeddedSignupAttemptService;
  repository: MetaEmbeddedSignupAttemptRepository;
  context: WorkspaceContext;
  companyId: number;
  profileId: string;
  clock: { now(): string; value: string };
}

function fixture(path = ":memory:"): Fixture {
  const database = createDatabase(path),
    workspaces = new WorkspaceRepository(database),
    context = createWorkspaceContext(workspaces.resolveDefault()),
    users = new UserRepository(database),
    companies = new CompanyRepository(database),
    profiles = new AssistantProfileRepository(database),
    clock = {
      value: now,
      now(): string {
        return this.value;
      },
    };
  users.create(
    reconstructUser({
      id: actor,
      status: "active",
      fullName: null,
      locale: "en",
      authenticationIdentities: [
        {
          id: "aid_epic042",
          email: "epic042@example.test",
          normalizedEmail: "epic042@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    }),
  );
  const company = companies.create(context, {
    name: "EPIC 042",
    website: "https://epic042.test",
    status: "ready",
  });
  const profile = reconstructAssistantProfile({
    id: assistantProfileId("asp_0123456789abcdef0123456789abcdef"),
    companyId: company.id,
    name: "Meta",
    normalizedName: "meta",
    description: null,
    businessRole: null,
    objective: null,
    audience: null,
    tone: "friendly",
    assistantLanguage: "en",
    welcomeMessage: null,
    fallbackMessage: "Fallback",
    status: "ready",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
  profiles.create(context, company.id, profile);
  const repository = new MetaEmbeddedSignupAttemptRepository(
    new LocalSqlDatabase(database),
  );
  return {
    database,
    repository,
    context,
    companyId: company.id,
    profileId: profile.id,
    clock,
    service: new MetaEmbeddedSignupAttemptService(
      repository,
      new HmacMetaEmbeddedSignupDigestProvider(Buffer.alloc(32, 42)),
      clock,
    ),
  };
}

async function start(value: Fixture) {
  return value.service.start(value.context, actor, value.companyId, {
    assistantProfileId: value.profileId,
  });
}

test("EPIC-042 migrations 0056-0058 are additive, tenant-scoped, and advance the immutable inventory", () => {
  const database = createDatabase(":memory:");
  try {
    const head = database
      .prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1")
      .get() as { id: number; name: string };
    assert.deepEqual(
      { ...head },
      { id: migrationHead.id, name: migrationHead.name },
    );
    assert.ok(
      database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='meta_embedded_signup_attempts'",
        )
        .get(),
    );
    const legacy = new DatabaseSync(":memory:");
    try {
      legacy.exec("PRAGMA foreign_keys=ON");
      runMigrations(legacy, 55);
      assert.equal(
        legacy.prepare("SELECT id FROM schema_migrations WHERE id=57").get(),
        undefined,
      );
      runMigrations(legacy);
      assert.equal(
        (
          legacy
            .prepare("SELECT COUNT(*) count FROM schema_migrations WHERE id=57")
            .get() as { count: number }
        ).count,
        1,
      );
    } finally {
      legacy.close();
    }
  } finally {
    database.close();
  }
});

test("EPIC-042 starts a bounded canonical attempt and stores only keyed digests", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      stored = value.database
        .prepare("SELECT * FROM meta_embedded_signup_attempts WHERE id=?")
        .get(launch.attemptId) as Record<string, unknown>;
    assert.equal(launch.provider, "meta_whatsapp");
    assert.equal(launch.kind, "cloud_api");
    assert.match(launch.state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(stored.state_digest === launch.state, false);
    assert.equal(JSON.stringify(stored).includes(launch.state), false);
    assert.equal(stored.completion_code_digest, null);
    assert.equal(Date.parse(launch.expiresAt) - Date.parse(now), 600_000);
    assert.equal(stored.status, "started");
  } finally {
    value.database.close();
  }
});

test("EPIC-042 scopes attempts by workspace, company, and initiating actor before state verification", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      foreignWorkspace = createWorkspaceContext(
        new WorkspaceRepository(value.database).createForSystemUse({
          key: "epic042-foreign",
          name: "Foreign",
        }),
      ),
      foreignCompany = new CompanyRepository(value.database).create(
        value.context,
        {
          name: "Foreign company",
          website: "https://foreign.test",
          status: "ready",
        },
      );
    assert.deepEqual(
      await value.service.claimCompletion(
        foreignWorkspace,
        actor,
        value.companyId,
        launch.attemptId,
        launch.state,
        "code",
      ),
      { kind: "not_found" },
    );
    assert.deepEqual(
      await value.service.claimCompletion(
        value.context,
        actor,
        foreignCompany.id,
        launch.attemptId,
        launch.state,
        "code",
      ),
      { kind: "not_found" },
    );
    assert.deepEqual(
      await value.service.claimCompletion(
        value.context,
        "usr_wrong" as UserId,
        value.companyId,
        launch.attemptId,
        launch.state,
        "code",
      ),
      { kind: "not_found" },
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 validates state before an atomic completion claim and never persists raw code", async () => {
  const value = fixture();
  try {
    const launch = await start(value);
    assert.deepEqual(
      await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        launch.attemptId,
        "wrong-state",
        "code-one",
      ),
      { kind: "replay_mismatch" },
    );
    const claim = await value.service.claimCompletion(
      value.context,
      actor,
      value.companyId,
      launch.attemptId,
      launch.state,
      "code-one",
    );
    assert.equal(claim.kind, "claimed");
    const stored = value.database
      .prepare(
        "SELECT status,completion_code_digest,claimed_at FROM meta_embedded_signup_attempts WHERE id=?",
      )
      .get(launch.attemptId) as Record<string, unknown>;
    assert.equal(stored.status, "completing");
    assert.equal(JSON.stringify(stored).includes("code-one"), false);
    assert.match(String(stored.completion_code_digest), /^[a-f0-9]{64}$/);
    assert.ok(stored.claimed_at);
    assert.deepEqual(
      await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        launch.attemptId,
        launch.state,
        "code-one",
      ),
      { kind: "already_claimed_same_completion" },
    );
    assert.deepEqual(
      await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        launch.attemptId,
        launch.state,
        "code-two",
      ),
      { kind: "replay_mismatch" },
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 concurrent completion claims have one durable winner", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      outcomes = await Promise.all([
        value.service.claimCompletion(
          value.context,
          actor,
          value.companyId,
          launch.attemptId,
          launch.state,
          "same-code",
        ),
        value.service.claimCompletion(
          value.context,
          actor,
          value.companyId,
          launch.attemptId,
          launch.state,
          "same-code",
        ),
      ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.kind === "claimed").length,
      1,
    );
    assert.equal(
      outcomes.filter(
        (outcome) => outcome.kind === "already_claimed_same_completion",
      ).length,
      1,
    );
    assert.equal(
      (
        value.database
          .prepare(
            "SELECT version FROM meta_embedded_signup_attempts WHERE id=?",
          )
          .get(launch.attemptId) as { version: number }
      ).version,
      2,
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 expires started and completing attempts without terminal resurrection", async () => {
  const value = fixture();
  try {
    const started = await start(value);
    value.clock.value = "2026-08-22T12:11:00.000Z";
    assert.deepEqual(
      await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        started.attemptId,
        started.state,
        "code",
      ),
      { kind: "expired" },
    );
    const expired = value.database
      .prepare(
        "SELECT status,safe_failure_code FROM meta_embedded_signup_attempts WHERE id=?",
      )
      .get(started.attemptId) as Record<string, unknown>;
    assert.deepEqual(
      { ...expired },
      { status: "expired", safe_failure_code: "expired" },
    );
    value.clock.value = now;
    const completing = await start(value);
    const claim = await value.service.claimCompletion(
      value.context,
      actor,
      value.companyId,
      completing.attemptId,
      completing.state,
      "code",
    );
    assert.equal(claim.kind, "claimed");
    value.clock.value = "2026-08-22T12:11:00.000Z";
    const result = await value.service.expire(
      value.context,
      actor,
      value.companyId,
      completing.attemptId,
      claim.kind === "claimed" ? claim.authority.attempt.version : 0,
    );
    assert.equal(result.kind, "applied");
    assert.equal(result.attempt?.status, "expired");
  } finally {
    value.database.close();
  }
});

test("EPIC-042 finalization is CAS-guarded, terminal, and stores safe failures only", async () => {
  const value = fixture();
  try {
    const launch = await start(value);
    assert.equal(
      (
        await value.service.markCompleted(
          value.context,
          actor,
          value.companyId,
          launch.attemptId,
          1,
        )
      ).kind,
      "conflict",
    );
    assert.equal(
      (
        await value.service.markFailed(
          value.context,
          actor,
          value.companyId,
          launch.attemptId,
          1,
          "provider_rejected",
        )
      ).kind,
      "applied",
    );
    const failed = value.database
      .prepare(
        "SELECT status,safe_failure_code,failed_at,completion_code_digest FROM meta_embedded_signup_attempts WHERE id=?",
      )
      .get(launch.attemptId) as Record<string, unknown>;
    assert.equal(failed.status, "failed");
    assert.equal(failed.safe_failure_code, "provider_rejected");
    assert.ok(failed.failed_at);
    assert.equal(failed.completion_code_digest, null);
    assert.equal(
      (
        await value.service.expire(
          value.context,
          actor,
          value.companyId,
          launch.attemptId,
          2,
        )
      ).kind,
      "conflict",
    );
    assert.equal(
      (
        await value.service.claimCompletion(
          value.context,
          actor,
          value.companyId,
          launch.attemptId,
          launch.state,
          "code",
        )
      ).kind,
      "replay_mismatch",
    );
    const complete = await start(value),
      claim = await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        complete.attemptId,
        complete.state,
        "completion-code",
      );
    assert.equal(claim.kind, "claimed");
    const completed = await value.service.markCompleted(
      value.context,
      actor,
      value.companyId,
      complete.attemptId,
      claim.kind === "claimed" ? claim.authority.attempt.version : 0,
    );
    assert.equal(completed.kind, "applied");
    assert.equal(completed.attempt?.status, "completed");
    assert.equal(
      (
        await value.service.expire(
          value.context,
          actor,
          value.companyId,
          complete.attemptId,
          completed.attempt?.version ?? 0,
        )
      ).kind,
      "conflict",
    );
    assert.equal(
      (
        await value.service.claimCompletion(
          value.context,
          actor,
          value.companyId,
          complete.attemptId,
          complete.state,
          "completion-code",
        )
      ).kind,
      "already_completed",
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 survives restart with durable claims, replay semantics, and terminal status", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic042-")),
    path = join(directory, "atlas.sqlite");
  let value = fixture(path);
  try {
    const launch = await start(value),
      companyId = value.companyId,
      profileId = value.profileId;
    value.database.close();
    const restartedDatabase = createDatabase(path),
      context = createWorkspaceContext(
        new WorkspaceRepository(restartedDatabase).resolveDefault(),
      ),
      clock = {
        value: now,
        now(): string {
          return this.value;
        },
      },
      repository = new MetaEmbeddedSignupAttemptRepository(
        new LocalSqlDatabase(restartedDatabase),
      ),
      restarted = new MetaEmbeddedSignupAttemptService(
        repository,
        new HmacMetaEmbeddedSignupDigestProvider(Buffer.alloc(32, 42)),
        clock,
      );
    const claim = await restarted.claimCompletion(
      context,
      actor,
      companyId,
      launch.attemptId,
      launch.state,
      "restart-code",
    );
    assert.equal(claim.kind, "claimed");
    restartedDatabase.close();
    const finalDatabase = createDatabase(path),
      finalContext = createWorkspaceContext(
        new WorkspaceRepository(finalDatabase).resolveDefault(),
      ),
      finalRepository = new MetaEmbeddedSignupAttemptRepository(
        new LocalSqlDatabase(finalDatabase),
      ),
      finalService = new MetaEmbeddedSignupAttemptService(
        finalRepository,
        new HmacMetaEmbeddedSignupDigestProvider(Buffer.alloc(32, 42)),
        clock,
      );
    assert.equal(
      (
        await finalService.claimCompletion(
          finalContext,
          actor,
          companyId,
          launch.attemptId,
          launch.state,
          "restart-code",
        )
      ).kind,
      "already_claimed_same_completion",
    );
    const completed = await finalService.markCompleted(
      finalContext,
      actor,
      companyId,
      launch.attemptId,
      claim.kind === "claimed" ? claim.authority.attempt.version : 0,
    );
    assert.equal(completed.kind, "applied");
    assert.equal(
      (
        await finalService.claimCompletion(
          finalContext,
          actor,
          companyId,
          launch.attemptId,
          launch.state,
          "restart-code",
        )
      ).kind,
      "already_completed",
    );
    assert.equal(profileId.startsWith("asp_"), true);
    finalDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("EPIC-042 safe projection and dedicated HMAC configuration expose no bearer material", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      record = await value.repository.find(
        value.context,
        value.companyId,
        actor,
        launch.attemptId,
      );
    assert.ok(record);
    const safe = value.service.safeProjection(record!);
    assert.deepEqual(Object.keys(safe).sort(), [
      "attemptId",
      "completedAt",
      "expiresAt",
      "hasReconnectTarget",
      "safeFailureCode",
      "status",
    ]);
    assert.equal(JSON.stringify(safe).includes(launch.state), false);
    assert.equal(JSON.stringify(safe).includes("digest"), false);
    assert.equal(
      metaEmbeddedSignupStateHmacKeyFromEnvironment({
        META_EMBEDDED_SIGNUP_STATE_HMAC_KEY: Buffer.alloc(32, 9).toString(
          "base64url",
        ),
      }).byteLength,
      32,
    );
    assert.throws(() =>
      metaEmbeddedSignupStateHmacKeyFromEnvironment({
        META_EMBEDDED_SIGNUP_STATE_HMAC_KEY: "short",
      }),
    );
    assert.equal(
      new HmacMetaEmbeddedSignupDigestProvider(
        Buffer.alloc(32, 3),
      ).matchesState(launch.state, record!.stateDigest),
      false,
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 reserves one immutable server-generated Integration Connection ID before creation", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      claim = await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        launch.attemptId,
        launch.state,
        "code",
      );
    assert.equal(claim.kind, "claimed");
    if (claim.kind !== "claimed") throw new Error("expected claim");
    const reserved = await value.service.reserveIntegrationConnection(
      value.context,
      actor,
      value.companyId,
      launch.attemptId,
      claim.authority.attempt.version,
    );
    assert.equal(reserved.kind, "applied");
    assert.match(
      reserved.attempt!.resolvedIntegrationConnectionId!,
      /^inc_[0-9a-f]{32}$/,
    );
    const replay = await value.service.reserveIntegrationConnection(
      value.context,
      actor,
      value.companyId,
      launch.attemptId,
      reserved.attempt!.version,
    );
    assert.equal(replay.kind, "replayed");
    assert.equal(
      replay.attempt!.resolvedIntegrationConnectionId,
      reserved.attempt!.resolvedIntegrationConnectionId,
    );
    assert.throws(() =>
      value.database
        .prepare(
          "UPDATE meta_embedded_signup_attempts SET resolved_integration_connection_id=NULL WHERE id=?",
        )
        .run(launch.attemptId),
    );
    assert.throws(() =>
      value.database
        .prepare(
          "UPDATE meta_embedded_signup_attempts SET resolved_integration_connection_id=? WHERE id=?",
        )
        .run("inc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", launch.attemptId),
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 finalizer atomically creates the inactive linked projection, replays, and rolls back a post-link fault", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      claim = await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        launch.attemptId,
        launch.state,
        "code",
      );
    if (claim.kind !== "claimed") throw new Error("expected claim");
    const reservation = await value.service.reserveIntegrationConnection(
      value.context,
      actor,
      value.companyId,
      launch.attemptId,
      claim.authority.attempt.version,
    );
    if (
      reservation.kind !== "applied" ||
      !reservation.attempt?.resolvedIntegrationConnectionId
    )
      throw new Error("expected reservation");
    const inc = reservation.attempt.resolvedIntegrationConnectionId,
      config = JSON.stringify({
        wabaId: "123",
        phoneNumberId: "456",
        graphApiVersion: "v25.0",
      });
    value.database
      .prepare(
        "INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        inc,
        value.context.workspaceId,
        value.companyId,
        "meta_whatsapp",
        "cloud_api",
        config,
        "inactive",
        1,
        now,
        now,
      );
    value.database
      .prepare("INSERT INTO integration_connection_secrets VALUES(?,?,?,?)")
      .run(inc, "ciphertext", now, now);
    value.database
      .prepare(
        "INSERT INTO integration_connection_operational_states VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(inc, "valid", now, null, "healthy", null, now, now);
    const input = {
      workspaceId: value.context.workspaceId,
      companyId: value.companyId,
      actorId: actor,
      attemptId: launch.attemptId,
      expectedAttemptVersion: reservation.attempt.version,
      integrationConnectionId: inc,
      whatsappBusinessAccountId: "123",
      phoneNumberId: "456",
      assistantProfileId: value.profileId,
      reconnectWhatsAppConnectionId: null,
      at: "2026-08-22T12:01:00.000Z",
    };
    const preconditions = [
      { workspaceId: input.workspaceId + 1, expected: "not_found" },
      { companyId: input.companyId + 1, expected: "not_found" },
      { actorId: userId("usr_other"), expected: "not_found" },
      {
        expectedAttemptVersion: input.expectedAttemptVersion + 1,
        expected: "conflict",
      },
    ] as const;
    const finalizer = new SqlMetaEmbeddedSignupCompletionFinalizer(
      new LocalSqlDatabase(value.database),
    );
    for (const precondition of preconditions) {
      const before = value.database
        .prepare(
          "SELECT status,completed_at,version FROM meta_embedded_signup_attempts WHERE id=?",
        )
        .get(launch.attemptId) as Record<string, unknown>;
      assert.equal(
        (await finalizer.finalize({ ...input, ...precondition })).kind,
        precondition.expected,
      );
      assert.equal(
        (
          value.database
            .prepare("SELECT count(*) count FROM whatsapp_connections")
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        {
          ...(value.database
            .prepare(
              "SELECT status,completed_at,version FROM meta_embedded_signup_attempts WHERE id=?",
            )
            .get(launch.attemptId) as Record<string, unknown>),
        },
        { ...before },
      );
      assert.equal(
        (
          value.database
            .prepare(
              "SELECT count(*) count FROM whatsapp_connection_credentials",
            )
            .get() as { count: number }
        ).count,
        0,
      );
    }
    value.database.exec(
      "CREATE TRIGGER epic042_finalizer_fault AFTER INSERT ON whatsapp_connections BEGIN SELECT RAISE(ABORT,'fault'); END;",
    );
    await assert.rejects(finalizer.finalize(input));
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connections")
          .get() as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        value.database
          .prepare(
            "SELECT status FROM meta_embedded_signup_attempts WHERE id=?",
          )
          .get(launch.attemptId) as { status: string }
      ).status,
      "completing",
    );
    value.database.exec("DROP TRIGGER epic042_finalizer_fault;");
    const applied = await finalizer.finalize(input);
    assert.equal(applied.kind, "applied");
    if (applied.kind !== "applied") throw new Error("expected applied");
    const connection = value.database
      .prepare(
        "SELECT integration_connection_id,status,phone_number_id,whatsapp_business_account_id FROM whatsapp_connections WHERE id=?",
      )
      .get(applied.whatsAppConnectionId) as Record<string, unknown>;
    assert.deepEqual(
      { ...connection },
      {
        integration_connection_id: inc,
        status: "inactive",
        phone_number_id: "456",
        whatsapp_business_account_id: "123",
      },
    );
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connection_credentials")
          .get() as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        value.database
          .prepare(
            "SELECT status FROM meta_embedded_signup_attempts WHERE id=?",
          )
          .get(launch.attemptId) as { status: string }
      ).status,
      "completed",
    );
    assert.deepEqual(await finalizer.finalize(input), {
      kind: "replayed",
      whatsAppConnectionId: applied.whatsAppConnectionId,
    });
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connections")
          .get() as { count: number }
      ).count,
      1,
    );
    for (const divergent of [
      { integrationConnectionId: "inc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { whatsappBusinessAccountId: "999" },
      { phoneNumberId: "999" },
      { reconnectWhatsAppConnectionId: "wac_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { actorId: userId("usr_other") },
    ])
      assert.equal(
        (await finalizer.finalize({ ...input, ...divergent })).kind,
        divergent.actorId ? "not_found" : "conflict",
      );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 finalizer rejects started and expired attempts before creating local runtime authority", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      finalizer = new SqlMetaEmbeddedSignupCompletionFinalizer(
        new LocalSqlDatabase(value.database),
      );
    const base = {
      workspaceId: value.context.workspaceId,
      companyId: value.companyId,
      actorId: actor,
      attemptId: launch.attemptId,
      expectedAttemptVersion: 1,
      integrationConnectionId: "inc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      whatsappBusinessAccountId: "123",
      phoneNumberId: "456",
      assistantProfileId: value.profileId,
      reconnectWhatsAppConnectionId: null,
      at: now,
    };
    assert.equal((await finalizer.finalize(base)).kind, "conflict");
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connections")
          .get() as { count: number }
      ).count,
      0,
    );
    const claim = await value.service.claimCompletion(
      value.context,
      actor,
      value.companyId,
      launch.attemptId,
      launch.state,
      "code",
    );
    if (claim.kind !== "claimed") throw new Error("expected claim");
    value.database
      .prepare(
        "UPDATE meta_embedded_signup_attempts SET expires_at=? WHERE id=?",
      )
      .run("2026-08-22T12:01:00.000Z", launch.attemptId);
    const expired = await finalizer.finalize({
      ...base,
      expectedAttemptVersion: claim.authority.attempt.version,
      at: "2026-08-22T12:02:00.000Z",
    });
    assert.equal(expired.kind, "expired");
    const attempt = value.database
      .prepare(
        "SELECT status,completed_at,version,resolved_integration_connection_id FROM meta_embedded_signup_attempts WHERE id=?",
      )
      .get(launch.attemptId) as Record<string, unknown>;
    assert.equal(attempt.status, "completing");
    assert.equal(attempt.completed_at, null);
    assert.equal(attempt.resolved_integration_connection_id, null);
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connections")
          .get() as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connection_credentials")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 finalizer preserves the immutable reserved Integration ID when it is missing or mismatched", async () => {
  const value = fixture();
  try {
    const launch = await start(value),
      claim = await value.service.claimCompletion(
        value.context,
        actor,
        value.companyId,
        launch.attemptId,
        launch.state,
        "code",
      );
    if (claim.kind !== "claimed") throw new Error("expected claim");
    const reserved = await value.service.reserveIntegrationConnection(
      value.context,
      actor,
      value.companyId,
      launch.attemptId,
      claim.authority.attempt.version,
    );
    if (
      reserved.kind !== "applied" ||
      !reserved.attempt?.resolvedIntegrationConnectionId
    )
      throw new Error("expected reservation");
    const input = {
        workspaceId: value.context.workspaceId,
        companyId: value.companyId,
        actorId: actor,
        attemptId: launch.attemptId,
        expectedAttemptVersion: reserved.attempt.version,
        integrationConnectionId:
          reserved.attempt.resolvedIntegrationConnectionId,
        whatsappBusinessAccountId: "123",
        phoneNumberId: "456",
        assistantProfileId: value.profileId,
        reconnectWhatsAppConnectionId: null,
        at: now,
      },
      finalizer = new SqlMetaEmbeddedSignupCompletionFinalizer(
        new LocalSqlDatabase(value.database),
      );
    for (const integrationConnectionId of [
      input.integrationConnectionId,
      "inc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ] as const) {
      assert.equal(
        (await finalizer.finalize({ ...input, integrationConnectionId })).kind,
        integrationConnectionId === input.integrationConnectionId
          ? "not_found"
          : "conflict",
      );
      const attempt = value.database
        .prepare(
          "SELECT status,completed_at,version,resolved_integration_connection_id FROM meta_embedded_signup_attempts WHERE id=?",
        )
        .get(launch.attemptId) as Record<string, unknown>;
      assert.equal(attempt.status, "completing");
      assert.equal(attempt.completed_at, null);
      assert.equal(
        attempt.resolved_integration_connection_id,
        input.integrationConnectionId,
      );
      assert.equal(
        (
          value.database
            .prepare("SELECT count(*) count FROM whatsapp_connections")
            .get() as { count: number }
        ).count,
        0,
      );
      assert.equal(
        (
          value.database
            .prepare(
              "SELECT count(*) count FROM whatsapp_connection_credentials",
            )
            .get() as { count: number }
        ).count,
        0,
      );
    }
  } finally {
    value.database.close();
  }
});

test("EPIC-042 finalizer rejects reserved Integration Connections with a non-Meta provider or non-Cloud kind", async () => {
  for (const [provider, kind] of [
    ["google_calendar", "cloud_api"],
    ["meta_whatsapp", "calendar"],
  ] as const) {
    const value = fixture();
    try {
      const launch = await start(value),
        claim = await value.service.claimCompletion(
          value.context,
          actor,
          value.companyId,
          launch.attemptId,
          launch.state,
          "code",
        );
      if (claim.kind !== "claimed") throw new Error("expected claim");
      const reserved = await value.service.reserveIntegrationConnection(
        value.context,
        actor,
        value.companyId,
        launch.attemptId,
        claim.authority.attempt.version,
      );
      if (
        reserved.kind !== "applied" ||
        !reserved.attempt?.resolvedIntegrationConnectionId
      )
        throw new Error("expected reservation");
      const inc = reserved.attempt.resolvedIntegrationConnectionId;
      value.database
        .prepare(
          "INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          inc,
          value.context.workspaceId,
          value.companyId,
          provider,
          kind,
          JSON.stringify({
            wabaId: "123",
            phoneNumberId: "456",
            graphApiVersion: "v25.0",
          }),
          "inactive",
          1,
          now,
          now,
        );
      const result = await new SqlMetaEmbeddedSignupCompletionFinalizer(
        new LocalSqlDatabase(value.database),
      ).finalize({
        workspaceId: value.context.workspaceId,
        companyId: value.companyId,
        actorId: actor,
        attemptId: launch.attemptId,
        expectedAttemptVersion: reserved.attempt.version,
        integrationConnectionId: inc,
        whatsappBusinessAccountId: "123",
        phoneNumberId: "456",
        assistantProfileId: value.profileId,
        reconnectWhatsAppConnectionId: null,
        at: now,
      });
      assert.equal(result.kind, "conflict");
      assert.equal(
        (
          value.database
            .prepare("SELECT count(*) count FROM whatsapp_connections")
            .get() as { count: number }
        ).count,
        0,
      );
      const attempt = value.database
        .prepare(
          "SELECT status,completed_at,resolved_integration_connection_id FROM meta_embedded_signup_attempts WHERE id=?",
        )
        .get(launch.attemptId) as Record<string, unknown>;
      assert.equal(attempt.status, "completing");
      assert.equal(attempt.completed_at, null);
      assert.equal(attempt.resolved_integration_connection_id, inc);
      assert.equal(
        (
          value.database
            .prepare(
              "SELECT count(*) count FROM whatsapp_connection_credentials",
            )
            .get() as { count: number }
        ).count,
        0,
      );
    } finally {
      value.database.close();
    }
  }
});

async function pass4aFinalization(
  value: Fixture,
  reconnectWhatsAppConnectionId: string | null = null,
  phoneNumberId = "456",
  wabaId = "123",
) {
  const launch = await value.service.start(
    value.context,
    actor,
    value.companyId,
    {
      assistantProfileId: value.profileId,
      targetWhatsAppConnectionId: reconnectWhatsAppConnectionId,
    },
  );
  const claim = await value.service.claimCompletion(
    value.context,
    actor,
    value.companyId,
    launch.attemptId,
    launch.state,
    "pass4a-code",
  );
  if (claim.kind !== "claimed") throw new Error("expected claim");
  const reserved = await value.service.reserveIntegrationConnection(
    value.context,
    actor,
    value.companyId,
    launch.attemptId,
    claim.authority.attempt.version,
  );
  if (
    reserved.kind !== "applied" ||
    !reserved.attempt?.resolvedIntegrationConnectionId
  )
    throw new Error("expected reservation");
  const inc = reserved.attempt.resolvedIntegrationConnectionId;
  value.database
    .prepare(
      "INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      inc,
      value.context.workspaceId,
      value.companyId,
      "meta_whatsapp",
      "cloud_api",
      JSON.stringify({ wabaId, phoneNumberId, graphApiVersion: "v25.0" }),
      "inactive",
      1,
      now,
      now,
    );
  value.database
    .prepare("INSERT INTO integration_connection_secrets VALUES(?,?,?,?)")
    .run(inc, "ciphertext", now, now);
  value.database
    .prepare(
      "INSERT INTO integration_connection_operational_states VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(inc, "valid", now, null, "healthy", null, now, now);
  return {
    launch,
    inc,
    input: {
      workspaceId: value.context.workspaceId,
      companyId: value.companyId,
      actorId: actor,
      attemptId: launch.attemptId,
      expectedAttemptVersion: reserved.attempt.version,
      integrationConnectionId: inc,
      whatsappBusinessAccountId: wabaId,
      phoneNumberId,
      assistantProfileId: value.profileId,
      reconnectWhatsAppConnectionId,
      at: "2026-08-22T12:01:00.000Z",
    },
  };
}
function pass4aInsertWac(
  value: Fixture,
  id: string,
  phone: string,
  waba: string,
  inc: string | null = null,
): void {
  value.database
    .prepare(
      "INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,integration_connection_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'inactive',?,?)",
    )
    .run(
      id,
      value.context.workspaceId,
      value.companyId,
      value.profileId,
      phone,
      waba,
      inc,
      now,
      now,
    );
}
function pass4aState(
  value: Fixture,
  attemptId: string,
): Record<string, unknown> {
  return {
    attempt: {
      ...(value.database
        .prepare(
          "SELECT status,completed_at,version,resolved_integration_connection_id FROM meta_embedded_signup_attempts WHERE id=?",
        )
        .get(attemptId) as Record<string, unknown>),
    },
    connections: (
      value.database
        .prepare(
          "SELECT id,workspace_id,company_id,phone_number_id,whatsapp_business_account_id,integration_connection_id,status FROM whatsapp_connections ORDER BY id",
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({ ...row })),
    credentials: (
      value.database
        .prepare(
          "SELECT * FROM whatsapp_connection_credentials ORDER BY whatsapp_connection_id",
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({ ...row })),
  };
}

test("EPIC-042 finalizer fails closed for missing secret and insufficient durable readiness with zero mutation", async () => {
  for (const condition of [
    "missing_secret",
    "not_validated",
    "invalid",
    "inactive_health",
  ] as const) {
    const value = fixture();
    try {
      const setup = await pass4aFinalization(value);
      if (condition === "missing_secret")
        value.database
          .prepare(
            "DELETE FROM integration_connection_secrets WHERE integration_connection_id=?",
          )
          .run(setup.inc);
      if (condition === "not_validated")
        value.database
          .prepare(
            "UPDATE integration_connection_operational_states SET validation_state='not_validated',validated_at=NULL WHERE integration_connection_id=?",
          )
          .run(setup.inc);
      if (condition === "invalid")
        value.database
          .prepare(
            "UPDATE integration_connection_operational_states SET validation_state='invalid',validation_failure_code='provider_rejected' WHERE integration_connection_id=?",
          )
          .run(setup.inc);
      if (condition === "inactive_health")
        value.database
          .prepare(
            "UPDATE integration_connection_operational_states SET health_state='inactive' WHERE integration_connection_id=?",
          )
          .run(setup.inc);
      const before = pass4aState(value, setup.launch.attemptId);
      assert.equal(
        (
          await new SqlMetaEmbeddedSignupCompletionFinalizer(
            new LocalSqlDatabase(value.database),
          ).finalize(setup.input)
        ).kind,
        "unready",
      );
      assert.deepEqual(pass4aState(value, setup.launch.attemptId), before);
      assert.equal(
        (
          value.database
            .prepare(
              "SELECT count(*) count FROM whatsapp_connection_credentials",
            )
            .get() as { count: number }
        ).count,
        0,
      );
    } finally {
      value.database.close();
    }
  }
});

test("EPIC-042 finalizer rejects stored WABA and phone configuration mismatches without mutation", async () => {
  for (const divergent of [
    { whatsappBusinessAccountId: "999" },
    { phoneNumberId: "999" },
  ] as const) {
    const value = fixture();
    try {
      const setup = await pass4aFinalization(value),
        before = pass4aState(value, setup.launch.attemptId);
      assert.equal(
        (
          await new SqlMetaEmbeddedSignupCompletionFinalizer(
            new LocalSqlDatabase(value.database),
          ).finalize({ ...setup.input, ...divergent })
        ).kind,
        "conflict",
      );
      assert.deepEqual(pass4aState(value, setup.launch.attemptId), before);
    } finally {
      value.database.close();
    }
  }
});

test("EPIC-042 finalizer never transfers a phone owned by another tenant or another same-tenant connection", async () => {
  for (const ownership of ["foreign_tenant", "same_tenant"] as const) {
    const value = fixture();
    try {
      const setup = await pass4aFinalization(value);
      if (ownership === "same_tenant")
        pass4aInsertWac(
          value,
          "wac_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "456",
          "123",
        );
      else {
        const foreignWorkspace = createWorkspaceContext(
            new WorkspaceRepository(value.database).createForSystemUse({
              key: "pass4a-foreign",
              name: "Foreign",
            }),
          ),
          foreignCompany = new CompanyRepository(value.database).create(
            foreignWorkspace,
            {
              name: "Foreign",
              website: "https://foreign-pass4a.test",
              status: "ready",
            },
          );
        const foreignProfile = reconstructAssistantProfile({
          id: assistantProfileId("asp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
          companyId: foreignCompany.id,
          name: "Foreign",
          normalizedName: "foreign",
          description: null,
          businessRole: null,
          objective: null,
          audience: null,
          tone: "friendly",
          assistantLanguage: "en",
          welcomeMessage: null,
          fallbackMessage: "Fallback",
          status: "ready",
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        });
        new AssistantProfileRepository(value.database).create(
          foreignWorkspace,
          foreignCompany.id,
          foreignProfile,
        );
        value.database
          .prepare(
            "INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'inactive',?,?)",
          )
          .run(
            "wac_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            foreignWorkspace.workspaceId,
            foreignCompany.id,
            foreignProfile.id,
            "456",
            "123",
            now,
            now,
          );
      }
      const before = pass4aState(value, setup.launch.attemptId);
      assert.equal(
        (
          await new SqlMetaEmbeddedSignupCompletionFinalizer(
            new LocalSqlDatabase(value.database),
          ).finalize(setup.input)
        ).kind,
        "conflict",
      );
      assert.deepEqual(pass4aState(value, setup.launch.attemptId), before);
    } finally {
      value.database.close();
    }
  }
});

test("EPIC-042 finalizer never transfers a reserved Integration Connection already linked to another projection", async () => {
  const value = fixture();
  try {
    const setup = await pass4aFinalization(value);
    pass4aInsertWac(
      value,
      "wac_cccccccccccccccccccccccccccccccc",
      "789",
      "123",
      setup.inc,
    );
    const before = pass4aState(value, setup.launch.attemptId);
    assert.equal(
      (
        await new SqlMetaEmbeddedSignupCompletionFinalizer(
          new LocalSqlDatabase(value.database),
        ).finalize(setup.input)
      ).kind,
      "conflict",
    );
    assert.deepEqual(pass4aState(value, setup.launch.attemptId), before);
  } finally {
    value.database.close();
  }
});

test("EPIC-042 exact same-phone reconnect preserves the wac route and links only the reserved Integration Connection", async () => {
  const value = fixture();
  try {
    const wac = "wac_dddddddddddddddddddddddddddddddd";
    pass4aInsertWac(value, wac, "456", "123");
    const setup = await pass4aFinalization(value, wac),
      result = await new SqlMetaEmbeddedSignupCompletionFinalizer(
        new LocalSqlDatabase(value.database),
      ).finalize(setup.input);
    assert.deepEqual(result, { kind: "applied", whatsAppConnectionId: wac });
    assert.deepEqual(
      {
        ...(value.database
          .prepare(
            "SELECT id,phone_number_id,whatsapp_business_account_id,integration_connection_id,status FROM whatsapp_connections WHERE id=?",
          )
          .get(wac) as Record<string, unknown>),
      },
      {
        id: wac,
        phone_number_id: "456",
        whatsapp_business_account_id: "123",
        integration_connection_id: setup.inc,
        status: "inactive",
      },
    );
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connections")
          .get() as { count: number }
      ).count,
      1,
    );
    assert.equal(
      (
        value.database
          .prepare(
            "SELECT status FROM meta_embedded_signup_attempts WHERE id=?",
          )
          .get(setup.launch.attemptId) as { status: string }
      ).status,
      "completed",
    );
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connection_credentials")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    value.database.close();
  }
});

test("EPIC-042 changed-phone reconnect requires asset change and leaves the old route and reserved link untouched", async () => {
  const value = fixture();
  try {
    const wac = "wac_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    pass4aInsertWac(value, wac, "456", "123");
    const setup = await pass4aFinalization(value, wac, "789"),
      before = pass4aState(value, setup.launch.attemptId);
    assert.equal(
      (
        await new SqlMetaEmbeddedSignupCompletionFinalizer(
          new LocalSqlDatabase(value.database),
        ).finalize(setup.input)
      ).kind,
      "asset_change_required",
    );
    assert.deepEqual(pass4aState(value, setup.launch.attemptId), before);
  } finally {
    value.database.close();
  }
});

test("EPIC-042 finalizer authority survives restart before success, after success, and after rollback", async () => {
  const directory = mkdtempSync(
      join(tmpdir(), "atlas-epic042-finalizer-restart-"),
    ),
    path = join(directory, "atlas.sqlite");
  let value = fixture(path);
  try {
    const setup = await pass4aFinalization(value),
      input = setup.input;
    value.database.close();
    let database = createDatabase(path),
      finalizer = new SqlMetaEmbeddedSignupCompletionFinalizer(
        new LocalSqlDatabase(database),
      );
    const applied = await finalizer.finalize(input);
    assert.equal(applied.kind, "applied");
    if (applied.kind !== "applied") throw new Error("expected applied");
    database.close();
    database = createDatabase(path);
    assert.deepEqual(
      await new SqlMetaEmbeddedSignupCompletionFinalizer(
        new LocalSqlDatabase(database),
      ).finalize(input),
      { kind: "replayed", whatsAppConnectionId: applied.whatsAppConnectionId },
    );
    database.close();
    value = fixture(join(directory, "rollback.sqlite"));
    const rollbackSetup = await pass4aFinalization(value);
    value.database.exec(
      "CREATE TRIGGER epic042_restart_fault AFTER INSERT ON whatsapp_connections BEGIN SELECT RAISE(ABORT,'restart fault'); END;",
    );
    await assert.rejects(
      new SqlMetaEmbeddedSignupCompletionFinalizer(
        new LocalSqlDatabase(value.database),
      ).finalize(rollbackSetup.input),
    );
    value.database.close();
    database = createDatabase(join(directory, "rollback.sqlite"));
    assert.equal(
      (
        database
          .prepare("SELECT count(*) count FROM whatsapp_connections")
          .get() as { count: number }
      ).count,
      0,
    );
    assert.deepEqual(
      {
        ...(database
          .prepare(
            "SELECT status,resolved_integration_connection_id FROM meta_embedded_signup_attempts WHERE id=?",
          )
          .get(rollbackSetup.launch.attemptId) as Record<string, unknown>),
      },
      {
        status: "completing",
        resolved_integration_connection_id: rollbackSetup.inc,
      },
    );
    assert.equal(
      (
        database
          .prepare("SELECT count(*) count FROM whatsapp_connection_credentials")
          .get() as { count: number }
      ).count,
      0,
    );
    database.exec("DROP TRIGGER epic042_restart_fault;");
    assert.equal(
      (
        await new SqlMetaEmbeddedSignupCompletionFinalizer(
          new LocalSqlDatabase(database),
        ).finalize(rollbackSetup.input)
      ).kind,
      "applied",
    );
    assert.equal(
      (
        database
          .prepare("SELECT integration_connection_id FROM whatsapp_connections")
          .get() as { integration_connection_id: string }
      ).integration_connection_id,
      rollbackSetup.inc,
    );
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("EPIC-042 linked credential resolution never falls back while legacy null links remain unchanged", async () => {
  const value = fixture();
  try {
    const [
      { WhatsAppConnectionRepository },
      { WhatsAppCredentialResolver },
      { AesGcmWhatsAppCredentialCipher },
      { AesGcmIntegrationSecretCipher },
    ] = await Promise.all([
      import("../repositories/whatsappConnectionRepository.js"),
      import("../whatsapp/services/WhatsAppCredentialResolver.js"),
      import("../whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js"),
      import("../integrations/infrastructure/aesGcmIntegrationSecretCipher.js"),
    ]);
    const legacyCipher = new AesGcmWhatsAppCredentialCipher(
        Buffer.alloc(32, 7),
      ),
      integrationCipher = new AesGcmIntegrationSecretCipher(
        Buffer.alloc(32, 8),
      ),
      repository = new WhatsAppConnectionRepository(value.database);
    const legacyId = "wac_ffffffffffffffffffffffffffffffff",
      linkedId = "wac_11111111111111111111111111111111";
    pass4aInsertWac(value, legacyId, "legacy-phone", "legacy-waba");
    value.database
      .prepare("INSERT INTO whatsapp_connection_credentials VALUES(?,?,?,?)")
      .run(legacyId, legacyCipher.encrypt("legacy-token"), now, now);
    const setup = await pass4aFinalization(
      value,
      null,
      "linked-phone",
      "linked-waba",
    );
    pass4aInsertWac(value, linkedId, "linked-phone", "linked-waba", setup.inc);
    value.database
      .prepare("INSERT INTO whatsapp_connection_credentials VALUES(?,?,?,?)")
      .run(linkedId, legacyCipher.encrypt("must-not-fallback"), now, now);
    value.database
      .prepare(
        "DELETE FROM integration_connection_secrets WHERE integration_connection_id=?",
      )
      .run(setup.inc);
    const resolver = new WhatsAppCredentialResolver(
      repository,
      legacyCipher,
      "global-token",
      { repository, cipher: integrationCipher },
    );
    assert.equal(
      resolver.resolve(value.context, value.companyId, linkedId as never),
      null,
    );
    assert.equal(
      resolver.resolve(value.context, value.companyId, legacyId as never),
      "legacy-token",
    );
    assert.equal(
      (
        value.database
          .prepare(
            "SELECT integration_connection_id FROM whatsapp_connections WHERE id=?",
          )
          .get(legacyId) as { integration_connection_id: string | null }
      ).integration_connection_id,
      null,
    );
    assert.equal(
      (
        value.database
          .prepare("SELECT count(*) count FROM whatsapp_connection_credentials")
          .get() as { count: number }
      ).count,
      2,
    );
  } finally {
    value.database.close();
  }
});
