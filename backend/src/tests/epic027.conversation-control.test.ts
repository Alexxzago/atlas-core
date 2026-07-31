import assert from "node:assert/strict";
import test from "node:test";
import { conversationId } from "../conversation/domain/conversation.js";
import { reconstructConversationControl } from "../conversation/domain/conversationControl.js";
import { ConversationControlConflictError, ConversationControlForbiddenError, ConversationControlService } from "../conversation/services/conversationControlService.js";

const context = { workspaceId: 1, workspaceKey: "default" }, id = conversationId("cnv_0123456789abcdef0123456789abcdef"), at = "2026-07-31T12:00:00.000Z";

function setup() {
  let control = reconstructConversationControl({ conversationId: id, state: "human_required", controllingActorId: null, lastControllingActorId: null, takenAt: null, releasedAt: null, lastOperatorActivityAt: null, attentionReason: "customer_request", resolvedAt: null, resolvedBy: null, version: 1, createdAt: at, updatedAt: at });
  const controls = {
    ensureConversationControl: () => control,
    updateConversationControl: (_context: unknown, _companyId: unknown, next: typeof control, expectedVersion: number) => {
      if (expectedVersion !== control.version) return null;
      control = next;
      return control;
    },
  };
  const service = new ConversationControlService({ get: () => ({ id }) } as never, controls as never, { now: () => at });
  return { service, control: () => control };
}

test("EPIC-027 operator control records takeover, safe release, and classified resolution", () => {
  const value = setup();
  const taken = value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 1 });
  assert.deepEqual([taken.state, taken.controllingActorId, taken.lastControllingActorId, taken.takenAt, taken.attentionReason, taken.version], ["human_controlled", "operator-1", "operator-1", at, "operator_follow_up", 2]);
  const released = value.service.release(context, "operator-1" as never, 1, id, { expectedVersion: 2 });
  assert.deepEqual([released.state, released.controllingActorId, released.releasedAt, released.attentionReason, released.version], ["human_required", null, at, "operator_follow_up", 3]);
  const retaken = value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 3 });
  const resolved = value.service.resolve(context, "operator-1" as never, 1, id, { expectedVersion: retaken.version });
  assert.deepEqual([resolved.state, resolved.controllingActorId, resolved.resolvedAt, resolved.resolvedBy, resolved.version], ["automated", null, at, "operator-1", 5]);
});

test("EPIC-027 control rejects stale versions and a different operator without exposing control", () => {
  const value = setup();
  assert.throws(() => value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 2 }), ConversationControlConflictError);
  value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 1 });
  assert.throws(() => value.service.release(context, "operator-2" as never, 1, id, { expectedVersion: 2 }), ConversationControlForbiddenError);
  assert.equal(value.control().controllingActorId, "operator-1");
});
