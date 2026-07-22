import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../../application/ports/repositories.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { assistantProfileId } from "../domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../domain/assistantProfilePolicies.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import { buildAssistantExecution, type AssistantExecutionResult } from "../application/assistantExecution.js";
import type { AssistantExecutionPort } from "../application/assistantExecutionPort.js";

export class AssistantPreviewValidationError extends Error {}
export class AssistantPreviewNotFoundError extends Error {}
export class AssistantProfileNotExecutableError extends Error {}
export class AssistantPreviewCompanyNotReadyError extends Error {}
export class AssistantPreviewKnowledgeUnavailableError extends Error {}

export class AssistantPreviewService {
  private readonly executionPolicy = new AssistantProfileExecutionPolicy();

  public constructor(
    private readonly companies: CompanyRepositoryPort,
    private readonly knowledge: KnowledgeRepositoryPort,
    private readonly profiles: AssistantProfileRepositoryPort,
    private readonly execution: AssistantExecutionPort,
  ) {}

  public async preview(
    context: WorkspaceContext,
    companyIdValue: unknown,
    profileIdValue: unknown,
    input: unknown,
  ): Promise<AssistantExecutionResult> {
    const companyId = parseCompanyId(companyIdValue);
    const profileId = parseProfileId(profileIdValue);
    const message = parseInput(input);
    const company = this.companies.findById(context, companyId);
    if (!company) throw new AssistantPreviewNotFoundError();
    const profile = this.profiles.findById(context, companyId, profileId);
    if (!profile) throw new AssistantPreviewNotFoundError();
    try { this.executionPolicy.assert(profile); }
    catch (error: unknown) {
      if (error instanceof AssistantProfilePolicyError) throw new AssistantProfileNotExecutableError();
      throw error;
    }
    if (company.status !== "ready") throw new AssistantPreviewCompanyNotReadyError();
    const companyKnowledge = this.knowledge.load(context, companyId);
    if (!companyKnowledge) throw new AssistantPreviewKnowledgeUnavailableError();
    return this.execution.execute(buildAssistantExecution(profile, {
      purpose: "preview",
      knowledge: companyKnowledge,
      message,
    }));
  }
}

function parseCompanyId(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AssistantPreviewNotFoundError();
  return parsed;
}

function parseProfileId(value: unknown): ReturnType<typeof assistantProfileId> {
  if (typeof value !== "string") throw new AssistantPreviewNotFoundError();
  try { return assistantProfileId(value); }
  catch { throw new AssistantPreviewNotFoundError(); }
}

function parseInput(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AssistantPreviewValidationError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.message !== "string") throw new AssistantPreviewValidationError();
  const message = record.message.trim();
  const length = Array.from(message).length;
  if (length < 1 || length > 2_000) throw new AssistantPreviewValidationError();
  return message;
}
