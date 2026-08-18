import { createHash, randomUUID } from "node:crypto";
import type { Clock } from "../../identity/application/ports.js";
import type { Company } from "../../types/company.js";
import type { CompanyKnowledgeVersion } from "../../knowledge/domain/knowledge.js";
import { AnswerGenerationUnavailableError, assistantModelPrompt, buildAssistantExecution, type AssistantConversationHistoryEntry, type AssistantExecutionResult } from "../application/assistantExecution.js";
import type { AssistantExecutionPort } from "../application/assistantExecutionPort.js";
import type { AssistantExecutionRecordRepositoryPort } from "../application/operationalAssistantRuntime.js";
import { assistantExecutionRecordId, createProfileRuntimeSnapshot, createPublishedKnowledgeSnapshotReference, type AssistantExecutionRecord, type AssistantRuntimePurpose, type ImmutableExecutionSnapshot } from "../domain/operationalAssistantRuntime.js";
import type { AssistantProfile } from "../domain/assistantProfile.js";
import type { AssistantToolOrchestrator } from "./assistantToolOrchestrator.js";
import { ToolExecutionError } from "./toolExecutionService.js";

export interface OperationalAssistantRuntimeContext {
  readonly purpose: AssistantRuntimePurpose;
  readonly provider: string;
  readonly fallbackOnUnavailable: boolean;
  readonly conversationMemory?: string;
  readonly snapshotContext?: {
    readonly whatsAppConnectionId?: string;
    readonly whatsAppPhoneNumberId?: string;
    readonly conversationId?: string;
    readonly channelProvider?: string;
  };
}

export interface OperationalAssistantRuntimeResult {
  readonly response: AssistantExecutionResult;
  readonly record: AssistantExecutionRecord;
  readonly toolMemoryCandidates: readonly { readonly traceId: string; readonly value: unknown; readonly facts: readonly { readonly key: string; readonly value: unknown }[]; readonly referenceGroups: readonly { readonly groupKind: string; readonly options: readonly { readonly referenceId: string; readonly label: string; readonly safePayload: unknown }[] }[] }[];
}

export class OperationalAssistantRuntime {
  public constructor(
    private readonly execution: AssistantExecutionPort,
    private readonly records: AssistantExecutionRecordRepositoryPort,
    private readonly clock: Clock,
    private readonly tools?: AssistantToolOrchestrator,
  ) {}

  public async execute(
    company: Company,
    profile: AssistantProfile,
    knowledge: CompanyKnowledgeVersion,
    message: string,
    history: readonly AssistantConversationHistoryEntry[],
    context: OperationalAssistantRuntimeContext,
  ): Promise<OperationalAssistantRuntimeResult> {
    const provider = providerName(context.provider);
    if (profile.companyId !== company.id || knowledge.companyId !== company.id) throw new Error("Assistant runtime ownership does not match Company.");
    const startedAt = this.clock.now();
    const started = this.record(company, profile, knowledge, context, startedAt);
    this.records.create(started);
    try {
      const request = buildAssistantExecution(profile, {
        purpose: context.purpose,
        knowledge: knowledge.knowledge,
        message,
        history,
        conversationMemory: context.conversationMemory ?? "",
      });
      const toolOutcome = this.tools
        ? await this.tools.runOutcome(assistantModelPrompt(request), {
          workspaceId: company.workspaceId, companyId: company.id, assistantProfileId: profile.id,
          assistantExecutionRecordId: started.id, conversationId: context.snapshotContext?.conversationId ?? null,
          channel: context.snapshotContext?.channelProvider === "whatsapp" ? "whatsapp" : context.snapshotContext?.channelProvider === "web_chat" ? "web_chat" : "internal",
          invocationId: "", idempotencyKey: null, confirmation: null,
        }) : null;
      const result = toolOutcome ? Object.freeze({ outcome: "answered" as const, answer: toolOutcome.answer }) : await this.execution.execute(request);
      const response = validResponse(result)
        ? context.fallbackOnUnavailable && result.outcome === "safe_fallback" ? fallback(profile.fallbackMessage) : result
        : fallback(profile.fallbackMessage);
      const completed = this.complete(started, response, null, this.clock.now());
      this.persistCompletion(completed);
      return { response, record: completed, toolMemoryCandidates: Object.freeze(toolOutcome?.conversationMemory ?? []) };
    } catch (error: unknown) {
      if (context.fallbackOnUnavailable && (error instanceof AnswerGenerationUnavailableError || error instanceof ToolExecutionError)) {
        const response = fallback(profile.fallbackMessage);
        const completed = this.complete(started, response, null, this.clock.now());
        this.persistCompletion(completed);
        return { response, record: completed, toolMemoryCandidates: Object.freeze([]) };
      }
      const completed = this.complete(started, null, "provider_unavailable", this.clock.now());
      this.persistCompletion(completed);
      throw error;
    }
  }

  private record(company: Company, profile: AssistantProfile, knowledge: CompanyKnowledgeVersion, context: OperationalAssistantRuntimeContext, startedAt: string): AssistantExecutionRecord {
    return Object.freeze({
      id: assistantExecutionRecordId(`aex_${randomUUID().replaceAll("-", "")}`),
      companyId: company.id,
      profileId: profile.id,
      profileSnapshot: createProfileRuntimeSnapshot(profile),
      knowledgeSnapshot: createPublishedKnowledgeSnapshotReference(knowledge),
      executionSnapshot: snapshot(company,profile,knowledge,context,startedAt),
      provider: providerName(context.provider),
      purpose: context.purpose,
      state: "started",
      fallbackUsed: false,
      result: null,
      inputTokens: null,
      outputTokens: null,
      errorCode: null,
      startedAt,
      completedAt: null,
      durationMilliseconds: null,
    });
  }

  private complete(started: AssistantExecutionRecord, response: AssistantExecutionResult | null, errorCode: string | null, completedAt: string): AssistantExecutionRecord {
    const durationMilliseconds = Math.max(0, Date.parse(completedAt) - Date.parse(started.startedAt));
    if (response) {
      return Object.freeze({ ...started, state: response.outcome === "answered" ? "answered" : "safe_fallback", fallbackUsed: response.outcome === "safe_fallback", result: response.answer, completedAt, durationMilliseconds });
    }
    return Object.freeze({ ...started, state: "failed", errorCode, completedAt, durationMilliseconds });
  }

  private persistCompletion(record: AssistantExecutionRecord): void {
    if (!this.records.complete(record, "started")) throw new Error("Assistant execution record state changed.");
  }
}
function snapshot(company: Company, profile: AssistantProfile, knowledge: CompanyKnowledgeVersion, context: OperationalAssistantRuntimeContext, createdAt: string): ImmutableExecutionSnapshot {
  const value = {
    version: "execution-snapshot-v1" as const,
    workspaceId: company.workspaceId,
    companyId: company.id,
    assistantIdentifier: "default" as const,
    assistantProfileId: profile.id,
    assistantProfileStatus: profile.status,
    knowledgeVersionId: knowledge.id,
    whatsAppConnectionId: context.snapshotContext?.whatsAppConnectionId ?? null,
    whatsAppPhoneNumberId: context.snapshotContext?.whatsAppPhoneNumberId ?? null,
    conversationId: context.snapshotContext?.conversationId ?? null,
    channelProvider: context.snapshotContext?.channelProvider ?? null,
    executionPolicyVersion: "assistant-profile-execution-v1" as const,
    safetyPolicyVersion: "assistant-safety-v1" as const,
    providerModel: providerName(context.provider),
    runtimeVersion: "operational-runtime-v1" as const,
    configurationDigest: "",
    createdAt,
  };
  return Object.freeze({
    ...value,
    configurationDigest: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  });
}

function providerName(value: string): string {
  const provider = value.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(provider)) throw new Error("Assistant execution provider is invalid.");
  return provider;
}

function validResponse(value: AssistantExecutionResult): boolean {
  return !!value && typeof value === "object" && (value.outcome === "answered" || value.outcome === "safe_fallback")
    && typeof value.answer === "string" && value.answer.trim().length > 0;
}

function fallback(answer: string): AssistantExecutionResult { return { outcome: "safe_fallback", answer }; }
