import type { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";

export class KnowledgeService {
  public constructor(private readonly knowledge: KnowledgeRepository) {}
  public get(companyId: number): CompanyKnowledge | null { return this.knowledge.load(companyId); }
}
