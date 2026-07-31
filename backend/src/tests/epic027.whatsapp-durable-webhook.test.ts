import assert from "node:assert/strict";
import test from "node:test";
import { conversationId, conversationMessageId, type ConversationMessage } from "../conversation/domain/conversation.js";
import { whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

const now = "2026-07-31T12:00:00.000Z";
const context = { workspaceId: 1, workspaceKey: "whatsapp" };
const conversation = conversationId("cnv_0123456789abcdef0123456789abcdef");
const connection = { id: whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef"), workspaceId: 1, companyId: 1, assistantProfileId: "asp_0123456789abcdef0123456789abcdef", phoneNumberId: "phone" };
const binding = { conversationId: conversation, assistantParticipantId: "cpt_1123456789abcdef0123456789abcdef", customerParticipantId: "cpt_0123456789abcdef0123456789abcdef", waId: "wa" };
const inbound = { id: conversationMessageId("cmsg_0123456789abcdef0123456789abcdef"), conversationId: conversation, direction: "inbound", content: "Hello" } as ConversationMessage;
const payload = Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages: [{ type: "text", from: "wa", id: "wamid-in", text: { body: "Hello" } }] } }] }] }));

test("EPIC-027 Phase 4 captures a durable request before acknowledgement and executes only from a lease", async () => {
  let captured: import("../transport/domain/providerDelivery.js").ChannelExecutionRequest | null = null, executions = 0, completions = 0;
  const event = { id: "cpe_0123456789abcdef0123456789abcdef", conversationMessageId: inbound.id };
  const events = {
    captureInboundExecution: (_event: unknown, _inbound: unknown, _provider: unknown, request: import("../transport/domain/providerDelivery.js").ChannelExecutionRequest) => { captured ??= request; return { event, inbound, request: captured, claimed: captured === request }; },
    leaseExecutionRequests: () => captured ? [captured] : [],
    completeExecutionRequest: () => { completions += 1; return null; },
    findByTransportProviderAndExternalEventId: () => event,
    updateState: () => null,
  };
  const service = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, { resolveActiveByPhoneNumberId: () => connection, resolveForRecovery: () => connection, recordWebhookActivity: () => undefined } as never, { findBinding: () => binding, findBindingByConversation: () => binding } as never, events as never, { listMessages: () => [inbound] } as never, { executePersistedInbound: async () => { executions += 1; return { inbound, outbound: { id: conversationMessageId("cmsg_1123456789abcdef0123456789abcdef") }, response: { outcome: "answered", answer: "Answer" } }; } } as never, { now: () => now });

  await service.acknowledge(payload);
  await service.acknowledge(payload);
  assert.equal(executions, 0);
  const request = captured as unknown as import("../transport/domain/providerDelivery.js").ChannelExecutionRequest;
  assert.ok(request);
  assert.deepEqual({ ...request.snapshot, replyIdempotencyKey: typeof request.snapshot.replyIdempotencyKey }, { version: "whatsapp-execution-request-v1", externalEventId: "wamid-in", conversationId: conversation, assistantProfileId: connection.assistantProfileId, assistantParticipantId: binding.assistantParticipantId, whatsAppConnectionId: connection.id, recipientWaId: "wa", replyIdempotencyKey: "string" });

  await service.resumeIncomplete();
  assert.equal(executions, 1);
  assert.equal(completions, 1);
});
