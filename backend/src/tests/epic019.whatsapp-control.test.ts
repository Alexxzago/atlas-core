import assert from "node:assert/strict";
import test from "node:test";
import { OperationalConversationTurnSuppressedError } from "../assistant/services/operationalConversationTurnService.js";
import { conversationId, conversationMessageId, type ConversationMessage } from "../conversation/domain/conversation.js";
import { reconstructConversationControl, type ConversationControl } from "../conversation/domain/conversationControl.js";
import { whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

const at = "2026-07-28T12:00:00.000Z";
const conversation = conversationId("cnv_0123456789abcdef0123456789abcdef");
const inbound = Object.freeze({ id: conversationMessageId("cmsg_0123456789abcdef0123456789abcdef") }) as ConversationMessage;
const connection = { id: whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef"), workspaceId: 1, companyId: 1, assistantProfileId: "asp_0123456789abcdef0123456789abcdef", phoneNumberId: "phone" };

function control(state: ConversationControl["state"], resolved = true): ConversationControl {
  return reconstructConversationControl({ conversationId: conversation, state, controllingActorId: state === "human_controlled" ? "operator-1" as never : null, lastControllingActorId: state === "human_controlled" ? "operator-1" as never : null, takenAt: state === "human_controlled" ? at : null, releasedAt: null, lastOperatorActivityAt: null, attentionReason: state === "automated" ? null : "automation_failure", resolvedAt: resolved ? at : null, resolvedBy: resolved ? "operator-1" as never : null, version: 1, createdAt: at, updatedAt: at });
}

class Controls {
  public current: ConversationControl;
  public clearCalls = 0;
  public constructor(current: ConversationControl) { this.current = current; }
  public ensureConversationControl(): ConversationControl { return this.current; }
  public findConversationControl(): ConversationControl { return this.current; }
  public clearConversationResolution(_context: unknown, _companyId: number, _conversationId: unknown, expectedVersion: number, updatedAt: string): ConversationControl | null {
    if (expectedVersion !== this.current.version) return null;
    this.clearCalls += 1;
    this.current = reconstructConversationControl({ ...this.current, resolvedAt: null, resolvedBy: null, version: expectedVersion + 1, updatedAt });
    return this.current;
  }
  public updateConversationControl(_context: unknown, _companyId: number, value: ConversationControl, expectedVersion: number): ConversationControl | null {
    if (expectedVersion !== this.current.version) return null;
    this.current = reconstructConversationControl({ ...value, version: expectedVersion + 1 });
    return this.current;
  }
}

function payload(wamid = "wamid-in"): Buffer { return Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages: [{ type: "text", from: "wa", id: wamid, text: { body: "Hello" } }] } }] }] })); }

function setup(state: ConversationControl["state"], execute: (hooks: { afterInbound?: (value: ConversationMessage) => void | Promise<void>; beforeRuntime?: (value: ConversationMessage) => boolean | Promise<boolean> }) => Promise<unknown>) {
  const controls = new Controls(control(state)); let added = 0, executions = 0, claims = 0;
  const service = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, { resolveActiveByPhoneNumberId: () => connection } as never, { findBinding: () => ({ conversationId: conversation, customerParticipantId: "cpt_0123456789abcdef0123456789abcdef", assistantParticipantId: "cpt_1123456789abcdef0123456789abcdef" }) } as never, { claim: () => ({ claimed: claims++ === 0, event: { id: "cpe_0123456789abcdef0123456789abcdef" } }), updateState: () => null } as never, { addMessage: () => { added += 1; return inbound; } } as never, { execute: async (_context: unknown, _company: unknown, _conversation: unknown, _input: unknown, hooks: never) => { executions += 1; return execute(hooks); } } as never, { now: () => at }, undefined, undefined, undefined, undefined, undefined, controls as never);
  return { service, controls, added: () => added, executions: () => executions };
}

test("EPIC-019 automated inbound executes once, clears resolution, and preserves automated control", async () => {
  const value = setup("automated", async (hooks) => { await hooks.afterInbound?.(inbound); assert.equal(await hooks.beforeRuntime?.(inbound), true); return { inbound, outbound: { id: conversationMessageId("cmsg_1123456789abcdef0123456789abcdef"), content: "Answer" }, response: { outcome: "answered", answer: "Answer" } }; });
  await value.service.receive(payload());
  assert.equal(value.executions(), 1); assert.equal(value.added(), 0); assert.equal(value.controls.clearCalls, 1); assert.equal(value.controls.current.state, "automated"); assert.equal(value.controls.current.resolvedAt, null);
});

test("EPIC-019 human-required inbound persists without runtime and preserves control", async () => {
  const value = setup("human_required", async () => { throw new Error("must not execute"); });
  await value.service.receive(payload());
  assert.equal(value.executions(), 0); assert.equal(value.added(), 1); assert.equal(value.controls.current.state, "human_required");
});

test("EPIC-019 human-controlled inbound persists without runtime and preserves controller", async () => {
  const value = setup("human_controlled", async () => { throw new Error("must not execute"); });
  await value.service.receive(payload());
  assert.equal(value.executions(), 0); assert.equal(value.added(), 1); assert.equal(value.controls.current.state, "human_controlled"); assert.equal(value.controls.current.controllingActorId, "operator-1");
});

test("EPIC-019 inbound resolution reopen preserves every control state", async () => {
  for (const state of ["human_required", "human_controlled"] as const) {
    const value = setup(state, async () => { throw new Error("must not execute"); });
    await value.service.receive(payload(`wamid-${state}`));
    assert.equal(value.controls.current.state, state); assert.equal(value.controls.current.resolvedAt, null); assert.equal(value.controls.current.resolvedBy, null);
  }
});

test("EPIC-019 safe fallback preserves the existing result and marks human-required", async () => {
  const value = setup("automated", async (hooks) => { await hooks.afterInbound?.(inbound); return { inbound, outbound: { id: conversationMessageId("cmsg_1123456789abcdef0123456789abcdef"), content: "Approved fallback" }, response: { outcome: "safe_fallback", answer: "Approved fallback" } }; });
  await value.service.receive(payload());
  assert.equal(value.executions(), 1); assert.equal(value.controls.current.state, "human_required"); assert.equal(value.controls.current.attentionReason, "automation_failure");
});

test("EPIC-019 deterministic turn failure retains inbound and marks human-required", async () => {
  const value = setup("automated", async (hooks) => { await hooks.afterInbound?.(inbound); throw new Error("runtime failed"); });
  await assert.rejects(() => value.service.receive(payload()), /runtime failed/);
  assert.equal(value.executions(), 1); assert.equal(value.controls.current.state, "human_required");
});

test("EPIC-019 final recheck suppresses runtime after concurrent human takeover", async () => {
  const value = setup("automated", async (hooks) => { await hooks.afterInbound?.(inbound); value.controls.current = control("human_controlled", false); if (await hooks.beforeRuntime?.(inbound) === false) throw new OperationalConversationTurnSuppressedError(inbound); throw new Error("runtime must not execute"); });
  await value.service.receive(payload());
  assert.equal(value.executions(), 1); assert.equal(value.controls.current.state, "human_controlled");
});

test("EPIC-019 initially human-controlled inbound remains manual after concurrent return to automated", async () => {
  const value = setup("human_controlled", async () => { throw new Error("turn must not execute"); });
  const initial = value.controls.current;
  let ensures = 0;
  value.controls.ensureConversationControl = () => ensures++ === 0 ? initial : value.controls.current;
  value.controls.clearConversationResolution = () => {
    value.controls.current = control("automated", false);
    return value.controls.current;
  };

  await value.service.receive(payload());

  assert.equal(value.added(), 1);
  assert.equal(value.executions(), 0);
  assert.equal(value.controls.current.state, "automated");
  assert.equal(value.controls.current.resolvedAt, null);
});

test("EPIC-019 duplicate inbound delivery does not execute the turn twice", async () => {
  const value = setup("automated", async (hooks) => { await hooks.afterInbound?.(inbound); return { inbound, outbound: { id: conversationMessageId("cmsg_1123456789abcdef0123456789abcdef"), content: "Answer" }, response: { outcome: "answered", answer: "Answer" } }; });
  await value.service.receive(payload("wamid-duplicate")); await value.service.receive(payload("wamid-duplicate"));
  assert.equal(value.executions(), 1);
});
