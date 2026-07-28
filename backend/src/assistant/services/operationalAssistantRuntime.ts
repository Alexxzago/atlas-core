import { randomUUID } from "node:crypto";
import type { Clock } from "../../identity/application/ports.js";
import type { Company } from "../../types/company.js";
import type { CompanyKnowledgeVersion } from "../../knowledge/domain/knowledge.js";
import { AnswerGenerationUnavailableError, buildAssistantExecution, type AssistantConversationHistoryEntry, type AssistantExecutionResult } from "../application/assistantExecution.js";
import type { AssistantExecutionPort } from "../application/assistantExecutionPort.js";
import type { AssistantExecutionRecordRepositoryPort } from "../application/operationalAssistantRuntime.js";
import { assistantExecutionRecordId, createProfileRuntimeSnapshot, createPublishedKnowledgeSnapshotReference, type AssistantExecutionRecord, type AssistantRuntimePurpose } from "../domain/operationalAssistantRuntime.js";
import type { AssistantProfile } from "../domain/assistantProfile.js";

export interface OperationalAssistantRuntimeContext {
  readonly purpose: AssistantRuntimePurpose;
  readonly provider: string;
  readonly fallbackOnUnavailable: boolean;
}

export interface OperationalAssistantRuntimeResult {
  readonly response: AssistantExecutionResult;
  readonly record: AssistantExecutionRecord;
}

export class OperationalAssistantRuntime {
  public constructor(
    private readonly execution: AssistantExecutionPort,
    private readonly records: AssistantExecutionRecordRepositoryPort,
    private readonly clock: Clock,
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
      const result = await this.execution.execute(buildAssistantExecution(profile, {
        purpose: context.purpose,
        knowledge: knowledge.knowledge,
        message,
        history,
      }));
      const response = validResponse(result)
        ? context.fallbackOnUnavailable && result.outcome === "safe_fallback" ? fallback(profile.fallbackMessage) : result
        : fallback(profile.fallbackMessage);
      const completed = this.complete(started, response, null, this.clock.now());
      this.persistCompletion(completed);
      return { response, record: completed };
    } catch (error: unknown) {
      if (context.fallbackOnUnavailable && error instanceof AnswerGenerationUnavailableError) {
        const response = fallback(profile.fallbackMessage);
        const completed = this.complete(started, response, null, this.clock.now());
        this.persistCompletion(completed);
        return { response, record: completed };
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
