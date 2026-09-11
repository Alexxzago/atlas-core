import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { runMigrations } from "../config/migrations.js";
import {
  conversationId,
  conversationMessageId,
  conversationParticipantId,
  reconstructConversation,
  reconstructConversationMessage,
  reconstructConversationParticipant,
} from "../conversation/domain/conversation.js";
import { reconstructConversationControl } from "../conversation/domain/conversationControl.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { OutboundDeliveryRepository } from "../repositories/outboundDeliveryRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";

const at = "2026-08-26T12:00:00.000Z";

function createConversation(
  repository: ConversationRepository,
  context: ReturnType<typeof createWorkspaceContext>,
  companyId: number,
  id = conversationId("cnv_04300000000000000000000000000001"),
) {
  return repository.createConversation(
    context,
    reconstructConversation({
      id,
      companyId,
      channel: "whatsapp",
      state: "open",
      createdAt: at,
      updatedAt: at,
      closedAt: null,
    }),
  )!;
}

test("EPIC043 migration 0059 upgrades controls additively and backfills authority generation", () => {
  const database = new DatabaseSync(":memory:");

  try {
    database.exec("PRAGMA foreign_keys = ON;");
    runMigrations(database, 58);

    const workspaces = new WorkspaceRepository(database);
    const context = createWorkspaceContext(workspaces.resolveDefault());
    const companies = new CompanyRepository(database);
    const company = companies.create(context, {
      name: "EPIC 043 Legacy",
      website: "https://epic043-legacy.test",
    });
    const conversations = new ConversationRepository(database);

    const conversation = createConversation(
      conversations,
      context,
      company.id,
    );

    database
      .prepare(`
        INSERT INTO conversation_controls(
          conversation_id,
          state,
          controlling_actor_id,
          last_controlling_actor_id,
          taken_at,
          released_at,
          last_operator_activity_at,
          attention_reason,
          resolved_at,
          resolved_by,
          version,
          created_at,
          updated_at
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      .run(
        conversation.id,
        "automated",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        1,
        at,
        at,
      );

    assert.equal(
      (
        database
          .prepare(
            "SELECT version FROM conversation_controls WHERE conversation_id=?",
          )
          .get(conversation.id) as { version: number }
      ).version,
      1,
    );

    const before = database
      .prepare("PRAGMA table_info(conversation_controls)")
      .all() as Array<{ name: string }>;

    assert.equal(
      before.some((column) => column.name === "authority_generation"),
      false,
    );

    runMigrations(database);

    const head = database
        .prepare(
          "SELECT id,name FROM schema_migrations WHERE id=59",
      )
      .get() as { id: number; name: string };

    assert.deepEqual(
      { ...head },
      {
        id: 59,
        name: "0059_conversation_handoff_authority",
      },
    );

    const migrated = database
      .prepare(
        "SELECT version,authority_generation FROM conversation_controls WHERE conversation_id=?",
      )
      .get(conversation.id) as {
      version: number;
      authority_generation: number;
    };

    assert.deepEqual(
      { ...migrated },
      {
        version: 1,
        authority_generation: 1,
      },
    );

    assert.ok(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_control_operations'",
        )
        .get(),
    );

    assert.ok(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_events'",
        )
        .get(),
    );

    assert.deepEqual(
      database.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
  } finally {
    database.close();
  }
});

test("EPIC043 operation and event ledgers are tenant-scoped, append-only, and monotonic", () => {
  const database = createDatabase(":memory:");

  try {
    const workspaces = new WorkspaceRepository(database);
    const primary = createWorkspaceContext(workspaces.resolveDefault());
    const secondary = createWorkspaceContext(
      workspaces.createForSystemUse({
        key: "epic043-secondary",
        name: "EPIC 043 Secondary",
      }),
    );
    const companies = new CompanyRepository(database);

    const first = companies.create(primary, {
      name: "EPIC 043 First",
      website: "https://epic043-first.test",
    });
    const second = companies.create(primary, {
      name: "EPIC 043 Second",
      website: "https://epic043-second.test",
    });
    const foreign = companies.create(secondary, {
      name: "EPIC 043 Foreign",
      website: "https://epic043-foreign.test",
    });

    const conversations = new ConversationRepository(database);
    const firstConversation = createConversation(
      conversations,
      primary,
      first.id,
    );

    createConversation(
      conversations,
      primary,
      second.id,
      conversationId("cnv_04300000000000000000000000000002"),
    );

    createConversation(
      conversations,
      secondary,
      foreign.id,
      conversationId("cnv_04300000000000000000000000000003"),
    );

    conversations.ensureConversationControl(
      primary,
      first.id,
      firstConversation.id,
    );

    database
      .prepare(`
        INSERT INTO conversation_control_operations(
          workspace_id,
          company_id,
          conversation_id,
          operation_id,
          actor_user_id,
          operation,
          request_fingerprint,
          expected_version,
          outcome,
          result_category,
          resulting_control_state,
          resulting_version,
          resulting_authority_generation,
          resulting_controller_relation,
          occurred_at
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      .run(
        primary.workspaceId,
        first.id,
        firstConversation.id,
        "op-043-takeover",
        "operator-1",
        "takeover",
        "a".repeat(64),
        1,
        "applied",
        "success",
        "human_controlled",
        2,
        2,
        "current_actor",
        at,
      );

    assert.throws(() =>
      database
        .prepare(`
          INSERT INTO conversation_control_operations(
            workspace_id,
            company_id,
            conversation_id,
            operation_id,
            actor_user_id,
            operation,
            request_fingerprint,
            expected_version,
            outcome,
            result_category,
            occurred_at
          )
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
        `)
        .run(
          primary.workspaceId,
          second.id,
          firstConversation.id,
          "op-043-wrong-scope",
          "operator-1",
          "takeover",
          "b".repeat(64),
          1,
          "applied",
          "success",
          at,
        ),
    );

    assert.throws(() =>
      database
        .prepare(`
          UPDATE conversation_control_operations
          SET outcome='stale_version'
          WHERE operation_id='op-043-takeover'
        `)
        .run(),
    );

    assert.throws(() =>
      database
        .prepare(`
          DELETE FROM conversation_control_operations
          WHERE operation_id='op-043-takeover'
        `)
        .run(),
    );

    const insertEvent = database.prepare(`
      INSERT INTO conversation_events(
        id,
        workspace_id,
        company_id,
        conversation_id,
        event_type,
        actor_user_id,
        control_version,
        authority_generation,
        related_message_id,
        related_operation_id,
        occurred_at
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `);

    insertEvent.run(
      "cev_043_1",
      primary.workspaceId,
      first.id,
      firstConversation.id,
      "takeover_applied",
      "operator-1",
      2,
      2,
      null,
      "op-043-takeover",
      at,
    );

    insertEvent.run(
      "cev_043_2",
      primary.workspaceId,
      first.id,
      firstConversation.id,
      "automation_blocked",
      null,
      2,
      2,
      null,
      null,
      at,
    );

    const events = database
      .prepare(`
        SELECT id,sequence
        FROM conversation_events
        WHERE workspace_id=? AND company_id=?
        ORDER BY sequence
      `)
      .all(primary.workspaceId, first.id) as Array<{
      id: string;
      sequence: number;
    }>;

    assert.equal(events.length, 2);
    assert.ok(events[1]!.sequence > events[0]!.sequence);

    assert.throws(() =>
      insertEvent.run(
        "cev_043_wrong_scope",
        primary.workspaceId,
        second.id,
        firstConversation.id,
        "automation_blocked",
        null,
        2,
        2,
        null,
        null,
        at,
      ),
    );

    assert.throws(() =>
      database
        .prepare(
          "UPDATE conversation_events SET event_type='automation_resumed' WHERE id='cev_043_1'",
        )
        .run(),
    );

    assert.throws(() =>
      database
        .prepare(
          "DELETE FROM conversation_events WHERE id='cev_043_1'",
        )
        .run(),
    );

    assert.deepEqual(
      database.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
  } finally {
    database.close();
  }
});
test("EPIC043 persists authority generation while operator activity changes neither authority counter", () => {
  const database = createDatabase(":memory:");

  try {
    const workspaces = new WorkspaceRepository(database);
    const context = createWorkspaceContext(workspaces.resolveDefault());
    const companies = new CompanyRepository(database);
    const company = companies.create(context, {
      name: "EPIC 043 Authority",
      website: "https://epic043-authority.test",
    });

    const conversations = new ConversationRepository(database);
    const conversation = createConversation(
      conversations,
      context,
      company.id,
      conversationId("cnv_04300000000000000000000000000004"),
    );

    const initial = conversations.ensureConversationControl(
      context,
      company.id,
      conversation.id,
    )!;

    assert.equal(initial.version, 1);
    assert.equal(initial.authorityGeneration, 1);

    const takeoverAt = "2026-08-26T12:01:00.000Z";

    const controlled = reconstructConversationControl({
      ...initial,
      state: "human_controlled",
      controllingActorId: "operator-1" as never,
      lastControllingActorId: "operator-1" as never,
      takenAt: takeoverAt,
      releasedAt: null,
      attentionReason: "operator_follow_up",
      resolvedAt: null,
      resolvedBy: null,
      version: 2,
      authorityGeneration: 2,
      updatedAt: takeoverAt,
    });

    const persisted = conversations.updateConversationControl(
      context,
      company.id,
      controlled,
      1,
    )!;

    assert.equal(persisted.version, 2);
    assert.equal(persisted.authorityGeneration, 2);

    const activityAt = "2026-08-26T12:02:00.000Z";

    const afterActivity = conversations.updateConversationOperatorActivity(
      context,
      company.id,
      conversation.id,
      "operator-1" as never,
      activityAt,
      activityAt,
    )!;

    assert.deepEqual(
      [
        afterActivity.version,
        afterActivity.authorityGeneration,
        afterActivity.lastOperatorActivityAt,
      ],
      [2, 2, activityAt],
    );

    const stored = database
      .prepare(
        "SELECT version,authority_generation,last_operator_activity_at FROM conversation_controls WHERE conversation_id=?",
      )
      .get(conversation.id) as {
      version: number;
      authority_generation: number;
      last_operator_activity_at: string;
    };

    assert.deepEqual(
      { ...stored },
      {
        version: 2,
        authority_generation: 2,
        last_operator_activity_at: activityAt,
      },
    );

    assert.equal(
      conversations.updateConversationOperatorActivity(
        context,
        company.id,
        conversation.id,
        "operator-2" as never,
        "2026-08-26T12:03:00.000Z",
        "2026-08-26T12:03:00.000Z",
      ),
      null,
    );
  } finally {
    database.close();
  }
});

test("EPIC043 control operations atomically persist transitions, rejections, and durable replays", () => {
  const database = createDatabase(":memory:");
  try {
    const workspaces = new WorkspaceRepository(database);
    const context = createWorkspaceContext(workspaces.resolveDefault());
    const company = new CompanyRepository(database).create(context, { name: "EPIC 043 Atomic", website: "https://epic043-atomic.test" });
    const repository = new ConversationRepository(database);
    const conversation = createConversation(repository, context, company.id, conversationId("cnv_04300000000000000000000000000005"));
    const take = { operationId: "op-043-atomic-take", operation: "takeover" as const, actorId: "operator-1" as never, expectedVersion: 1, occurredAt: at };
    const applied = repository.applyConversationControlOperation(context, company.id, conversation.id, take);
    assert.equal(applied.kind, "applied");
    assert.equal(applied.kind === "applied" && applied.control.state, "human_controlled");
    const stale = repository.applyConversationControlOperation(context, company.id, conversation.id, { ...take, operationId: "op-043-atomic-stale", expectedVersion: 1, occurredAt: "2026-08-26T12:01:00.000Z" });
    assert.deepEqual(stale.kind === "rejected" ? [stale.outcome, stale.control?.version] : [], ["stale_version", 2]);
    const replay = repository.applyConversationControlOperation(context, company.id, conversation.id, { ...take, operationId: "op-043-atomic-stale", expectedVersion: 1, occurredAt: "2026-08-26T12:02:00.000Z" });
    assert.deepEqual(replay.kind === "replayed" ? [replay.outcome, replay.control?.state, replay.control?.version] : [], ["stale_version", "human_controlled", 2]);
    const mismatch = repository.applyConversationControlOperation(context, company.id, conversation.id, { ...take, operationId: "op-043-atomic-stale", expectedVersion: 2, occurredAt: at });
    assert.equal(mismatch.kind, "replay_mismatch");
    const release = repository.applyConversationControlOperation(context, company.id, conversation.id, { operationId: "op-043-atomic-release", operation: "release", actorId: "operator-1" as never, expectedVersion: 2, occurredAt: "2026-08-26T12:03:00.000Z" });
    assert.equal(release.kind, "applied");
    const resolved = repository.applyConversationControlOperation(context, company.id, conversation.id, { operationId: "op-043-atomic-resolve", operation: "resolve", actorId: "operator-1" as never, expectedVersion: 3, occurredAt: "2026-08-26T12:04:00.000Z" });
    assert.deepEqual(resolved.kind === "rejected" ? [resolved.outcome, resolved.control?.state] : [], ["not_controller", "human_required"]);
    assert.deepEqual((database.prepare("SELECT outcome,result_category FROM conversation_control_operations WHERE conversation_id=? ORDER BY operation_id").all(conversation.id) as Array<Record<string, unknown>>).map((value) => ({ ...value })), [
      { outcome: "applied", result_category: "success" },
      { outcome: "not_controller", result_category: "not_found" },
      { outcome: "stale_version", result_category: "conflict" },
      { outcome: "applied", result_category: "success" },
    ]);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE conversation_id=?").get(conversation.id) as { count: number }).count, 4);
  } finally { database.close(); }
});

function concurrentFixture(suffix: string) {
  const directory = mkdtempSync(join(tmpdir(), `atlas-epic043-${suffix}-`));
  const path = join(directory, "atlas.sqlite");
  const first = createDatabase(path);
  const second = new DatabaseSync(path);
  second.exec("PRAGMA foreign_keys=ON");
  const workspaces = new WorkspaceRepository(first);
  const context = createWorkspaceContext(workspaces.resolveDefault());
  const company = new CompanyRepository(first).create(context, { name: `EPIC 043 ${suffix}`, website: `https://epic043-${suffix}.test` });
  const repository = new ConversationRepository(first);
  const conversation = createConversation(repository, context, company.id, conversationId("cnv_04300000000000000000000000000006"));
  const profileId = `apr_${suffix.padEnd(32, "0").slice(0, 32)}`;
  const connectionId = `wac_${suffix.padEnd(32, "0").slice(0, 32)}`;
  first.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(profileId, company.id, "Operator", "operator", "professional", "es", "Fallback", "ready", at, at, null);
  first.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, context.workspaceId, company.id, profileId, `phone-${suffix}`, `business-${suffix}`, "active", at, at);
  return { directory, first, second, context, company, conversation, connectionId, firstRepository: repository, secondRepository: new ConversationRepository(second) };
}

function take(repository: ConversationRepository, fixture: ReturnType<typeof concurrentFixture>, actor: string, operationId: string, expectedVersion = 1) {
  return repository.applyConversationControlOperation(fixture.context, fixture.company.id, fixture.conversation.id, { operationId, operation: "takeover", actorId: actor as never, expectedVersion, occurredAt: at });
}

test("EPIC043 serializes competing takeovers through two real SQLite connections", async () => {
  const value = concurrentFixture("race-take");
  try {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => take(value.firstRepository, value, "operator-1", "op-043-race-a")),
      Promise.resolve().then(() => take(value.secondRepository, value, "operator-2", "op-043-race-b")),
    ]);
    assert.deepEqual([first.kind, second.kind], ["applied", "rejected"]);
    assert.equal(second.kind === "rejected" && second.outcome, "stale_version");
    const control = value.firstRepository.findConversationControl(value.context, value.company.id, value.conversation.id)!;
    assert.deepEqual([control.state, control.controllingActorId, control.version, control.authorityGeneration], ["human_controlled", "operator-1", 2, 2]);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_control_operations WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 2);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 2);
    const replay = take(value.secondRepository, value, "operator-1", "op-043-race-a");
    assert.deepEqual(replay.kind === "replayed" ? [replay.outcome, replay.control?.state, replay.control?.version] : [], ["applied", "human_controlled", 2]);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 2);
  } finally { value.first.close(); value.second.close(); rmSync(value.directory, { recursive: true, force: true }); }
});

test("EPIC043 serializes operator send against release and resolve on real SQLite", async () => {
  for (const operation of ["release", "resolve"] as const) {
    const value = concurrentFixture(`send-${operation}`);
    try {
      assert.equal(take(value.firstRepository, value, "operator-1", `op-043-${operation}-take`).kind, "applied");
      const [sent, changed] = await Promise.all([
        Promise.resolve().then(() => value.firstRepository.persistOperatorMessage(value.context, value.company.id, value.conversation.id, "operator-1" as never, "Reply", `key-${operation}`, value.connectionId, at)),
        Promise.resolve().then(() => value.secondRepository.applyConversationControlOperation(value.context, value.company.id, value.conversation.id, { operationId: `op-043-${operation}`, operation, actorId: "operator-1" as never, expectedVersion: 2, occurredAt: "2026-08-26T12:01:00.000Z" })),
      ]);
      assert.equal(sent.kind, "created");
      assert.equal(changed.kind, "applied");
      assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 1);
      assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 1);
      assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 3);
      const oldController = value.secondRepository.persistOperatorMessage(value.context, value.company.id, value.conversation.id, "operator-1" as never, "Blocked", `blocked-${operation}`, value.connectionId, at);
      assert.equal(oldController.kind, "forbidden");
    } finally { value.first.close(); value.second.close(); rmSync(value.directory, { recursive: true, force: true }); }
  }
});

test("EPIC043 operator message idempotency is durable and does not duplicate committed artifacts", () => {
  const value = concurrentFixture("send-replay");
  try {
    take(value.firstRepository, value, "operator-1", "op-043-send-replay");
    const first = value.firstRepository.persistOperatorMessage(value.context, value.company.id, value.conversation.id, "operator-1" as never, "Once", "same-key", value.connectionId, at);
    const replay = value.secondRepository.persistOperatorMessage(value.context, value.company.id, value.conversation.id, "operator-1" as never, "Once", "same-key", value.connectionId, at);
    const divergent = value.secondRepository.persistOperatorMessage(value.context, value.company.id, value.conversation.id, "operator-1" as never, "Different", "same-key", value.connectionId, at);
    assert.deepEqual(first.kind === "created" && replay.kind === "replayed" ? [first.message.id, first.deliveryId, replay.message.id, replay.deliveryId] : [], first.kind === "created" ? [first.message.id, first.deliveryId, first.message.id, first.deliveryId] : []);
    assert.equal(divergent.kind, "idempotency_mismatch");
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id=?").get(value.conversation.id) as { count: number }).count, 1);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 1);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE conversation_id=? AND event_type='operator_message_created'").get(value.conversation.id) as { count: number }).count, 1);
    assert.equal(new OutboundDeliveryRepository(value.first).leaseReady("operator-replay-worker", at, "2026-08-26T13:00:00.000Z", 10).length, 1);
    assert.equal(new OutboundDeliveryRepository(value.second).leaseReady("operator-replay-worker-2", at, "2026-08-26T13:00:00.000Z", 10).length, 0);
  } finally { value.first.close(); value.second.close(); rmSync(value.directory, { recursive: true, force: true }); }
});

function finalizerFixture(suffix: string) {
  const value = concurrentFixture(`final-${suffix}`);
  const assistant = value.firstRepository.createParticipant(value.context, value.company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04300000000000000000000000000001"), conversationId: value.conversation.id, type: "assistant", reference: "assistant", createdAt: at }))!;
  const customer = value.firstRepository.createParticipant(value.context, value.company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_04300000000000000000000000000002"), conversationId: value.conversation.id, type: "opaque-customer", reference: null, createdAt: at }))!;
  const inbound = value.firstRepository.createMessage(value.context, value.company.id, reconstructConversationMessage({ id: conversationMessageId("cmsg_04300000000000000000000000000001"), conversationId: value.conversation.id, senderParticipantId: customer.id, direction: "inbound", content: "Question", idempotencyKey: `inbound-${suffix}`, executionRecordId: null, createdAt: at }))!;
  publishKnowledgeFixture(value.first, value.context, value.company.id, { company: { name: value.company.name, website: value.company.website ?? "", phone: "", email: "" }, business: { services: [], hours: "", locations: [] }, faq: [] });
  const knowledge = value.first.prepare("SELECT id FROM company_knowledge_versions WHERE company_id=? ORDER BY version_number DESC LIMIT 1").get(value.company.id) as { id: string };
  const profile = value.first.prepare("SELECT id FROM assistant_profiles WHERE company_id=? LIMIT 1").get(value.company.id) as { id: string };
  const recordId = "aex_04300000000000000000000000000001";
  value.first.prepare("INSERT INTO assistant_execution_records(id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,execution_snapshot_json,provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(recordId, value.company.id, profile.id, "{}", knowledge.id, JSON.stringify({ conversationId: value.conversation.id, authorityGeneration: 1 }), "test", "operational_execution", "answered", 0, "Answer", null, null, null, at, at, 0);
  return { ...value, assistant, inbound, recordId };
}

test("EPIC043 durable assistant finalizer fences provider completion after takeover from another SQLite connection", () => {
  const value = finalizerFixture("lost");
  try {
    assert.equal(take(value.secondRepository, value, "operator-1", "op-043-finalizer-take").kind, "applied");
    const first = value.firstRepository.finalizeAssistantResponse(value.context, value.company.id, value.conversation.id, value.inbound.id, value.assistant.id, value.recordId, 1, "Answer", "reply-finalizer", at, value.connectionId);
    const replay = value.secondRepository.finalizeAssistantResponse(value.context, value.company.id, value.conversation.id, value.inbound.id, value.assistant.id, value.recordId, 1, "Answer", "reply-finalizer", at, value.connectionId);
    assert.deepEqual([first.kind, replay.kind], ["authority_lost", "authority_lost"]);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE direction='outbound'").get() as { count: number }).count, 0);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='automation_blocked'").get() as { count: number }).count, 1);
    assert.equal(value.firstRepository.findConversationControl(value.context, value.company.id, value.conversation.id)?.controllingActorId, "operator-1");
  } finally { value.first.close(); value.second.close(); rmSync(value.directory, { recursive: true, force: true }); }
});

test("EPIC043 durable assistant finalizer commits once before a later takeover and replays without duplicates", () => {
  const value = finalizerFixture("win");
  try {
    const first = value.firstRepository.finalizeAssistantResponse(value.context, value.company.id, value.conversation.id, value.inbound.id, value.assistant.id, value.recordId, 1, "Answer", "reply-finalizer", at, value.connectionId);
    const replay = value.secondRepository.finalizeAssistantResponse(value.context, value.company.id, value.conversation.id, value.inbound.id, value.assistant.id, value.recordId, 1, "Answer", "reply-finalizer", at, value.connectionId);
    assert.deepEqual([first.kind, replay.kind], ["finalized", "replayed"]);
    assert.equal(take(value.secondRepository, value, "operator-1", "op-043-finalizer-after").kind, "applied");
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE direction='outbound'").get() as { count: number }).count, 1);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 1);
    assert.equal((value.first.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='assistant_message_created'").get() as { count: number }).count, 1);
    assert.equal(value.firstRepository.listConversationEventsAfter(value.context, value.company.id, 0, 100).filter((event) => event.type === "assistant_message_created").length, 1);
    assert.equal(new OutboundDeliveryRepository(value.first).leaseReady("assistant-replay-worker", at, "2026-08-26T13:00:00.000Z", 10).length, 1);
    assert.equal(new OutboundDeliveryRepository(value.second).leaseReady("assistant-replay-worker-2", at, "2026-08-26T13:00:00.000Z", 10).length, 0);
    assert.equal(value.firstRepository.findConversationControl(value.context, value.company.id, value.conversation.id)?.state, "human_controlled");
  } finally { value.first.close(); value.second.close(); rmSync(value.directory, { recursive: true, force: true }); }
});

test("EPIC043 finalizes and authorizes a WhatsApp reply while attention remains human-required", () => {
  const value = finalizerFixture("human-required");
  try {
    value.firstRepository.ensureConversationControl(value.context, value.company.id, value.conversation.id);
    value.first.prepare("UPDATE conversation_controls SET state='human_required',attention_reason='automation_failure',version=2 WHERE conversation_id=?").run(value.conversation.id);
    const finalized = value.firstRepository.finalizeAssistantResponse(value.context, value.company.id, value.conversation.id, value.inbound.id, value.assistant.id, value.recordId, 1, "Answer", "reply-human-required", at, value.connectionId);
    assert.equal(finalized.kind, "finalized");
    const delivery = new OutboundDeliveryRepository(value.first).leaseReady("human-required-worker", at, "2026-08-26T13:00:00.000Z", 1)[0]!;
    assert.equal(new OutboundDeliveryRepository(value.first).authorizeLease(delivery.id, "human-required-worker", at), true);
    assert.equal(new OutboundDeliveryRepository(value.first).beginSend(delivery.id, "human-required-worker", at), true);
    assert.equal(value.firstRepository.findConversationControl(value.context, value.company.id, value.conversation.id)?.state, "human_required");
  } finally { value.first.close(); value.second.close(); rmSync(value.directory, { recursive: true, force: true }); }
});
