import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationAuthorityDomainError,
  applyConversationAuthorityTransition,
  classifyConversationControlReplay,
  conversationControlEventType,
  conversationControlOperation,
  conversationControlOperationId,
  conversationControlOperationOutcome,
  conversationControlRequestFingerprint,
  reconstructConversationAuthority,
} from "../conversation/domain/conversationAuthority.js";

const actor1 = "operator-1" as never;
const actor2 = "operator-2" as never;

function automated(version = 1, authorityGeneration = 1) {
  return reconstructConversationAuthority({
    state: "automated",
    controllingActorId: null,
    version,
    authorityGeneration,
  });
}

function required(version = 1, authorityGeneration = 1) {
  return reconstructConversationAuthority({
    state: "human_required",
    controllingActorId: null,
    version,
    authorityGeneration,
  });
}

function controlled(
  actorId = actor1,
  version = 1,
  authorityGeneration = 1,
) {
  return reconstructConversationAuthority({
    state: "human_controlled",
    controllingActorId: actorId,
    version,
    authorityGeneration,
  });
}

test("EPIC043 reconstructs only valid conversation authority states", () => {
  assert.deepEqual(automated(), {
    state: "automated",
    controllingActorId: null,
    version: 1,
    authorityGeneration: 1,
  });

  assert.deepEqual(required(), {
    state: "human_required",
    controllingActorId: null,
    version: 1,
    authorityGeneration: 1,
  });

  assert.deepEqual(controlled(), {
    state: "human_controlled",
    controllingActorId: actor1,
    version: 1,
    authorityGeneration: 1,
  });

  assert.throws(
    () =>
      reconstructConversationAuthority({
        state: "human_controlled",
        controllingActorId: null,
        version: 1,
        authorityGeneration: 1,
      }),
    ConversationAuthorityDomainError,
  );

  assert.throws(
    () =>
      reconstructConversationAuthority({
        state: "automated",
        controllingActorId: actor1,
        version: 1,
        authorityGeneration: 1,
      }),
    ConversationAuthorityDomainError,
  );

  assert.throws(
    () =>
      reconstructConversationAuthority({
        state: "automated",
        controllingActorId: null,
        version: 0,
        authorityGeneration: 1,
      }),
    ConversationAuthorityDomainError,
  );

  assert.throws(
    () =>
      reconstructConversationAuthority({
        state: "automated",
        controllingActorId: null,
        version: 1,
        authorityGeneration: 0,
      }),
    ConversationAuthorityDomainError,
  );
});

test("EPIC043 handoff changes authority only when leaving automated", () => {
  const fromAutomated = applyConversationAuthorityTransition(
    automated(4, 7),
    { kind: "handoff_requested" },
  );

  assert.deepEqual(fromAutomated, {
    state: "human_required",
    controllingActorId: null,
    version: 5,
    authorityGeneration: 8,
  });

  assert.deepEqual(
    applyConversationAuthorityTransition(required(5, 8), {
      kind: "handoff_requested",
    }),
    required(5, 8),
  );

  assert.deepEqual(
    applyConversationAuthorityTransition(controlled(actor1, 5, 8), {
      kind: "handoff_requested",
    }),
    controlled(actor1, 5, 8),
  );
});

test("EPIC043 takeover has one authority transition and same-controller replay is a no-op", () => {
  for (const current of [automated(2, 4), required(2, 4)]) {
    const taken = applyConversationAuthorityTransition(current, {
      kind: "takeover",
      actorId: actor1,
    });

    assert.deepEqual(taken, {
      state: "human_controlled",
      controllingActorId: actor1,
      version: 3,
      authorityGeneration: 5,
    });
  }

  assert.deepEqual(
    applyConversationAuthorityTransition(controlled(actor1, 3, 5), {
      kind: "takeover",
      actorId: actor1,
    }),
    controlled(actor1, 3, 5),
  );

  assert.throws(
    () =>
      applyConversationAuthorityTransition(controlled(actor1, 3, 5), {
        kind: "takeover",
        actorId: actor2,
      }),
    ConversationAuthorityDomainError,
  );
});

test("EPIC043 release preserves pending-human semantics and resolve returns authority to Atlas", () => {
  const released = applyConversationAuthorityTransition(
    controlled(actor1, 8, 12),
    { kind: "release", actorId: actor1 },
  );

  assert.deepEqual(released, {
    state: "human_required",
    controllingActorId: null,
    version: 9,
    authorityGeneration: 13,
  });

  const resolved = applyConversationAuthorityTransition(
    controlled(actor1, 8, 12),
    { kind: "resolve", actorId: actor1 },
  );

  assert.deepEqual(resolved, {
    state: "automated",
    controllingActorId: null,
    version: 9,
    authorityGeneration: 13,
  });
});

test("EPIC043 operator activity changes neither control version nor authority generation", () => {
  const current = controlled(actor1, 11, 17);

  const afterActivity = applyConversationAuthorityTransition(current, {
    kind: "operator_activity",
    actorId: actor1,
  });

  assert.deepEqual(afterActivity, current);
  assert.equal(afterActivity.version, 11);
  assert.equal(afterActivity.authorityGeneration, 17);

  for (const kind of ["release", "resolve", "operator_activity"] as const) {
    assert.throws(
      () =>
        applyConversationAuthorityTransition(controlled(actor1, 11, 17), {
          kind,
          actorId: actor2,
        }),
      ConversationAuthorityDomainError,
    );
  }
});

test("EPIC043 uses closed operation outcome and event vocabularies", () => {
  for (const operation of ["takeover", "release", "resolve"] as const) {
    assert.equal(conversationControlOperation(operation), operation);
  }

  for (const outcome of [
    "applied",
    "stale_version",
    "controlled_by_other",
    "not_controller",
  ] as const) {
    assert.equal(conversationControlOperationOutcome(outcome), outcome);
  }

  for (const event of [
    "handoff_requested",
    "takeover_applied",
    "takeover_rejected",
    "release_applied",
    "release_rejected",
    "automation_resumed",
    "automation_blocked",
    "operator_message_created",
    "assistant_message_created",
    "inbound_message_received",
    "conversation_reopened",
    "conversation_resolved",
  ] as const) {
    assert.equal(conversationControlEventType(event), event);
  }

  assert.throws(
    () => conversationControlOperation("force_takeover"),
    ConversationAuthorityDomainError,
  );

  assert.throws(
    () => conversationControlOperationOutcome("provider_error"),
    ConversationAuthorityDomainError,
  );

  assert.throws(
    () => conversationControlEventType("raw_provider_payload"),
    ConversationAuthorityDomainError,
  );
});

test("EPIC043 validates bounded opaque operation ids", () => {
  assert.equal(conversationControlOperationId("  op_123  "), "op_123");

  assert.throws(
    () => conversationControlOperationId(""),
    ConversationAuthorityDomainError,
  );

  assert.throws(
    () => conversationControlOperationId("x".repeat(201)),
    ConversationAuthorityDomainError,
  );

  assert.throws(
    () => conversationControlOperationId("operation\u000Aunsafe"),
    ConversationAuthorityDomainError,
  );
});

test("EPIC043 fingerprints control requests deterministically and detects divergent replay", () => {
  const first = conversationControlRequestFingerprint({
    operation: "takeover",
    expectedVersion: 3,
    actorId: actor1,
  });

  const same = conversationControlRequestFingerprint({
    operation: "takeover",
    expectedVersion: 3,
    actorId: actor1,
  });

  const differentVersion = conversationControlRequestFingerprint({
    operation: "takeover",
    expectedVersion: 4,
    actorId: actor1,
  });

  const differentOperation = conversationControlRequestFingerprint({
    operation: "release",
    expectedVersion: 3,
    actorId: actor1,
  });

  const differentActor = conversationControlRequestFingerprint({
    operation: "takeover",
    expectedVersion: 3,
    actorId: actor2,
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, same);
  assert.notEqual(first, differentVersion);
  assert.notEqual(first, differentOperation);
  assert.notEqual(first, differentActor);

  assert.equal(classifyConversationControlReplay(first, same), "same");
  assert.equal(
    classifyConversationControlReplay(first, differentVersion),
    "divergent",
  );

  assert.throws(
    () => classifyConversationControlReplay("invalid", first),
    ConversationAuthorityDomainError,
  );
});
