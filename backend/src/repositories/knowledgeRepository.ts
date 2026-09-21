import type { SqlDatabase } from "../config/sqlDatabase.js";
import type { KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { AsyncCompanyKnowledgeRepository } from "../knowledge/infrastructure/asyncKnowledgePersistence.js";

/** Legacy application read port backed by the asynchronous knowledge persistence. */
export class KnowledgeRepository implements KnowledgeRepositoryPort {
  private readonly frozen: AsyncCompanyKnowledgeRepository;
  public constructor(database: SqlDatabase) { this.frozen = new AsyncCompanyKnowledgeRepository(database); }
  public async load(context: WorkspaceContext, companyId: number): Promise<CompanyKnowledge | null> { return this.frozen.loadPublished(context, companyId); }
  public async loadCurrentVersion(context: WorkspaceContext, companyId: number) { return this.frozen.loadCurrentVersion(context, companyId); }
}
