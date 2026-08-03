import assert from "node:assert/strict";
import test from "node:test";
import { conversationId, conversationMessageId, type ConversationMessage } from "../conversation/domain/conversation.js";
import { outboundDeliveryId, providerMessageRecordId, reconstructOutboundDelivery, type OutboundDelivery } from "../transport/domain/providerDelivery.js";
import { whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";
import { WhatsAppCloudApiError } from "../whatsapp/providers/WhatsAppCloudApiProvider.js";
import { WhatsAppOutboundDeliveryService } from "../whatsapp/services/WhatsAppOutboundDeliveryService.js";

const at = "2026-07-31T12:00:00.000Z";
const context = { workspaceId: 1, workspaceKey: "whatsapp" };
const conversation = conversationId("cnv_0123456789abcdef0123456789abcdef");
const messageId = conversationMessageId("cmsg_0123456789abcdef0123456789abcdef");
const connectionId = whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef");

function delivery(attemptCount = 0, state: OutboundDelivery["state"] = "pending"): OutboundDelivery { return reconstructOutboundDelivery({ id: outboundDeliveryId("odl_0123456789abcdef0123456789abcdef"), providerMessageRecordId: providerMessageRecordId("pmr_0123456789abcdef0123456789abcdef"), transportConnectionId: connectionId, state, attemptCount, nextAttemptAt: at, leaseOwner: state === "leased" ? "stale" : null, leaseExpiresAt: state === "leased" ? "2026-07-31T11:59:00.000Z" : null, safeErrorCategory: null, createdAt: at, updatedAt: at }); }

function setup(failure: unknown | null, initial = delivery()) {
  let current = initial, sends = 0;
  const attempts: Array<{ outcome: string; category: string | null; next: string | null }> = [];
  const message = { id: messageId, conversationId: conversation, direction: "outbound", content: "Reply" } as ConversationMessage;
  const records: Array<{ id: string }> = [];
  const service = new WhatsAppOutboundDeliveryService(
    { findConversation: () => ({ id: conversation }), findMessage: () => message } as never,
    { findById: () => ({ id: connectionId, workspaceId: 1, companyId: 1, status: "active", phoneNumberId: "phone" }), findByIdForRecovery: () => ({ id: connectionId, workspaceId: 1, companyId: 1, status: "active", phoneNumberId: "phone" }) } as never,
    { create: (value: { id: string }) => { if (records.length) return null; records.push(value); return value; }, findByMessageAndConnection: () => records[0] ?? null, findById: () => ({ id: "pmr_0123456789abcdef0123456789abcdef", direction: "outbound", communicationChannel: "whatsapp", conversationMessageId: messageId }), attachExternalMessageId: () => null } as never,
    { create: () => current, findByProviderMessageRecordAndConnection: () => current, leaseReady: (owner: string) => { current = delivery(current.attemptCount + 1, "leased"); current = { ...current, leaseOwner: owner, leaseExpiresAt: "2026-07-31T12:01:00.000Z" }; return [current]; }, settleLease: (_id: string, _owner: string, outcome: OutboundDelivery["state"], next: string | null, category: string | null) => { attempts.push({ outcome, category, next }); current = { ...current, state: outcome, nextAttemptAt: next ?? current.nextAttemptAt, leaseOwner: null, leaseExpiresAt: null, safeErrorCategory: category }; return current; } } as never,
    { resolve: () => "token" } as never,
    () => ({ sendText: async () => { sends += 1; if (failure) throw failure; return "wamid-out"; } }) as never,
    { now: () => at },
    undefined,
    { findBindingByConversation: () => ({ whatsAppConnectionId: connectionId, waId: "wa" }) } as never,
  );
  return { service, attempts, records, sends: () => sends };
}

test("EPIC-027 Phase 5 retries Meta 429, 5xx, and network failures with bounded persisted exponential backoff", async () => {
  for (const failure of [new WhatsAppCloudApiError(429, 120_000), new WhatsAppCloudApiError(503, null), new WhatsAppCloudApiError(null, null)]) {
    const value = setup(failure);
    await value.service.dispatchReady("worker");
    assert.deepEqual(value.attempts[0], { outcome: "retryable", category: failure.status === 429 ? "rate_limited" : "provider_unavailable", next: failure.status === 429 ? "2026-07-31T12:02:00.000Z" : "2026-07-31T12:00:02.000Z" });
  }
  const capped = setup(new WhatsAppCloudApiError(429, 600_000), delivery(3));
  await capped.service.dispatchReady("worker");
  assert.equal(capped.attempts[0]?.next, "2026-07-31T12:05:00.000Z");
});

test("EPIC-027 Phase 5 records terminal Meta 4xx and credential failures without retrying", async () => {
  for (const failure of [new WhatsAppCloudApiError(400, null), new WhatsAppCloudApiError(401, null), new WhatsAppCloudApiError(403, null)]) {
    const value = setup(failure);
    await value.service.dispatchReady("worker");
    assert.equal(value.attempts[0]?.outcome, "permanent_failure");
    assert.equal(value.attempts[0]?.next, null);
  }
});

test("EPIC-027 Phase 5 logs only sanitized Meta outbound failure diagnostics", async () => {
  const original = console.info, logs: string[] = [];
  console.info = (value: unknown): void => { logs.push(String(value)); };
  try {
    const value = setup(new WhatsAppCloudApiError(400, null, { graphApiVersion: "v26.0", httpStatus: 400, providerCode: 131030, providerSubcode: 123, errorType: "OAuthException", transient: false, sanitizedDetailsCategory: "outside_test_recipient_set", sanitizedReason: "recipient_not_in_allowed_list" }));
    await value.service.dispatchReady("worker");
  } finally { console.info = original; }
  assert.equal(logs.length, 1);
  const diagnostic = JSON.parse(logs[0]!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(diagnostic).sort(), ["connectionId", "errorType", "event", "graphApiVersion", "httpStatus", "operation", "outboundDeliveryId", "providerCode", "providerSubcode", "sanitizedDetailsCategory", "sanitizedReason", "timestamp", "transient"]);
  assert.equal(diagnostic.event, "whatsapp_provider_outbound_failed");
  assert.equal(diagnostic.sanitizedDetailsCategory, "outside_test_recipient_set");
  assert.equal(diagnostic.sanitizedReason, "recipient_not_in_allowed_list");
  const text = logs[0]!;
  assert.equal(text.includes("token") || text.includes("Reply") || text.includes('"wa"') || text.includes("phone") || text.includes("private Meta detail") || text.includes("trace-id"), false);
});

test("EPIC-027 Phase 5 accepts eventually, terminates exhausted retries, and recovers expired leases", async () => {
  const eventual = setup(null);
  await eventual.service.dispatchReady("worker");
  assert.equal(eventual.attempts[0]?.outcome, "accepted");
  assert.equal(eventual.sends(), 1);
  const exhausted = setup(new WhatsAppCloudApiError(503, null), delivery(5));
  await exhausted.service.dispatchReady("worker");
  assert.equal(exhausted.attempts[0]?.outcome, "permanent_failure");
  const recovered = setup(null, delivery(1, "leased"));
  await recovered.service.dispatchReady("new-worker");
  assert.equal(recovered.attempts[0]?.outcome, "accepted");
  assert.equal(recovered.sends(), 1);
});

test("EPIC-027 Phase 5 keeps outbound queueing idempotent and never recreates conversation work", async () => {
  const value = setup(null);
  const input = { conversationId: conversation, conversationMessageId: messageId, whatsAppConnectionId: connectionId, recipientWaId: "wa" };
  await value.service.deliverWhatsAppText(context, 1, input);
  await value.service.deliverWhatsAppText(context, 1, input);
  assert.equal(value.records.length, 1);
  assert.equal(value.sends(), 0);
});
