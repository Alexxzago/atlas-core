import type { AtlasAgent } from "../agents/atlas.js";
import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export type ChatResult =
  | { kind: "answered"; answer: string }
  | { kind: "company_not_found"; answer: string }
  | { kind: "company_not_ready"; answer: string }
  | { kind: "knowledge_not_found"; answer: string };

const SAFE_RESPONSE = "I don't have that information yet. I can connect you with a human agent.";

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
    return { kind: "answered", answer: await this.agent.answer(message, companyKnowledge) };
  }
}
