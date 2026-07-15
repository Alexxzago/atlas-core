import type { KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export class KnowledgeService {
  public constructor(private readonly knowledge: KnowledgeRepositoryPort) {}
  public get(context: WorkspaceContext, companyId: number): CompanyKnowledge | null {
    return this.knowledge.load(context, companyId);
  }
}
