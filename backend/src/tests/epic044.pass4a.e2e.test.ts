import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantExecutionPort } from "../assistant/application/assistantExecutionPort.js";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import { assistantProfileId, reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import { InMemoryConversationTurnLock, OperationalConversationTurnService } from "../assistant/services/operationalConversationTurnService.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { createDatabase } from "../config/database.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { ConversationIntelligenceService } from "../conversationIntelligence/services/conversationIntelligenceService.js";
import { AssistantExecutionRecordRepository } from "../repositories/assistantExecutionRecordRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { ChannelProviderEventRepository } from "../repositories/channelProviderEventRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { ConversationIntelligenceRepository } from "../repositories/conversationIntelligenceRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WhatsAppConversationRepository } from "../repositories/whatsappConversationRepository.js";
import { WhatsAppVoiceRepository } from "../repositories/whatsappVoiceRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { reconstructWhatsAppConnection, whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";
import { WhatsAppConnectionService } from "../whatsapp/services/WhatsAppConnectionService.js";
import { resolveVoiceSemanticMessage, includeVoiceSemanticHistory } from "../whatsapp/services/voiceSemanticContentResolver.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";
import { VoiceDeferredSemanticRecoveryService } from "../whatsapp/services/voiceDeferredSemanticRecoveryService.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";

const at = "2026-08-27T12:00:00.000Z";

class Clock { public now(): string { return at; } }
class Execution implements AssistantExecutionPort {
  public readonly requests: AssistantExecutionRequest[] = [];
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> { this.requests.push(request); return { outcome: "answered", answer: "Recovered answer" }; }
}
class PausedExecution implements AssistantExecutionPort {
  public readonly requests: AssistantExecutionRequest[] = [];
  private enteredResolve!: () => void;
  private resumeResolve!: () => void;
  public readonly entered = new Promise<void>((resolve) => { this.enteredResolve = resolve; });
  private readonly resumed = new Promise<void>((resolve) => { this.resumeResolve = resolve; });
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> { this.requests.push(request); this.enteredResolve(); await this.resumed; return { outcome: "answered", answer: "Recovered answer" }; }
  public resume(): void { this.resumeResolve(); }
}

function payload(wamid: string): Buffer {
  return Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-pass4a" }, messages: [{ type: "audio", from: "customer-pass4a", id: wamid, audio: { id: `media-${wamid}`, mime_type: "audio/ogg" } }] } }] }] }));
}

function profile(companyId: number) {
  return reconstructAssistantProfile({ id: assistantProfileId("asp_0440000000000000000000000000000a"), companyId, name: "Voice", normalizedName: "voice", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: at, updatedAt: at, archivedAt: null });
}

function semantic(voices: WhatsAppVoiceRepository) {
  return {
    resolveInbound: (context: import("../types/workspaceContext.js").WorkspaceContext, companyId: number, message: import("../conversation/domain/conversation.js").ConversationMessage) => resolveVoiceSemanticMessage(voices, context, companyId, message),
    includeHistory: (context: import("../types/workspaceContext.js").WorkspaceContext, companyId: number, message: import("../conversation/domain/conversation.js").ConversationMessage) => includeVoiceSemanticHistory(voices, context, companyId, message),
    applyAssistant: () => true,
  };
}

function setup(path: string) {
  const database = createDatabase(path), clock = new Clock(), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
  const companies = new CompanyRepository(database), company = companies.create(context, { name: "PASS4A", website: "https://pass4a.test", status: "ready" });
  publishKnowledgeFixture(database, context, company.id, { company: { name: company.name, website: company.website, phone: "", email: "" }, business: { services: ["Advice"], hours: "Always", locations: [] }, faq: [] });
  const profiles = new AssistantProfileRepository(database), ready = profile(company.id); profiles.create(context, company.id, ready);
  const connections = new WhatsAppConnectionRepository(database), connection = reconstructWhatsAppConnection({ id: whatsAppConnectionId("wac_0440000000000000000000000000000a"), workspaceId: context.workspaceId, companyId: company.id, assistantProfileId: ready.id, phoneNumberId: "phone-pass4a", whatsappBusinessAccountId: "waba-pass4a", status: "active", createdAt: at, updatedAt: at });
  assert.ok(connections.create(context, connection));
  const conversationRepository = new ConversationRepository(database), conversations = new ConversationService(conversationRepository, clock), events = new ChannelProviderEventRepository(database), bindings = new WhatsAppConversationRepository(database), voices = new WhatsAppVoiceRepository(database);
  const connectionService = new WhatsAppConnectionService(companies, profiles, connections, clock);
  const execution = new Execution(), turns = new OperationalConversationTurnService(companies, new CompanyKnowledgeRepository(database), profiles, conversations, new OperationalAssistantRuntime(execution, new AssistantExecutionRecordRepository(database), clock), new InMemoryConversationTurnLock(), "test", 4, undefined, undefined, undefined, undefined, conversationRepository, semantic(voices));
  const webhook = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, connectionService, bindings, events, conversations, turns, clock, conversationRepository);
  return { database, context, company, connection, conversationRepository, events, voices, execution, webhook };
}

function captureVoice(fixture: ReturnType<typeof setup>, wamid: string): { conversationId: string; messageId: string; eventId: string; requestId: string } {
  const row = fixture.database.prepare("SELECT e.conversation_id, e.conversation_message_id AS message_id, e.id AS event_id, r.id AS request_id FROM channel_provider_events e JOIN channel_execution_requests r ON r.channel_provider_event_id=e.id WHERE e.external_event_id=?").get(wamid) as { conversation_id: string; message_id: string; event_id: string; request_id: string } | undefined;
  assert.ok(row);
  fixture.conversationRepository.ensureConversationControl(fixture.context, fixture.company.id, row.conversation_id as never);
  fixture.database.prepare("INSERT INTO media_blobs(id,workspace_id,company_id,sha256_digest,size_bytes,media_type,storage_reference,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(`mbl_${wamid}`, fixture.context.workspaceId, fixture.company.id, "a".repeat(64), 12, "audio/ogg", `memory://${wamid}`, "active", at);
  const assetId = `mas_${wamid}`;
  fixture.database.prepare("INSERT INTO media_assets(id,workspace_id,company_id,blob_id,kind,media_type,size_bytes,safe_filename,metadata_json,status,created_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(assetId, fixture.context.workspaceId, fixture.company.id, `mbl_${wamid}`, "audio", "audio/ogg", 12, "voice.ogg", "{}", "ready", at, null, null);
  fixture.database.prepare("UPDATE whatsapp_inbound_media SET state='associated',media_asset_id=?,completed_at=? WHERE channel_provider_event_id=?").run(assetId, at, row.event_id);
  assert.equal(fixture.voices.applyPolicy(fixture.context, fixture.company.id, fixture.connection.id, { actorId: "test", operationId: `enable-${wamid}`, expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "text_only", occurredAt: at }).kind, "applied");
  assert.equal(fixture.voices.enqueueTranscriptionAndBlockExecution(fixture.context, fixture.company.id, fixture.connection.id, row.event_id, { id: `atr_${wamid}`, mediaAssetId: assetId, createdAt: at, updatedAt: at }).kind, "created");
  return { conversationId: row.conversation_id, messageId: row.message_id, eventId: row.event_id, requestId: row.request_id };
}

test("EPIC044 PASS4A resumes a file-backed audio request using its durable transcript", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-pass4a-")), path = join(directory, "atlas.sqlite");
  const fixture = setup(path);
  try {
    await fixture.webhook.acknowledge(payload("wamid-pass4a"));
    const captured = captureVoice(fixture, "wamid-pass4a"), leased = fixture.voices.leaseTranscriptions(fixture.context, fixture.company.id, { owner: "stt", now: at, expiresAt: "2026-08-27T12:01:00.000Z", limit: 1 })[0]!;
    assert.equal(fixture.voices.finalizeTranscription(fixture.context, fixture.company.id, leased.id, "stt", { transcript: { id: "cat_pass4a", conversationId: captured.conversationId, messageId: captured.messageId, mediaAssetId: leased.mediaAssetId, normalizedTranscript: "Exact durable transcript", languageTag: "en", inputDigest: "b".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: at }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: at, updatedAt: at } }).kind, "opened");
    assert.equal((fixture.database.prepare("SELECT content FROM conversation_messages WHERE id=?").get(captured.messageId) as { content: string }).content, "[attachment received]");
    fixture.database.close();
    const recovered = setupRecovery(path);
    try {
      await recovered.webhook.resumeIncomplete();
      assert.deepEqual(recovered.execution.requests.map((request) => request.message), ["Exact durable transcript"]);
      assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE direction='inbound'").get() as { count: number }).count, 1);
      assert.equal((recovered.database.prepare("SELECT normalized_transcript FROM conversation_audio_transcripts").get() as { normalized_transcript: string }).normalized_transcript, "Exact durable transcript");
    } finally { recovered.database.close(); }
  } finally { if (fixture.database.isOpen) fixture.database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC044 PASS4A suppresses an inconsistent open audio request without calling runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-pass4a-inconsistent-")), path = join(directory, "atlas.sqlite");
  const fixture = setup(path);
  try {
    await fixture.webhook.acknowledge(payload("wamid-inconsistent"));
    const captured = captureVoice(fixture, "wamid-inconsistent");
    fixture.database.prepare("UPDATE channel_execution_requests SET media_gate_state='open' WHERE id=?").run(captured.requestId);
    fixture.database.close();
    const recovered = setupRecovery(path);
    try {
      await recovered.webhook.resumeIncomplete();
      assert.equal(recovered.execution.requests.length, 0);
      const request = recovered.database.prepare("SELECT state,outcome FROM channel_execution_requests WHERE id=?").get(captured.requestId) as { state: string; outcome: string };
      assert.equal(request.state, "completed");
      assert.equal(request.outcome, "suppressed");
    } finally { recovered.database.close(); }
  } finally { if (fixture.database.isOpen) fixture.database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("EPIC044 PASS4C fences a recovered audio turn taken over during runtime and never reexecutes after release or resolve", async () => {
  for (const operation of ["release", "resolve"] as const) {
    const directory = mkdtempSync(join(tmpdir(), `atlas-epic044-pass4c-${operation}-`)), path = join(directory, "atlas.sqlite"), fixture = setup(path);
    try {
      await fixture.webhook.acknowledge(payload(`wamid-pass4c-${operation}`));
      const captured = captureVoice(fixture, `wamid-pass4c-${operation}`), leased = fixture.voices.leaseTranscriptions(fixture.context, fixture.company.id, { owner: "stt", now: at, expiresAt: "2026-08-27T12:01:00.000Z", limit: 1 })[0]!;
      assert.equal(fixture.voices.finalizeTranscription(fixture.context, fixture.company.id, leased.id, "stt", { transcript: { id: `cat_pass4c_${operation}`, conversationId: captured.conversationId, messageId: captured.messageId, mediaAssetId: leased.mediaAssetId, normalizedTranscript: "Takeover durable transcript", languageTag: "en", inputDigest: "c".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: at }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: at, updatedAt: at } }).kind, "opened");
      assert.deepEqual({ ...(fixture.database.prepare("SELECT state,media_gate_state FROM channel_execution_requests WHERE id=?").get(captured.requestId) as Record<string, unknown>) }, { state: "pending", media_gate_state: "open" });
      fixture.database.close();
      const execution = new PausedExecution(), recovered = setupRecovery(path, execution);
      let second: DatabaseSync | null = new DatabaseSync(path);
      second.exec("PRAGMA foreign_keys=ON");
      try {
        const resuming = recovered.webhook.resumeIncomplete();
        await execution.entered;
        assert.equal(new ConversationRepository(second).applyConversationControlOperation(recovered.context, recovered.company.id, captured.conversationId as never, { operationId: `takeover-pass4c-${operation}`, operation: "takeover", actorId: "usr_operator" as never, expectedVersion: 2, occurredAt: "2026-08-27T12:01:00.000Z" }).kind, "applied");
        second.close();
        second = null;
        execution.resume();
        await resuming;
        assert.deepEqual(execution.requests.map((request) => request.message), ["Takeover durable transcript"]);
        assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id=? AND direction='outbound'").get(captured.conversationId) as { count: number }).count, 0);
        assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM provider_message_records WHERE direction='outbound'").get() as { count: number }).count, 0);
        assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
        assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM voice_response_visibility").get() as { count: number }).count, 0);
        assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_messages WHERE conversation_message_id=?").get(captured.messageId) as { count: number }).count, 1);
        assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM conversation_intelligence_applied_messages WHERE conversation_message_id<>?").get(captured.messageId) as { count: number }).count, 0);
        assert.equal(await new VoiceDeferredSemanticRecoveryService(recovered.voices, recovered.intelligence).recover(recovered.context, recovered.company.id), 0);
        assert.deepEqual(recovered.derived, [captured.messageId]);
        assert.deepEqual({ ...(recovered.database.prepare("SELECT state,outcome FROM channel_execution_requests WHERE id=?").get(captured.requestId) as Record<string, unknown>) }, { state: "completed", outcome: "suppressed" });
        second = new DatabaseSync(path);
        second.exec("PRAGMA foreign_keys=ON");
        assert.equal(new ConversationRepository(second).applyConversationControlOperation(recovered.context, recovered.company.id, captured.conversationId as never, { operationId: `${operation}-pass4c`, operation, actorId: "usr_operator" as never, expectedVersion: 3, occurredAt: "2026-08-27T12:02:00.000Z" }).kind, "applied");
        second.close();
        second = null;
        await recovered.webhook.resumeIncomplete();
        assert.equal(execution.requests.length, 1);
      } finally { second?.close(); recovered.database.close(); }
    } finally { if (fixture.database.isOpen) fixture.database.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test("EPIC044 PASS4C suppresses a takeover before recovered runtime execution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic044-pass4c-before-runtime-")), path = join(directory, "atlas.sqlite"), fixture = setup(path);
  try {
    await fixture.webhook.acknowledge(payload("wamid-pass4c-before-runtime"));
    const captured = captureVoice(fixture, "wamid-pass4c-before-runtime"), leased = fixture.voices.leaseTranscriptions(fixture.context, fixture.company.id, { owner: "stt", now: at, expiresAt: "2026-08-27T12:01:00.000Z", limit: 1 })[0]!;
    assert.equal(fixture.voices.finalizeTranscription(fixture.context, fixture.company.id, leased.id, "stt", { transcript: { id: "cat_pass4c_before_runtime", conversationId: captured.conversationId, messageId: captured.messageId, mediaAssetId: leased.mediaAssetId, normalizedTranscript: "Before runtime transcript", languageTag: "en", inputDigest: "d".repeat(64), outcome: "completed", safeFailureCategory: null, createdAt: at }, settlement: { state: "completed", safeOutcome: "completed", safeFailureCategory: null, completedAt: at, updatedAt: at } }).kind, "opened");
    fixture.database.close();
    const recovered = setupRecovery(path);
    let second: DatabaseSync | null = new DatabaseSync(path);
    second.exec("PRAGMA foreign_keys=ON");
    try {
      assert.equal(new ConversationRepository(second).applyConversationControlOperation(recovered.context, recovered.company.id, captured.conversationId as never, { operationId: "takeover-pass4c-before-runtime", operation: "takeover", actorId: "usr_operator" as never, expectedVersion: 1, occurredAt: "2026-08-27T12:01:00.000Z" }).kind, "applied");
      second.close();
      second = null;
      await recovered.webhook.resumeIncomplete();
      assert.equal(recovered.execution.requests.length, 0);
      assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id=? AND direction='inbound'").get(captured.conversationId) as { count: number }).count, 1);
      assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id=? AND direction='outbound'").get(captured.conversationId) as { count: number }).count, 0);
      assert.equal((recovered.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
    } finally { second?.close(); recovered.database.close(); }
  } finally { if (fixture.database.isOpen) fixture.database.close(); rmSync(directory, { recursive: true, force: true }); }
});

function setupRecovery(path: string, execution: Execution | PausedExecution = new Execution()) {
  const database = createDatabase(path), clock = new Clock(), context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault()), companies = new CompanyRepository(database), company = companies.findById(context, 1)!;
  const profiles = new AssistantProfileRepository(database), connections = new WhatsAppConnectionRepository(database), conversationRepository = new ConversationRepository(database), conversations = new ConversationService(conversationRepository, clock), events = new ChannelProviderEventRepository(database), bindings = new WhatsAppConversationRepository(database), voices = new WhatsAppVoiceRepository(database), derived: string[] = [];
  const intelligence = new ConversationIntelligenceService(new ConversationIntelligenceRepository(database), { derive: async ({ message }) => { derived.push(message.id); return [{ kind: "set_fact", key: "voice", value: message.content }] as const; } }, clock);
  const turns = new OperationalConversationTurnService(companies, new CompanyKnowledgeRepository(database), profiles, conversations, new OperationalAssistantRuntime(execution, new AssistantExecutionRecordRepository(database), clock), new InMemoryConversationTurnLock(), "test", 4, intelligence, undefined, undefined, undefined, conversationRepository, semantic(voices));
  const webhook = new WhatsAppWebhookService({ appSecret: "", verifyToken: "" }, new WhatsAppConnectionService(companies, profiles, connections, clock), bindings, events, conversations, turns, clock, conversationRepository);
  return { database, context, company, derived, execution, intelligence, voices, webhook };
}
