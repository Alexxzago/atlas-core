import assert from "node:assert/strict";
import test from "node:test";
import { conversationId, conversationMessageId, type ConversationMessage } from "../conversation/domain/conversation.js";
import { whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";
import { WhatsAppOutboundDeliveryService, WhatsAppOutboundDeliveryValidationError } from "../whatsapp/services/WhatsAppOutboundDeliveryService.js";

const at = "2026-07-28T12:00:00.000Z";
const conversationIdValue = conversationId("cnv_0123456789abcdef0123456789abcdef");
const messageId = conversationMessageId("cmsg_0123456789abcdef0123456789abcdef");
const connectionId = whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef");
const context = { workspaceId: 1, workspaceKey: "default" };

function setup(options: { failure?: boolean; transportFailure?: boolean; foreignConversation?: boolean; foreignCompany?: boolean } = {}) {
  const message = { id: messageId, conversationId: options.foreignConversation ? conversationId("cnv_1123456789abcdef0123456789abcdef") : conversationIdValue, direction: "outbound", content: "Reply" } as ConversationMessage;
  const records: Array<{ id: string; externalMessageId: string | null }> = [];
  const deliveries: Array<{ id: string; providerMessageRecordId: string; state: string; safeErrorCategory: string | null }> = [];
  let sends = 0, tokens = 0;
  const service = new WhatsAppOutboundDeliveryService(
    {
      findConversation: (received: typeof context, companyId: number) => received.workspaceId === 1 && companyId === 1 && !options.foreignCompany ? { id: conversationIdValue } : null,
      findMessage: (received: typeof context, companyId: number) => received.workspaceId === 1 && companyId === 1 && !options.foreignCompany ? message : null,
    } as never,
    { findById: (received: typeof context, companyId: number) => received.workspaceId === 1 && companyId === 1 && !options.foreignCompany ? { id: connectionId, companyId: 1, status: "active", phoneNumberId: "phone" } : null } as never,
    {
      create: (record: { id: string }) => { if (options.transportFailure) return null; const existing = records[0]; if (existing) return null; const value = { id: record.id, externalMessageId: null }; records.push(value); return value; },
      findByMessageAndConnection: () => records[0] ?? null,
      attachExternalMessageId: (id: string, externalMessageId: string) => { const record = records.find((value) => value.id === id); if (!record) return null; record.externalMessageId = externalMessageId; return record; },
    } as never,
    {
      create: (delivery: { id: string; providerMessageRecordId: string }) => { if (options.transportFailure) return null; if (deliveries[0]) return null; const value = { id: delivery.id, providerMessageRecordId: delivery.providerMessageRecordId, state: "pending", safeErrorCategory: null }; deliveries.push(value); return value; },
      findByProviderMessageRecordAndConnection: () => deliveries[0] ?? null,
      updateState: (id: string, state: string, safeErrorCategory: string | null) => { const delivery = deliveries.find((value) => value.id === id); if (!delivery) return null; delivery.state = state; delivery.safeErrorCategory = safeErrorCategory; return delivery; },
    } as never,
    { resolve: () => { tokens += 1; return "company-token"; } } as never,
    () => ({ sendText: async () => { sends += 1; if (options.failure) throw new Error("token=company-token provider payload"); return "wamid-out"; } }) as never,
    { now: () => at },
  );
  return { service, records, deliveries, sends: () => sends, tokens: () => tokens };
}

test("EPIC-019 shared delivery persists one transport record, delivery, credential-scoped accepted send, and Meta ID", async () => {
  const value = setup();
  const result = await value.service.deliverWhatsAppText(context, 1, { conversationId: conversationIdValue, conversationMessageId: messageId, whatsAppConnectionId: connectionId, recipientWaId: "wa" });
  assert.equal(value.records.length, 1); assert.equal(value.deliveries.length, 1); assert.equal(value.tokens(), 1); assert.equal(value.sends(), 1);
  assert.equal(value.records[0]?.externalMessageId, "wamid-out"); assert.equal(value.deliveries[0]?.state, "accepted"); assert.equal(result.state, "accepted");
});

test("EPIC-019 shared delivery persists uncertain provider_unavailable without leaking provider failure", async () => {
  const value = setup({ failure: true });
  const result = await value.service.deliverWhatsAppText(context, 1, { conversationId: conversationIdValue, conversationMessageId: messageId, whatsAppConnectionId: connectionId, recipientWaId: "wa" });
  assert.deepEqual(result, { id: value.deliveries[0]?.id, state: "uncertain" }); assert.equal(value.deliveries[0]?.safeErrorCategory, "provider_unavailable"); assert.equal(JSON.stringify(result).includes("company-token"), false);
});

test("EPIC-019 shared delivery does not send when transport persistence fails and duplicate invocation sends once", async () => {
  const failed = setup({ transportFailure: true });
  await assert.rejects(() => failed.service.deliverWhatsAppText(context, 1, { conversationId: conversationIdValue, conversationMessageId: messageId, whatsAppConnectionId: connectionId, recipientWaId: "wa" }), WhatsAppOutboundDeliveryValidationError);
  assert.equal(failed.sends(), 0);
  const duplicate = setup();
  await duplicate.service.deliverWhatsAppText(context, 1, { conversationId: conversationIdValue, conversationMessageId: messageId, whatsAppConnectionId: connectionId, recipientWaId: "wa" });
  await duplicate.service.deliverWhatsAppText(context, 1, { conversationId: conversationIdValue, conversationMessageId: messageId, whatsAppConnectionId: connectionId, recipientWaId: "wa" });
  assert.equal(duplicate.records.length, 1); assert.equal(duplicate.deliveries.length, 1); assert.equal(duplicate.sends(), 1);
});

test("EPIC-019 shared delivery rejects cross-workspace, cross-company, and mismatched conversation messages", async () => {
  for (const options of [{ foreignCompany: true }, { foreignConversation: true }]) {
    const value = setup(options);
    await assert.rejects(() => value.service.deliverWhatsAppText(options.foreignCompany ? { workspaceId: 2, workspaceKey: "foreign" } : context, 1, { conversationId: conversationIdValue, conversationMessageId: messageId, whatsAppConnectionId: connectionId, recipientWaId: "wa" }), WhatsAppOutboundDeliveryValidationError);
    assert.equal(value.sends(), 0);
  }
});
