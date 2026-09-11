import assert from "node:assert/strict";
import test from "node:test";
import { conversationId } from "../conversation/domain/conversation.js";
import { reconstructConversationControl } from "../conversation/domain/conversationControl.js";
import { applyConversationAuthorityTransition } from "../conversation/domain/conversationAuthority.js";
import { ConversationControlConflictError, ConversationControlForbiddenError, ConversationControlService } from "../conversation/services/conversationControlService.js";

const context = { workspaceId: 1, workspaceKey: "default" }, id = conversationId("cnv_0123456789abcdef0123456789abcdef"), at = "2026-07-31T12:00:00.000Z";

function setup() {
  let control = reconstructConversationControl({ conversationId: id, state: "human_required", controllingActorId: null, lastControllingActorId: null, takenAt: null, releasedAt: null, lastOperatorActivityAt: null, attentionReason: "customer_request", resolvedAt: null, resolvedBy: null, version: 1, authorityGeneration: 1, createdAt: at, updatedAt: at });
  const controls = {
    applyConversationControlOperation: (_context: unknown, _companyId: unknown, _id: unknown, command: { operation: "takeover" | "release" | "resolve" | "resume"; actorId: string; expectedVersion: number }) => {
      if (command.expectedVersion !== control.version) return { kind: "rejected", outcome: "stale_version", control };
      if (command.operation === "takeover" && control.state === "human_controlled" && control.controllingActorId !== command.actorId) return { kind: "rejected", outcome: "controlled_by_other", control };
      if (command.operation === "resume" && control.state !== "human_required") return { kind: "rejected", outcome: "not_controller", control };
      if (command.operation !== "takeover" && command.operation !== "resume" && (control.state !== "human_controlled" || control.controllingActorId !== command.actorId)) return { kind: "rejected", outcome: "not_controller", control };
      const authority = applyConversationAuthorityTransition(control, { kind: command.operation, actorId: command.actorId as never });
      control = reconstructConversationControl(command.operation === "takeover" ? { ...control, ...authority, lastControllingActorId: command.actorId as never, takenAt: control.takenAt ?? at, releasedAt: null, attentionReason: "operator_follow_up", resolvedAt: null, resolvedBy: null, updatedAt: authority.version === control.version ? control.updatedAt : at } : command.operation === "release" ? { ...control, ...authority, releasedAt: at, attentionReason: "operator_follow_up", updatedAt: at } : command.operation === "resolve" ? { ...control, ...authority, releasedAt: at, attentionReason: null, resolvedAt: at, resolvedBy: command.actorId as never, updatedAt: at } : { ...control, ...authority, attentionReason: null, updatedAt: at });
      return { kind: "applied", outcome: "applied", control };
    },
  };
  const service = new ConversationControlService({ get: () => ({ id }) } as never, controls as never, { now: () => at });
  return { service, control: () => control };
}

test("EPIC-027 operator control records takeover, safe release, and classified resolution", () => {
  const value = setup();
  const taken = value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 1, operationId: "take-1" });
  assert.deepEqual([taken.state, taken.controllingActorId, taken.lastControllingActorId, taken.takenAt, taken.attentionReason, taken.version], ["human_controlled", "operator-1", "operator-1", at, "operator_follow_up", 2]);
  const released = value.service.release(context, "operator-1" as never, 1, id, { expectedVersion: 2, operationId: "release-1" });
  assert.deepEqual([released.state, released.controllingActorId, released.releasedAt, released.attentionReason, released.version], ["human_required", null, at, "operator_follow_up", 3]);
  const retaken = value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 3, operationId: "take-2" });
  const resolved = value.service.resolve(context, "operator-1" as never, 1, id, { expectedVersion: retaken.version, operationId: "resolve-1" });
  assert.deepEqual([resolved.state, resolved.controllingActorId, resolved.resolvedAt, resolved.resolvedBy, resolved.version], ["automated", null, at, "operator-1", 5]);
});

test("EPIC-027 control rejects stale versions and a different operator without exposing control", () => {
  const value = setup();
  assert.throws(() => value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 2, operationId: "stale" }), ConversationControlConflictError);
  value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 1, operationId: "take" });
  assert.throws(() => value.service.release(context, "operator-2" as never, 1, id, { expectedVersion: 2, operationId: "foreign-release" }), ConversationControlForbiddenError);
  assert.equal(value.control().controllingActorId, "operator-1");
});

test("EPIC-027 resumes automation directly only from human-required", () => {
  const value = setup();
  const resumed = value.service.resume(context, "operator-1" as never, 1, id, { expectedVersion: 1, operationId: "resume-1" });
  assert.deepEqual([resumed.state, resumed.attentionReason, resumed.version, resumed.authorityGeneration], ["automated", null, 2, 2]);
  value.service.takeOver(context, "operator-1" as never, 1, id, { expectedVersion: 2, operationId: "take-1" });
  assert.throws(() => value.service.resume(context, "operator-1" as never, 1, id, { expectedVersion: 3, operationId: "resume-controlled" }), ConversationControlForbiddenError);
});
