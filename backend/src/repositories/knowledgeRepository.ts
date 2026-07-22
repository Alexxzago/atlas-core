import type { DatabaseSync } from "node:sqlite";
import type { KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import { database } from "../config/database.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { CompanyKnowledgeRepository } from "./companyKnowledgeRepository.js";

/** Compatibility adapter for released Chat/Preview/tests. Runtime reads use only the frozen publication projection. */
export class KnowledgeRepository implements KnowledgeRepositoryPort {
  private readonly frozen: CompanyKnowledgeRepository;
  public constructor(private readonly db: DatabaseSync) { this.frozen = new CompanyKnowledgeRepository(db); }
  public load(context:WorkspaceContext,companyId:number):CompanyKnowledge|null{return this.frozen.loadPublished(context,companyId);}
}
export const knowledgeRepository=new KnowledgeRepository(database);
