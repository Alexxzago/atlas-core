import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../../application/ports/repositories.js";
import type { CompanyKnowledgeVersion } from "../../knowledge/domain/knowledge.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AssistantExecutionResult } from "../application/assistantExecution.js";
import type { OperationalExecutionBudgetPort } from "../application/operationalExecutionBudget.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import { assistantProfileId } from "../domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../domain/assistantProfilePolicies.js";
import type { OperationalAssistantRuntime } from "./operationalAssistantRuntime.js";

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
    private readonly knowledge: KnowledgeRepositoryPort & { loadCurrentVersion(context: WorkspaceContext, companyId: number): CompanyKnowledgeVersion | null },
    private readonly profiles: AssistantProfileRepositoryPort,
    private readonly runtime: OperationalAssistantRuntime,
    private readonly budget: OperationalExecutionBudgetPort,
    private readonly provider: string,
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
    const knowledge = this.knowledge.loadCurrentVersion(context, scopedCompanyId);
    if (!knowledge) throw new OperationalAssistantKnowledgeUnavailableError();
    const lease = this.budget.acquire(context);
    if (!lease) throw new OperationalAssistantExecutionRateLimitedError();
    try {
      return (await this.runtime.execute(company, profile, knowledge, parsed.message, {
        purpose: "operational_execution", provider: this.provider, fallbackOnUnavailable: true,
      })).response;
    } finally { lease.release(); }
  }
}

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
