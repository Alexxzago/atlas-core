import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../../application/ports/repositories.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { AnswerGenerationUnavailableError, buildAssistantExecution, type AssistantExecutionResult } from "../application/assistantExecution.js";
import type { AssistantExecutionPort } from "../application/assistantExecutionPort.js";
import type { OperationalExecutionBudgetPort } from "../application/operationalExecutionBudget.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import { assistantProfileId } from "../domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../domain/assistantProfilePolicies.js";

export class OperationalAssistantExecutionValidationError extends Error {}
export class OperationalAssistantExecutionNotFoundError extends Error {}
export class OperationalAssistantProfileNotExecutableError extends Error {}
export class OperationalAssistantCompanyNotReadyError extends Error {}
export class OperationalAssistantKnowledgeUnavailableError extends Error {}
export class OperationalAssistantExecutionRateLimitedError extends Error {}

export class OperationalAssistantExecutionService {
  private readonly executionPolicy = new AssistantProfileExecutionPolicy();

  public constructor(
    private readonly companies: CompanyRepositoryPort,
    private readonly knowledge: KnowledgeRepositoryPort,
    private readonly profiles: AssistantProfileRepositoryPort,
    private readonly execution: AssistantExecutionPort,
    private readonly budget: OperationalExecutionBudgetPort,
  ) {}

  public async execute(context: WorkspaceContext, companyIdValue: unknown, input: unknown): Promise<AssistantExecutionResult> {
    const scopedCompanyId = parseCompanyId(companyIdValue);
    const parsed = parseInput(input);
    const company = this.companies.findById(context, scopedCompanyId);
    if (!company) throw new OperationalAssistantExecutionNotFoundError();
    const profile = this.profiles.findById(context, scopedCompanyId, parsed.profileId);
    if (!profile) throw new OperationalAssistantExecutionNotFoundError();
    try { this.executionPolicy.assert(profile); }
    catch (error: unknown) {
      if (error instanceof AssistantProfilePolicyError) throw new OperationalAssistantProfileNotExecutableError();
      throw error;
    }
    if (company.status !== "ready") throw new OperationalAssistantCompanyNotReadyError();
    const knowledge = this.knowledge.load(context, scopedCompanyId);
    if (!knowledge) throw new OperationalAssistantKnowledgeUnavailableError();
    const lease = this.budget.acquire(context);
    if (!lease) throw new OperationalAssistantExecutionRateLimitedError();
    try {
      const result = await this.execution.execute(buildAssistantExecution(profile, {
        purpose: "operational_execution",
        knowledge,
        message: parsed.message,
      }));
      if (!result || typeof result !== "object" || result.outcome === "safe_fallback" || typeof result.answer !== "string" || !result.answer.trim()) return fallback(profile.fallbackMessage);
      if (result.outcome !== "answered") return fallback(profile.fallbackMessage);
      return { outcome: "answered", answer: result.answer };
    } catch (error: unknown) {
      if (error instanceof AnswerGenerationUnavailableError) return fallback(profile.fallbackMessage);
      throw error;
    } finally { lease.release(); }
  }
}

function fallback(answer: string): AssistantExecutionResult { return { outcome: "safe_fallback", answer }; }
function parseCompanyId(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new OperationalAssistantExecutionNotFoundError(); return parsed; }
function parseInput(value: unknown): { profileId: ReturnType<typeof assistantProfileId>; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperationalAssistantExecutionValidationError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.assistantProfileId !== "string" || typeof record.message !== "string") throw new OperationalAssistantExecutionValidationError();
  let profileId: ReturnType<typeof assistantProfileId>;
  try { profileId = assistantProfileId(record.assistantProfileId); } catch { throw new OperationalAssistantExecutionValidationError(); }
  const message = record.message.trim();
  if (Array.from(message).length < 1 || Array.from(message).length > 2_000) throw new OperationalAssistantExecutionValidationError();
  return { profileId, message };
}
