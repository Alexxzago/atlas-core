import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantExecutionPort } from "../assistant/application/assistantExecutionPort.js";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import { reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import { InMemoryConversationTurnLock, OperationalConversationTurnService } from "../assistant/services/operationalConversationTurnService.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { createDatabase } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { createAsyncConversationRuntimePersistence } from "../conversation/infrastructure/asyncConversationFactory.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { ConversationControlService } from "../conversation/services/conversationControlService.js";
import { createAsyncMediaCore } from "../media/composition.js";
import { createAsyncMediaPersistence } from "../media/infrastructure/asyncMediaFactory.js";
import { SafeConversationAttachmentService } from "../media/services/safeConversationAttachmentService.js";
import { AssistantExecutionRecordRepository } from "../repositories/assistantExecutionRecordRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { reconstructWhatsAppConnection } from "../whatsapp/domain/whatsappConnection.js";
import { createAsyncWhatsAppPersistence } from "../whatsapp/infrastructure/asyncWhatsAppFactory.js";
import { AsyncWhatsAppExecutionLeaseLostError, type AsyncWhatsAppExecutionFinalization } from "../whatsapp/infrastructure/asyncWhatsAppInboundPersistence.js";
import { WhatsAppInboundMediaRecoveryService } from "../whatsapp/services/WhatsAppInboundMediaRecoveryService.js";
import { WhatsAppConnectionService } from "../whatsapp/services/WhatsAppConnectionService.js";
import { WhatsAppOutboundDeliveryService } from "../whatsapp/services/WhatsAppOutboundDeliveryService.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";
import { FakeWhatsAppOutboundProvider } from "./support/fakeWhatsAppOutboundProvider.js";

const at = "2026-09-22T12:00:00.000Z";
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class Clock { public now(): string { return at; } }
class Execution implements AssistantExecutionPort {
  public readonly requests: AssistantExecutionRequest[] = [];
  public constructor(private readonly outcome: AssistantExecutionResult["outcome"] | readonly AssistantExecutionResult["outcome"][] = "answered") {}
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> {
    this.requests.push(request);
    const outcome = Array.isArray(this.outcome) ? this.outcome[Math.min(this.requests.length - 1, this.outcome.length - 1)]! : this.outcome;
    return { outcome, answer: `Answer: ${request.message}` };
  }
}

class DeferredExecution implements AssistantExecutionPort {
  public readonly requests: AssistantExecutionRequest[] = [];
  private releaseResult: (() => void) | null = null;
  private readonly result = new Promise<void>(resolve => { this.releaseResult = resolve; });
  private signalStarted: (() => void) | null = null;
  public readonly started = new Promise<void>(resolve => { this.signalStarted = resolve; });
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> {
    this.requests.push(request);
    this.signalStarted?.();
    await this.result;
    return { outcome: "answered", answer: `Answer: ${request.message}` };
  }
  public release(): void { this.releaseResult?.(); }
}

function payload(kind: "text" | "image", wamid: string): Buffer {
  const message = kind === "text"
    ? { type: "text", from: "wa-customer", id: wamid, text: { body: "Hello Atlas" } }
    : { type: "image", from: "wa-customer", id: wamid, image: { id: `media-${wamid}`, mime_type: "image/png" } };
  return Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-epic056" }, messages: [message] } }] }] }));
}

async function fixture(execution: Execution | DeferredExecution = new Execution()) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic056-"));
  const database = createDatabase(join(directory, "atlas.sqlite"));
  const sql = new LocalSqlDatabase(database);
  const clock = new Clock();
  const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
  const companies = new CompanyRepository(database);
  const company = companies.create(context, { name: "Async Runtime", website: "https://async-runtime.test", status: "ready" });
  publishKnowledgeFixture(database, context, company.id, { company: { name: company.name, website: company.website, phone: "", email: "" }, business: { services: ["Advice"], hours: "Always", locations: [] }, faq: [] });
  const profiles = new AssistantProfileRepository(database);
  const profile = reconstructAssistantProfile({ id: "asp_0560000000000000000000000000000a", companyId: company.id, name: "Async", normalizedName: "async", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: at, updatedAt: at, archivedAt: null });
  profiles.create(context, company.id, profile);
  const whatsApp = createAsyncWhatsAppPersistence(sql);
  const connection = reconstructWhatsAppConnection({ id: "wac_0560000000000000000000000000000a", workspaceId: context.workspaceId, companyId: company.id, assistantProfileId: profile.id, phoneNumberId: "phone-epic056", whatsappBusinessAccountId: "waba-epic056", status: "active", createdAt: at, updatedAt: at });
  assert.ok(await whatsApp.connections.create(context, connection));
  const conversations = createAsyncConversationRuntimePersistence(sql);
  const conversationService = new ConversationService(conversations.conversations, clock);
  const mediaPersistence = createAsyncMediaPersistence(sql);
  const media = createAsyncMediaCore(sql, join(directory, "media"), clock, mediaPersistence);
  const turns = new OperationalConversationTurnService(companies, new CompanyKnowledgeRepository(database), profiles, conversationService, new OperationalAssistantRuntime(execution, new AssistantExecutionRecordRepository(database), clock), new InMemoryConversationTurnLock(), "test", 4, undefined, undefined, undefined, new SafeConversationAttachmentService(mediaPersistence.attachments), conversations.conversations);
  const connections = new WhatsAppConnectionService(companies, profiles, whatsApp.connections, clock);
  const provider = new FakeWhatsAppOutboundProvider();
  const outbound = new WhatsAppOutboundDeliveryService(conversations.conversations, whatsApp.connections, whatsApp.providerMessages, whatsApp.outboundDeliveries, { resolve: async () => "test-token" }, () => provider, clock, undefined, whatsApp.conversations);
  const webhook = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, connections, undefined, undefined, undefined, turns, clock, conversations.conversations, outbound, undefined, whatsApp.inbound);
  const inboundMedia = new WhatsAppInboundMediaRecoveryService(whatsApp.inboundMedia, { download: async () => ({ kind: "downloaded" as const, download: { mediaType: "image/png", filename: "image.png", content: (async function* (): AsyncIterable<Uint8Array> { yield png; })() } }) }, media.service, whatsApp.inboundMedia, clock);
  return { directory, database, context, company, connection, profile, execution, conversations, inbound: whatsApp.inbound, inboundMedia, outbound, provider, turns, webhook };
}

function request(database: ReturnType<typeof createDatabase>, wamid: string): { id: string } {
  return database.prepare("SELECT r.id FROM channel_execution_requests r JOIN channel_provider_events e ON e.id=r.channel_provider_event_id WHERE e.external_event_id=?").get(wamid) as { id: string };
}

async function close(value: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await new LocalSqlDatabase(value.database).close();
  rmSync(value.directory, { recursive: true, force: true });
}

async function safeFallbackReady(value: Awaited<ReturnType<typeof fixture>>, wamid: string): Promise<{ readonly executionId: string }> {
  await value.webhook.acknowledge(payload("text", wamid));
  await value.webhook.resumeIncomplete();
  const execution = value.database.prepare("SELECT id FROM assistant_execution_records WHERE state='safe_fallback'").get() as { id: string };
  assert.equal((value.database.prepare("SELECT state FROM conversation_controls").get() as { state: string }).state, "human_required");
  return execution;
}

async function assertSafeFallbackSuppressed(value: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await value.outbound.dispatchReady("outbound-worker");
  assert.deepEqual(value.provider.calls, []);
  assert.equal((value.database.prepare("SELECT state FROM outbound_deliveries").get() as { state: string }).state, "suppressed");
}

async function finalization(value: Awaited<ReturnType<typeof fixture>>, leased: { readonly id: string; readonly leaseExpiresAt: string | null }, owner: string, now: string): Promise<AsyncWhatsAppExecutionFinalization> {
  assert.ok(leased.leaseExpiresAt);
  const persisted = await value.inbound.loadLeasedExecutionContext(value.context, value.company.id, value.connection.id, leased.id as AsyncWhatsAppExecutionFinalization["requestId"], owner, now);
  assert.ok(persisted);
  const snapshot = value.database.prepare("SELECT snapshot_json FROM channel_execution_requests WHERE id=?").get(leased.id) as { snapshot_json: string };
  const replyIdempotencyKey = JSON.parse(snapshot.snapshot_json).replyIdempotencyKey as string;
  let execution: Pick<AsyncWhatsAppExecutionFinalization, "executionRecordId" | "authorityGeneration" | "content"> | null = null;
  await assert.rejects(value.turns.executePersistedInbound(value.context, value.company.id, persisted.binding.conversationId, { assistantProfileId: value.profile.id, outboundParticipantId: persisted.binding.assistantParticipantId, replyIdempotencyKey, whatsAppConnectionId: value.connection.id, whatsAppPhoneNumberId: value.connection.phoneNumberId }, persisted.inbound, { finalizeResponse: input => {
    execution = { executionRecordId: input.executionRecordId, authorityGeneration: input.authorityGeneration, content: input.content };
    return { kind: "execution_not_owned" };
  } }), /Conversation was not found/);
  assert.ok(execution);
  return { context: value.context, companyId: value.company.id, connectionId: value.connection.id, requestId: leased.id as AsyncWhatsAppExecutionFinalization["requestId"], owner, leaseExpiresAt: leased.leaseExpiresAt, now, eventId: persisted.event.id, conversationId: persisted.binding.conversationId, inboundMessageId: persisted.inbound.id, assistantProfileId: value.profile.id, assistantParticipantId: persisted.binding.assistantParticipantId, executionRecordId: execution.executionRecordId, authorityGeneration: execution.authorityGeneration, outcome: "answered", content: execution.content, replyIdempotencyKey, outboundMessageId: "cmsg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", providerMessageId: "pmr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", deliveryId: "odl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
}

test("EPIC056 resumes real async text capture, atomically finalizes, and dispatches Meta delivery", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-async-text"));
    assert.equal(await value.webhook.resumeIncomplete(), 1);
    assert.equal(await value.webhook.resumeIncomplete(), 0);
    value.provider.enqueueAccepted("wamid-outbound-text");
    await value.outbound.dispatchReady("outbound-worker");
    const requestState = value.database.prepare("SELECT state,outcome FROM channel_execution_requests").get() as { state: string; outcome: string };
    assert.equal(requestState.state, "completed");
    assert.equal(requestState.outcome, "answered");
    assert.deepEqual(value.execution.requests.map(request => request.message), ["Hello Atlas"]);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM assistant_execution_records WHERE state='answered'").get() as { count: number }).count, 1);
    assert.deepEqual(value.provider.calls, [{ kind: "text", providerMediaId: null }]);
    assert.equal((value.database.prepare("SELECT state FROM outbound_deliveries").get() as { state: string }).state, "accepted");
  } finally { await close(value); }
});

test("EPIC056 resumes with numeric limit and observes persisted direct-model substages", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-observed-resume"));
    const substages: string[] = [];
    await value.webhook.resumeIncomplete(1, substage => substages.push(substage));
    assert.deepEqual(substages, ["lease_requests", "resolve_connection", "load_execution_context", "ensure_control_and_reopen", "execute_operational_turn", "prepare_turn_context", "create_execution_record", "model_provider_call", "persist_execution_record", "atomic_finalize"]);

    await value.webhook.acknowledge(payload("text", "wamid-observer-throws"));
    await value.webhook.resumeIncomplete(1, () => { throw new Error("observability failure"); });
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM assistant_execution_records WHERE state='answered'").get() as { count: number }).count, 2);
  } finally { await close(value); }
});

test("EPIC056 recovers real inbound image media before resuming and dispatching", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("image", "wamid-async-image"));
    const captured = request(value.database, "wamid-async-image");
    assert.equal((value.database.prepare("SELECT media_gate_state FROM channel_execution_requests WHERE id=?").get(captured.id) as { media_gate_state: string }).media_gate_state, "blocked_by_media");
    assert.equal((await value.inboundMedia.recoverAvailable("media-worker")).length, 1);
    assert.equal((value.database.prepare("SELECT media_gate_state FROM channel_execution_requests WHERE id=?").get(captured.id) as { media_gate_state: string }).media_gate_state, "open");
    await value.webhook.resumeIncomplete();
    value.provider.enqueueAccepted("wamid-outbound-image");
    await value.outbound.dispatchReady("outbound-worker");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM media_asset_associations").get() as { count: number }).count, 1);
    assert.deepEqual(value.execution.requests.map(request => request.attachments), [[{ kind: "image", status: "available", mimeType: "image/png", filename: "image.png" }]]);
    assert.equal((value.database.prepare("SELECT state FROM outbound_deliveries").get() as { state: string }).state, "accepted");
  } finally { await close(value); }
});

test("EPIC056 stale finalizer loses after lease takeover without outbound records while the replacement completes one chain", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-stale-finalizer"));
    const oldExpiry = "2026-09-22T11:59:00.000Z";
    const [oldLease] = await value.inbound.leaseExecutionRequests("worker-a", "2026-09-22T11:58:00.000Z", oldExpiry, 1);
    assert.ok(oldLease);
    const [replacementLease] = await value.inbound.leaseExecutionRequests("worker-b", at, "2026-09-22T12:01:00.000Z", 1);
    assert.ok(replacementLease);
    const replacement = await finalization(value, replacementLease, "worker-b", at);
    await assert.rejects(value.inbound.finalizeLeasedExecution({ ...replacement, owner: "worker-a", leaseExpiresAt: oldExpiry }), AsyncWhatsAppExecutionLeaseLostError);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 0);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
    assert.equal((await value.inbound.finalizeLeasedExecution(replacement)).kind, "finalized");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 1);
  } finally { await close(value); }
});

test("EPIC056 leased context and finalizer deny foreign workspace, company, and connection", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-tenant-fence"));
    const [leased] = await value.inbound.leaseExecutionRequests("fence-worker", at, "2026-09-22T12:01:00.000Z", 1);
    assert.ok(leased);
    const input = await finalization(value, leased, "fence-worker", at);
    const workspaces = new WorkspaceRepository(value.database);
    const foreignContext = createWorkspaceContext(workspaces.createForSystemUse({ key: "epic056-foreign", name: "Foreign" }));
    const foreignCompany = new CompanyRepository(value.database).create(value.context, { name: "Foreign Company", website: "https://foreign.test", status: "ready" });
    const foreignProfile = reconstructAssistantProfile({ ...value.profile, id: "asp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", companyId: foreignCompany.id, createdAt: at, updatedAt: at });
    new AssistantProfileRepository(value.database).create(value.context, foreignCompany.id, foreignProfile);
    const foreignConnection = reconstructWhatsAppConnection({ ...value.connection, id: "wac_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", companyId: foreignCompany.id, assistantProfileId: foreignProfile.id, phoneNumberId: "phone-foreign", createdAt: at, updatedAt: at });
    assert.ok(await createAsyncWhatsAppPersistence(new LocalSqlDatabase(value.database)).connections.create(value.context, foreignConnection));
    for (const denied of [{ ...input, context: foreignContext }, { ...input, companyId: foreignCompany.id }, { ...input, connectionId: foreignConnection.id }]) {
      assert.equal(await value.inbound.loadLeasedExecutionContext(denied.context, denied.companyId, denied.connectionId, denied.requestId, denied.owner, denied.now), null);
      await assert.rejects(value.inbound.finalizeLeasedExecution(denied), AsyncWhatsAppExecutionLeaseLostError);
    }
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 0);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
  } finally { await close(value); }
});

test("EPIC056 duplicate async workers produce one execution and outbound delivery chain", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-duplicate-workers"));
    await Promise.all([value.webhook.resumeIncomplete(), value.webhook.resumeIncomplete()]);
    assert.equal(value.execution.requests.length, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM assistant_execution_records WHERE state='answered'").get() as { count: number }).count, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE direction='outbound'").get() as { count: number }).count, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 1);
  } finally { await close(value); }
});

test("EPIC056 deferred async finalization suppresses an answer after a real control takeover", async () => {
  const execution = new DeferredExecution(), value = await fixture(execution);
  try {
    await value.webhook.acknowledge(payload("text", "wamid-authority-fence"));
    const resuming = value.webhook.resumeIncomplete();
    await execution.started;
    const conversation = value.database.prepare("SELECT conversation_id FROM whatsapp_conversation_bindings").get() as { conversation_id: string };
    const current = await value.conversations.conversations.findConversationControl(value.context, value.company.id, conversation.conversation_id as never);
    assert.ok(current);
    await new ConversationControlService(new ConversationService(value.conversations.conversations, new Clock()), value.conversations.conversations, new Clock()).takeOver(value.context, "usr_0560000000000000000000000000000a" as never, value.company.id, conversation.conversation_id, { expectedVersion: current.version, operationId: "cco_0560000000000000000000000000000a" });
    execution.release();
    await resuming;
    const requestState = value.database.prepare("SELECT state,outcome FROM channel_execution_requests").get() as { state: string; outcome: string };
    assert.equal(requestState.state, "completed");
    assert.equal(requestState.outcome, "suppressed");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE direction='outbound'").get() as { count: number }).count, 0);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
  } finally { await close(value); }
});

test("EPIC056 async safe fallback retains its outcome and marks the conversation for human attention", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    await value.webhook.acknowledge(payload("text", "wamid-safe-fallback"));
    await value.webhook.resumeIncomplete();
    const requestState = value.database.prepare("SELECT state,outcome FROM channel_execution_requests").get() as { state: string; outcome: string };
    const control = value.database.prepare("SELECT state,attention_reason FROM conversation_controls").get() as { state: string; attention_reason: string };
    assert.equal(requestState.state, "completed");
    assert.equal(requestState.outcome, "safe_fallback");
    assert.equal(control.state, "human_required");
    assert.equal(control.attention_reason, "automation_failure");
  } finally { await close(value); }
});

test("EPIC056 dispatches an async image safe fallback once while the conversation requires human attention", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    await value.webhook.acknowledge(payload("image", "wamid-image-safe-fallback"));
    assert.equal((await value.inboundMedia.recoverAvailable("media-worker")).length, 1);
    await value.webhook.resumeIncomplete();
    const delivery = value.database.prepare("SELECT state,expected_authority_generation FROM outbound_deliveries").get() as { state: string; expected_authority_generation: number };
    const control = value.database.prepare("SELECT state,authority_generation FROM conversation_controls").get() as { state: string; authority_generation: number };
    assert.equal(delivery.state, "pending");
    assert.equal(control.state, "human_required");
    assert.equal(delivery.expected_authority_generation, control.authority_generation);
    value.provider.enqueueAccepted("wamid-image-safe-fallback-outbound");
    await value.outbound.dispatchReady("outbound-worker");
    assert.deepEqual(value.provider.calls, [{ kind: "text", providerMediaId: null }]);
    assert.equal((value.database.prepare("SELECT state FROM outbound_deliveries").get() as { state: string }).state, "accepted");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE direction='outbound'").get() as { count: number }).count, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 1);
  } finally { await close(value); }
});

test("EPIC056 dispatches a normal async text reply after safe fallback while attention remains active", async () => {
  const value = await fixture(new Execution(["safe_fallback", "answered"]));
  try {
    await value.webhook.acknowledge(payload("text", "wamid-fallback-first"));
    await value.webhook.resumeIncomplete();
    value.provider.enqueueAccepted("wamid-fallback-first-outbound");
    await value.outbound.dispatchReady("outbound-worker");

    await value.webhook.acknowledge(payload("text", "wamid-human-required-text"));
    await value.webhook.resumeIncomplete();
    value.provider.enqueueAccepted("wamid-human-required-text-outbound");
    await value.outbound.dispatchReady("outbound-worker");

    assert.equal(value.execution.requests.length, 2);
    assert.equal((value.database.prepare("SELECT state FROM conversation_controls").get() as { state: string }).state, "human_required");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM assistant_execution_records WHERE state='answered'").get() as { count: number }).count, 1);
    assert.deepEqual(value.database.prepare("SELECT state FROM outbound_deliveries ORDER BY created_at,id").all().map((delivery: { state: string }) => delivery.state), ["accepted", "accepted"]);
    assert.equal(value.provider.calls.length, 2);
  } finally { await close(value); }
});

test("EPIC056 dispatches a normal async image reply after safe fallback while attention remains active", async () => {
  const value = await fixture(new Execution(["safe_fallback", "answered"]));
  try {
    await value.webhook.acknowledge(payload("text", "wamid-fallback-before-image"));
    await value.webhook.resumeIncomplete();
    value.provider.enqueueAccepted("wamid-fallback-before-image-outbound");
    await value.outbound.dispatchReady("outbound-worker");

    await value.webhook.acknowledge(payload("image", "wamid-human-required-image"));
    assert.equal((await value.inboundMedia.recoverAvailable("media-worker")).length, 1);
    await value.webhook.resumeIncomplete();
    value.provider.enqueueAccepted("wamid-human-required-image-outbound");
    await value.outbound.dispatchReady("outbound-worker");

    assert.equal(value.execution.requests.length, 2);
    assert.equal((value.database.prepare("SELECT state FROM conversation_controls").get() as { state: string }).state, "human_required");
    assert.equal((value.database.prepare("SELECT media_gate_state FROM channel_execution_requests ORDER BY created_at DESC LIMIT 1").get() as { media_gate_state: string }).media_gate_state, "open");
    assert.deepEqual(value.database.prepare("SELECT state FROM outbound_deliveries ORDER BY created_at,id").all().map((delivery: { state: string }) => delivery.state), ["accepted", "accepted"]);
    assert.equal(value.provider.calls.length, 2);
  } finally { await close(value); }
});

test("EPIC056 suppresses an async image safe fallback after a human takeover", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    await value.webhook.acknowledge(payload("image", "wamid-image-fallback-takeover"));
    assert.equal((await value.inboundMedia.recoverAvailable("media-worker")).length, 1);
    await value.webhook.resumeIncomplete();
    const conversation = value.database.prepare("SELECT conversation_id FROM whatsapp_conversation_bindings").get() as { conversation_id: string };
    const current = await value.conversations.conversations.findConversationControl(value.context, value.company.id, conversation.conversation_id as never);
    assert.equal(current?.state, "human_required");
    await new ConversationControlService(new ConversationService(value.conversations.conversations, new Clock()), value.conversations.conversations, new Clock()).takeOver(value.context, "usr_0560000000000000000000000000000a" as never, value.company.id, conversation.conversation_id, { expectedVersion: current!.version, operationId: "cco_0560000000000000000000000000000g" });
    await value.outbound.dispatchReady("outbound-worker");
    assert.deepEqual(value.provider.calls, []);
    assert.equal((value.database.prepare("SELECT state FROM outbound_deliveries").get() as { state: string }).state, "suppressed");
  } finally { await close(value); }
});

test("EPIC056 suppresses a safe fallback linked to a foreign-company execution", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    const execution = await safeFallbackReady(value, "wamid-fallback-foreign-execution");
    const foreign = new CompanyRepository(value.database).create(value.context, { name: "Foreign Execution", website: "https://foreign-execution.test", status: "ready" });
    value.database.prepare("UPDATE assistant_execution_records SET company_id=? WHERE id=?").run(foreign.id, execution.id);
    await assertSafeFallbackSuppressed(value);
  } finally { await close(value); }
});

test("EPIC056 suppresses a safe fallback linked to a non-operational execution", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    const execution = await safeFallbackReady(value, "wamid-fallback-preview-execution");
    value.database.prepare("UPDATE assistant_execution_records SET purpose='preview' WHERE id=?").run(execution.id);
    await assertSafeFallbackSuppressed(value);
  } finally { await close(value); }
});

test("EPIC056 suppresses a safe fallback with a mismatched execution conversation snapshot", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    const execution = await safeFallbackReady(value, "wamid-fallback-conversation-snapshot");
    value.database.prepare("UPDATE assistant_execution_records SET execution_snapshot_json=json_set(execution_snapshot_json,'$.conversationId','cnv_wrong') WHERE id=?").run(execution.id);
    await assertSafeFallbackSuppressed(value);
  } finally { await close(value); }
});

test("EPIC056 suppresses a safe fallback with a mismatched execution authority snapshot", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    const execution = await safeFallbackReady(value, "wamid-fallback-authority-snapshot");
    value.database.prepare("UPDATE assistant_execution_records SET execution_snapshot_json=json_set(execution_snapshot_json,'$.authorityGeneration',999) WHERE id=?").run(execution.id);
    await assertSafeFallbackSuppressed(value);
  } finally { await close(value); }
});

test("EPIC056 suppresses a finalized delivery when a human takes over before dispatch", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-dispatch-takeover"));
    const [leased] = await value.inbound.leaseExecutionRequests("finalizer", at, "2026-09-22T12:01:00.000Z", 1);
    assert.ok(leased);
    const input = await finalization(value, leased, "finalizer", at);
    assert.equal((await value.inbound.finalizeLeasedExecution(input)).kind, "finalized");
    assert.equal((value.database.prepare("SELECT expected_authority_generation FROM outbound_deliveries").get() as { expected_authority_generation: number }).expected_authority_generation, input.authorityGeneration);
    const current = await value.conversations.conversations.findConversationControl(value.context, value.company.id, input.conversationId as never);
    assert.ok(current);
    await new ConversationControlService(new ConversationService(value.conversations.conversations, new Clock()), value.conversations.conversations, new Clock()).takeOver(value.context, "usr_0560000000000000000000000000000a" as never, value.company.id, input.conversationId, { expectedVersion: current.version, operationId: "cco_0560000000000000000000000000000b" });
    await value.outbound.dispatchReady("outbound-worker");
    assert.deepEqual(value.provider.calls, []);
    assert.equal((value.database.prepare("SELECT state FROM outbound_deliveries").get() as { state: string }).state, "suppressed");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 1);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 1);
  } finally { await close(value); }
});

test("EPIC056 suppresses finalization when the bound connection becomes inactive", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-inactive-finalizer"));
    const [leased] = await value.inbound.leaseExecutionRequests("finalizer", at, "2026-09-22T12:01:00.000Z", 1);
    assert.ok(leased);
    const input = await finalization(value, leased, "finalizer", at);
    value.database.prepare("UPDATE whatsapp_connections SET status='inactive' WHERE id=?").run(value.connection.id);
    assert.equal((await value.inbound.finalizeLeasedExecution(input)).kind, "authority_lost");
    assert.deepEqual(value.provider.calls, []);
    assert.equal((value.database.prepare("SELECT state,outcome FROM channel_execution_requests").get() as { state: string; outcome: string }).state, "completed");
    assert.equal((value.database.prepare("SELECT state,outcome FROM channel_execution_requests").get() as { state: string; outcome: string }).outcome, "suppressed");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE direction='outbound'").get() as { count: number }).count, 0);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 0);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
  } finally { await close(value); }
});

test("EPIC056 async finalization writes one canonical assistant audit event across idempotent reuse", async () => {
  const value = await fixture();
  try {
    await value.webhook.acknowledge(payload("text", "wamid-audit-event"));
    const [leased] = await value.inbound.leaseExecutionRequests("finalizer", at, "2026-09-22T12:01:00.000Z", 1);
    assert.ok(leased);
    const input = await finalization(value, leased, "finalizer", at);
    assert.equal((await value.inbound.finalizeLeasedExecution(input)).kind, "finalized");
    value.database.prepare("UPDATE channel_execution_requests SET state='leased',lease_owner=?,lease_expires_at=? WHERE id=?").run(input.owner, input.leaseExpiresAt, input.requestId);
    value.database.prepare("UPDATE channel_provider_events SET state='claimed' WHERE id=?").run(input.eventId);
    assert.equal((await value.inbound.finalizeLeasedExecution(input)).kind, "replayed");
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM conversation_events WHERE event_type='assistant_message_created'").get() as { count: number }).count, 1);
  } finally { await close(value); }
});

test("EPIC056 persistent controls mark human attention, reopen inbound resolution, and gate async execution", async () => {
  const value = await fixture(new Execution("safe_fallback"));
  try {
    await value.webhook.acknowledge(payload("text", "wamid-controls-first"));
    await value.webhook.resumeIncomplete();
    const conversation = value.database.prepare("SELECT conversation_id FROM whatsapp_conversation_bindings").get() as { conversation_id: string };
    let current = await value.conversations.conversations.findConversationControl(value.context, value.company.id, conversation.conversation_id as never);
    assert.equal(current?.state, "human_required");
    const controls = new ConversationControlService(new ConversationService(value.conversations.conversations, new Clock()), value.conversations.conversations, new Clock());
    current = await controls.resume(value.context, "usr_0560000000000000000000000000000a" as never, value.company.id, conversation.conversation_id, { expectedVersion: current!.version, operationId: "cco_0560000000000000000000000000000c" });
    current = await controls.takeOver(value.context, "usr_0560000000000000000000000000000a" as never, value.company.id, conversation.conversation_id, { expectedVersion: current.version, operationId: "cco_0560000000000000000000000000000d" });
    await controls.resolve(value.context, "usr_0560000000000000000000000000000a" as never, value.company.id, conversation.conversation_id, { expectedVersion: current.version, operationId: "cco_0560000000000000000000000000000e" });
    assert.notEqual((value.database.prepare("SELECT resolved_at FROM conversation_controls WHERE conversation_id=?").get(conversation.conversation_id) as { resolved_at: string | null }).resolved_at, null);
    current = await value.conversations.conversations.findConversationControl(value.context, value.company.id, conversation.conversation_id as never);
    assert.ok(current);
    await controls.takeOver(value.context, "usr_0560000000000000000000000000000a" as never, value.company.id, conversation.conversation_id, { expectedVersion: current.version, operationId: "cco_0560000000000000000000000000000f" });
    await value.webhook.acknowledge(payload("text", "wamid-controls-second"));
    await value.webhook.resumeIncomplete();
    const persisted = value.database.prepare("SELECT state,resolved_at FROM conversation_controls WHERE conversation_id=?").get(conversation.conversation_id) as { state: string; resolved_at: string | null };
    assert.equal(persisted.state, "human_controlled");
    assert.equal(persisted.resolved_at, null);
    assert.equal(value.execution.requests.length, 1);
  } finally { await close(value); }
});
