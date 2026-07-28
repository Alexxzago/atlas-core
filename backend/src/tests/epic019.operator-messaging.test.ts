import assert from "node:assert/strict";
import test from "node:test";
import { conversationId, conversationMessageId, conversationParticipantId } from "../conversation/domain/conversation.js";
import { reconstructConversationControl } from "../conversation/domain/conversationControl.js";
import { OperatorConversationMessageForbiddenError, OperatorConversationMessagingService } from "../conversation/services/operatorConversationMessagingService.js";

const at = "2026-07-28T12:00:00.000Z", context = { workspaceId: 1, workspaceKey: "default" }, conversation = conversationId("cnv_0123456789abcdef0123456789abcdef");

function setup(state: "automated" | "human_required" | "human_controlled" = "human_controlled", controller = "operator-1") {
  const participants: Array<{ id: string; type: string; reference: string | null }> = [{ id: conversationParticipantId("cpt_0123456789abcdef0123456789abcdef"), type: "assistant", reference: "assistant" }];
  const messages: Array<{ id: string; direction: string; senderParticipantId: string; idempotencyKey: string }> = [];
  let deliveries = 0, activity = 0;
  let control = reconstructConversationControl({ conversationId: conversation, state, controllingActorId: state === "human_controlled" ? controller as never : null, lastControllingActorId: state === "human_controlled" ? controller as never : null, takenAt: state === "human_controlled" ? at : null, releasedAt: null, lastOperatorActivityAt: null, attentionReason: null, resolvedAt: null, resolvedBy: null, version: 1, createdAt: at, updatedAt: at });
  const service = new OperatorConversationMessagingService(
    { validateOpen: () => ({ id: conversation }), addParticipant: (_c: unknown, _company: unknown, _conversation: unknown, value: { type: string; reference: string }) => { const participant = { id: conversationParticipantId(`cpt_${(participants.length + 1).toString(16).padStart(32, "0")}`), ...value }; participants.push(participant); return participant; }, addMessage: (_c: unknown, _company: unknown, _conversation: unknown, value: { senderParticipantId: string; idempotencyKey: string }) => { const message = { id: conversationMessageId(`cmsg_${(messages.length + 1).toString(16).padStart(32, "0")}`), direction: "outbound", ...value }; messages.push(message); return message; } } as never,
    { findMessageByIdempotencyKey: (_c: unknown, _company: unknown, _conversation: unknown, key: string) => messages.find((message) => message.idempotencyKey === key) ?? null, listParticipants: () => participants } as never,
    { ensureConversationControl: () => control, findConversationControl: () => control, updateConversationControl: (_c: unknown, _company: unknown, value: typeof control) => { activity += 1; control = value; return control; } } as never,
    { findBindingByConversation: () => ({ conversationId: conversation, whatsAppConnectionId: "wac_0123456789abcdef0123456789abcdef", waId: "wa" }) } as never,
    { deliverWhatsAppText: async () => { deliveries += 1; return { id: "odl_0123456789abcdef0123456789abcdef", state: "accepted" as const }; } } as never,
    { now: () => at },
  );
  return { service, participants, messages, deliveries: () => deliveries, activity: () => activity, control: () => control };
}

test("EPIC-019 operator send creates and reuses human_operator authorship, persists before shared delivery, and preserves control", async () => {
  const value = setup();
  const first = await value.service.send(context, "operator-1" as never, 1, conversation, { content: "First", idempotencyKey: "one" });
  const second = await value.service.send(context, "operator-1" as never, 1, conversation, { content: "Second", idempotencyKey: "two" });
  assert.equal(first.delivery.state, "accepted"); assert.equal(value.messages.length, 2); assert.equal(value.deliveries(), 2);
  const operators = value.participants.filter((participant) => participant.type === "human_operator");
  assert.equal(operators.length, 1); assert.equal(operators[0]?.reference, "operator-1"); assert.notEqual(value.messages[0]?.senderParticipantId, value.participants[0]?.id);
  assert.equal(value.control().state, "human_controlled"); assert.equal(value.control().controllingActorId, "operator-1"); assert.equal(value.activity(), 2); assert.equal(second.messageId !== first.messageId, true);
});

test("EPIC-019 operator send rejects non-controlled states and foreign controller before persistence or delivery", async () => {
  for (const value of [setup("automated"), setup("human_required"), setup("human_controlled", "operator-2")]) {
    await assert.rejects(() => value.service.send(context, "operator-1" as never, 1, conversation, { content: "No", idempotencyKey: "key" }), OperatorConversationMessageForbiddenError);
    assert.equal(value.messages.length, 0); assert.equal(value.deliveries(), 0);
  }
});

test("EPIC-019 operator send reuses an idempotency key without a second message or shared delivery", async () => {
  const value = setup();
  const first = await value.service.send(context, "operator-1" as never, 1, conversation, { content: "Once", idempotencyKey: "same" });
  const duplicate = await value.service.send(context, "operator-1" as never, 1, conversation, { content: "Once", idempotencyKey: "same" });
  assert.equal(first.messageId, duplicate.messageId); assert.equal(value.messages.length, 1); assert.equal(value.deliveries(), 2);
});
