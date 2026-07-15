import type { Company, CompanyCreateInput, CompanyPersistenceInput, CompanyStatus } from "../../types/company.js";
import type { CompanyKnowledge } from "../../types/companyKnowledge.js";
import type { Workspace } from "../../types/workspace.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface CompanyRepositoryPort {
  findById(context: WorkspaceContext, companyId: number): Company | null;
  findByWebsite(context: WorkspaceContext, website: string): Company | null;
  list(context: WorkspaceContext): Company[];
  create(context: WorkspaceContext, input: CompanyCreateInput): Company;
  update(context: WorkspaceContext, companyId: number, input: CompanyPersistenceInput): Company | null;
  delete(context: WorkspaceContext, companyId: number): boolean;
  updateStatus(context: WorkspaceContext, companyId: number, status: CompanyStatus): Company | null;
}

export interface KnowledgeRepositoryPort {
  save(context: WorkspaceContext, companyId: number, knowledge: CompanyKnowledge): boolean;
  load(context: WorkspaceContext, companyId: number): CompanyKnowledge | null;
  delete(context: WorkspaceContext, companyId: number): boolean;
}

export interface WorkspaceRepositoryPort {
  findById(workspaceId: number): Workspace | null;
  findByKey(workspaceKey: string): Workspace | null;
  resolveDefault(): Workspace;
  createForSystemUse(input: { key: string; name: string }): Workspace;
}
