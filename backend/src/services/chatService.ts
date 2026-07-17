import type { AtlasAgent } from "../agents/atlas.js";
import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { AnswerGenerationUnavailableError } from "../assistant/application/assistantExecution.js";

export type ChatResult =
  | { kind: "answered"; answer: string }
  | { kind: "company_not_found"; answer: string }
  | { kind: "company_not_ready"; answer: string }
  | { kind: "knowledge_not_found"; answer: string };

const SAFE_RESPONSE = "I don't have that information yet. I can connect you with a human agent.";
const TEMPORARY_RESPONSE = "I'm temporarily unable to check that information. I can connect you with a human agent.";

export class ChatService {
  public constructor(
    private readonly companies: CompanyRepositoryPort,
    private readonly knowledge: KnowledgeRepositoryPort,
    private readonly agent: AtlasAgent
  ) {}

  public async chat(context: WorkspaceContext, companyId: number, message: string): Promise<ChatResult> {
    const company = this.companies.findById(context, companyId);
    if (!company) {
      return { kind: "company_not_found", answer: SAFE_RESPONSE };
    }
    if (company.status !== "ready") {
      return { kind: "company_not_ready", answer: SAFE_RESPONSE };
    }
    const companyKnowledge = this.knowledge.load(context, companyId);
    if (!companyKnowledge) {
      return { kind: "knowledge_not_found", answer: SAFE_RESPONSE };
    }
    try {
      return { kind: "answered", answer: await this.agent.answer(message, companyKnowledge) };
    } catch (error: unknown) {
      if (error instanceof AnswerGenerationUnavailableError) return { kind: "answered", answer: TEMPORARY_RESPONSE };
      throw error;
    }
  }
}
