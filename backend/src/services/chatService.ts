import type { AtlasAgent } from "../agents/atlas.js";
import type { CompanyRepository } from "../repositories/companyRepository.js";
import type { KnowledgeRepository } from "../repositories/knowledgeRepository.js";

export type ChatResult =
  | { kind: "answered"; answer: string }
  | { kind: "company_not_found"; answer: string }
  | { kind: "knowledge_not_found"; answer: string };

const SAFE_RESPONSE = "I don't have that information yet. I can connect you with a human agent.";

export class ChatService {
  public constructor(
    private readonly companies: CompanyRepository,
    private readonly knowledge: KnowledgeRepository,
    private readonly agent: AtlasAgent
  ) {}

  public async chat(companyId: number, message: string): Promise<ChatResult> {
    if (!this.companies.findById(companyId)) {
      return { kind: "company_not_found", answer: SAFE_RESPONSE };
    }
    const companyKnowledge = this.knowledge.load(companyId);
    if (!companyKnowledge) {
      return { kind: "knowledge_not_found", answer: SAFE_RESPONSE };
    }
    return { kind: "answered", answer: await this.agent.answer(message, companyKnowledge) };
  }
}
