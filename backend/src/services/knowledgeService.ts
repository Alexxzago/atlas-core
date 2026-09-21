import type { KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export class KnowledgeService {
  public constructor(private readonly knowledge: KnowledgeRepositoryPort) {}
  public async get(context: WorkspaceContext, companyId: number): Promise<CompanyKnowledge | null> {
    return this.knowledge.load(context, companyId);
  }
}
