import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { ConversationService } from "../../conversation/services/conversationService.js";
import { conversationId, conversationParticipantId, type ConversationMessage } from "../../conversation/domain/conversation.js";
import type { CompanyKnowledgeVersion } from "../../knowledge/domain/knowledge.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import type { AssistantConversationHistoryEntry, AssistantExecutionResult } from "../application/assistantExecution.js";
import { assistantProfileId } from "../domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../domain/assistantProfilePolicies.js";
import type { OperationalAssistantRuntime } from "./operationalAssistantRuntime.js";
import type { ConversationIntelligenceService } from "../../conversationIntelligence/services/conversationIntelligenceService.js";
import { conversationWorkingMemory } from "../../conversationIntelligence/services/conversationWorkingMemory.js";
import type { ConversationToolMemoryCoordinator } from "../../conversationIntelligence/services/conversationToolMemoryCoordinator.js";
import type { LexicalKnowledgeRetrievalService } from "../../knowledgeV2/services/knowledgeRetrievalService.js";

export class OperationalConversationTurnValidationError extends Error {}
export class OperationalConversationTurnNotFoundError extends Error {}
export class OperationalConversationTurnProfileNotExecutableError extends Error {}
export class OperationalConversationTurnKnowledgeUnavailableError extends Error {}
export class OperationalConversationTurnInProgressError extends Error {}

export interface OperationalConversationTurnResult {
  readonly inbound: ConversationMessage;
  readonly outbound: ConversationMessage;
  readonly response: AssistantExecutionResult;
  readonly executionRecordId: string;
}

export interface OperationalConversationTurnHooks {
  readonly afterInbound?: (inbound: ConversationMessage) => void | Promise<void>;
  readonly beforeRuntime?: (inbound: ConversationMessage) => boolean | Promise<boolean>;
}

export class OperationalConversationTurnSuppressedError extends Error {
  public constructor(readonly inbound: ConversationMessage) { super("Conversation turn was suppressed."); }
}

export class InMemoryConversationTurnLock {
  private readonly active = new Set<string>();

  public acquire(context: WorkspaceContext, conversationIdValue: string): (() => void) | null {
    const key = `${context.workspaceId}:${conversationIdValue}`;
    if (this.active.has(key)) return null;
    this.active.add(key);
    return () => this.active.delete(key);
  }
}

export class OperationalConversationTurnService {
  private readonly profilePolicy = new AssistantProfileExecutionPolicy();

  public constructor(
    private readonly companies: CompanyRepositoryPort,
    private readonly knowledge: { loadCurrentVersion(context: WorkspaceContext, companyId: number): CompanyKnowledgeVersion | null },
    private readonly profiles: AssistantProfileRepositoryPort,
    private readonly conversations: ConversationService,
    private readonly runtime: OperationalAssistantRuntime,
    private readonly locks: InMemoryConversationTurnLock,
    private readonly provider: string,
    private readonly historyLimit: number,
    private readonly intelligence?: ConversationIntelligenceService,
    private readonly toolMemory?: ConversationToolMemoryCoordinator,
    private readonly retrieval?: LexicalKnowledgeRetrievalService,
  ) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new Error("Conversation history limit is invalid.");
  }

  public async execute(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, input: unknown, hooks?: OperationalConversationTurnHooks): Promise<OperationalConversationTurnResult> {
    const scopedCompanyId = parseCompanyId(companyIdValue), conversationIdValueParsed = parseConversationId(conversationIdValue), parsed = turnInput(input);
    const company = this.companies.findById(context, scopedCompanyId);
    if (!company) throw new OperationalConversationTurnNotFoundError("Company was not found.");
    const conversation = this.conversations.validateOpen(context, scopedCompanyId, conversationIdValueParsed);
    const release = this.locks.acquire(context, conversation.id);
    if (!release) throw new OperationalConversationTurnInProgressError("Conversation turn is already in progress.");
    try {
      // Persist the input before any provider work so retries have an auditable conversation state.
      const inbound = this.conversations.addMessage(context, scopedCompanyId, conversation.id, {
        senderParticipantId: parsed.inboundParticipantId, direction: "inbound", content: parsed.content,
      });
      await hooks?.afterInbound?.(inbound);
       const profile = this.profiles.findById(context, scopedCompanyId, parsed.profileId);
      if (!profile) throw new OperationalConversationTurnNotFoundError("Assistant Profile was not found.");
      try { this.profilePolicy.assert(profile); }
      catch (error: unknown) {
        if (error instanceof AssistantProfilePolicyError) throw new OperationalConversationTurnProfileNotExecutableError("Assistant Profile is not executable.");
        throw error;
      }
      if (company.status !== "ready") throw new OperationalConversationTurnNotFoundError("Company is not ready.");
      const knowledge = this.knowledge.loadCurrentVersion(context, scopedCompanyId);
      if (!knowledge) throw new OperationalConversationTurnKnowledgeUnavailableError("Published knowledge is unavailable.");
      const history = historyFor(this.conversations.listMessages(context, scopedCompanyId, conversation.id), this.historyLimit);
      if (await hooks?.beforeRuntime?.(inbound) === false) throw new OperationalConversationTurnSuppressedError(inbound);
        const intelligenceResult = this.intelligence ? await this.intelligence.apply(context, scopedCompanyId, inbound) : null;
        const memory = intelligenceResult?.state ? conversationWorkingMemory(intelligenceResult.state) : "";
       const executed = await this.runtime.execute(company, profile, knowledge, inbound.content, history, {
          purpose: "operational_execution", provider: this.provider, fallbackOnUnavailable: true,
          snapshotContext: { conversationId: conversation.id, channelProvider: conversation.channel }, conversationMemory: memory,
          ...(this.retrieval ? { retrieval: this.retrieval.context(context, scopedCompanyId, knowledge.sourceRevisionIds, inbound.content) } : {}),
      });
       await this.appendToolMemory(context, scopedCompanyId, conversation.id, executed.toolMemoryCandidates);
       const outbound = this.conversations.addMessage(context, scopedCompanyId, conversation.id, {
         senderParticipantId: parsed.outboundParticipantId, direction: "outbound", content: executed.response.answer,
         executionRecordId: executed.record.id,
       });
        if (this.intelligence) await this.intelligence.apply(context, scopedCompanyId, outbound);
        return Object.freeze({ inbound, outbound, response: executed.response, executionRecordId: executed.record.id });
    } finally { release(); }
  }

  public async executePersistedInbound(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, input: { readonly assistantProfileId: string; readonly outboundParticipantId: string; readonly replyIdempotencyKey: string; readonly whatsAppConnectionId?: string; readonly whatsAppPhoneNumberId?: string }, inbound: ConversationMessage, hooks?: Omit<OperationalConversationTurnHooks, "afterInbound">): Promise<OperationalConversationTurnResult> {
    const scopedCompanyId = parseCompanyId(companyIdValue), conversationIdValueParsed = parseConversationId(conversationIdValue);
    const company = this.companies.findById(context, scopedCompanyId);
    if (!company) throw new OperationalConversationTurnNotFoundError("Company was not found.");
    const conversation = this.conversations.validateOpen(context, scopedCompanyId, conversationIdValueParsed);
    if (inbound.conversationId !== conversation.id || inbound.direction !== "inbound") throw new OperationalConversationTurnValidationError("Persisted inbound message is invalid.");
    const profileId = assistantProfileId(input.assistantProfileId), outboundParticipantId = conversationParticipantId(input.outboundParticipantId);
    const release = this.locks.acquire(context, conversation.id);
    if (!release) throw new OperationalConversationTurnInProgressError("Conversation turn is already in progress.");
    try {
      const existing = this.conversations.findMessageByIdempotencyKey(context, scopedCompanyId, conversation.id, input.replyIdempotencyKey);
      if (existing) {
        if (existing.direction !== "outbound" || !existing.executionRecordId) throw new OperationalConversationTurnValidationError("Persisted outbound message is invalid.");
        return Object.freeze({ inbound, outbound: existing, response: { outcome: "answered" as const, answer: existing.content }, executionRecordId: existing.executionRecordId });
      }
      const profile = this.profiles.findById(context, scopedCompanyId, profileId);
      if (!profile) throw new OperationalConversationTurnNotFoundError("Assistant Profile was not found.");
      try { this.profilePolicy.assert(profile); } catch (error: unknown) { if (error instanceof AssistantProfilePolicyError) throw new OperationalConversationTurnProfileNotExecutableError("Assistant Profile is not executable."); throw error; }
      if (company.status !== "ready") throw new OperationalConversationTurnNotFoundError("Company is not ready.");
      const knowledge = this.knowledge.loadCurrentVersion(context, scopedCompanyId);
      if (!knowledge) throw new OperationalConversationTurnKnowledgeUnavailableError("Published knowledge is unavailable.");
      if (await hooks?.beforeRuntime?.(inbound) === false) throw new OperationalConversationTurnSuppressedError(inbound);
        const intelligenceResult = this.intelligence ? await this.intelligence.apply(context, scopedCompanyId, inbound) : null;
        const memory = intelligenceResult?.state ? conversationWorkingMemory(intelligenceResult.state) : "";
       const executed = await this.runtime.execute(company, profile, knowledge, inbound.content, historyFor(this.conversations.listMessages(context, scopedCompanyId, conversation.id), this.historyLimit), {
        purpose: "operational_execution", provider: this.provider, fallbackOnUnavailable: true,
        snapshotContext: {
          conversationId: conversation.id,
          channelProvider: conversation.channel,
          ...(input.whatsAppConnectionId ? { whatsAppConnectionId: input.whatsAppConnectionId } : {}),
          ...(input.whatsAppPhoneNumberId ? { whatsAppPhoneNumberId: input.whatsAppPhoneNumberId } : {}),
          }, conversationMemory: memory, ...(this.retrieval ? { retrieval: this.retrieval.context(context, scopedCompanyId, knowledge.sourceRevisionIds, inbound.content) } : {}),
      });
        await this.appendToolMemory(context, scopedCompanyId, conversation.id, executed.toolMemoryCandidates);
        const outbound = this.conversations.addMessage(context, scopedCompanyId, conversation.id, { senderParticipantId: outboundParticipantId, direction: "outbound", content: executed.response.answer, idempotencyKey: input.replyIdempotencyKey, executionRecordId: executed.record.id });
        if (this.intelligence) await this.intelligence.apply(context, scopedCompanyId, outbound);
        return Object.freeze({ inbound, outbound, response: executed.response, executionRecordId: executed.record.id });
    } finally { release(); }
  }

  private async appendToolMemory(context: WorkspaceContext, companyId: number, conversationIdValue: ConversationMessage["conversationId"], candidates: readonly { readonly traceId: string; readonly value: unknown; readonly facts: readonly { readonly key: string; readonly value: unknown }[]; readonly referenceGroups: readonly { readonly groupKind: string; readonly options: readonly { readonly referenceId: string; readonly label: string; readonly safePayload: unknown }[] }[] }[]): Promise<void> {
    try { await this.toolMemory?.append(context, companyId, conversationIdValue, candidates); }
    catch { /* Derived tool memory must never block an otherwise completed conversation turn. */ }
  }
}

function parseCompanyId(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new OperationalConversationTurnValidationError("Company ID is invalid.");
  return parsed;
}

function parseConversationId(value: unknown): ReturnType<typeof conversationId> {
  if (typeof value !== "string") throw new OperationalConversationTurnValidationError("Conversation ID is invalid.");
  try { return conversationId(value); }
  catch { throw new OperationalConversationTurnValidationError("Conversation ID is invalid."); }
}

function turnInput(value: unknown): { profileId: ReturnType<typeof assistantProfileId>; inboundParticipantId: ReturnType<typeof conversationParticipantId>; outboundParticipantId: ReturnType<typeof conversationParticipantId>; content: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperationalConversationTurnValidationError("Turn input is invalid.");
  const record = value as Record<string, unknown>, allowed = new Set(["assistantProfileId", "inboundParticipantId", "outboundParticipantId", "content"]);
  if (Object.keys(record).length !== allowed.size || Object.keys(record).some((key) => !allowed.has(key)) || typeof record.assistantProfileId !== "string" || typeof record.inboundParticipantId !== "string" || typeof record.outboundParticipantId !== "string" || typeof record.content !== "string") throw new OperationalConversationTurnValidationError("Turn input is invalid.");
  try {
    const content = record.content.normalize("NFKC").trim();
    if (!content || Array.from(content).length > 10_000) throw new Error();
    return { profileId: assistantProfileId(record.assistantProfileId), inboundParticipantId: conversationParticipantId(record.inboundParticipantId), outboundParticipantId: conversationParticipantId(record.outboundParticipantId), content };
  } catch { throw new OperationalConversationTurnValidationError("Turn input is invalid."); }
}

function historyFor(messages: readonly ConversationMessage[], limit: number): readonly AssistantConversationHistoryEntry[] {
  return Object.freeze(messages.slice(-limit).map(({ direction, content, createdAt }) => Object.freeze({ direction, content, createdAt })));
}
