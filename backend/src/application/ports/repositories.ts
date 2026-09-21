import type { Company, CompanyCreateInput, CompanyPersistenceInput, CompanyStatus } from "../../types/company.js";
import type { CompanyKnowledge } from "../../types/companyKnowledge.js";
import type { Workspace } from "../../types/workspace.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { NormalizedEmail } from "../../identity/domain/email.js";
import type { User, UserId } from "../../identity/domain/user.js";

export interface UserRepositoryPort {
  findById(id: UserId): User | null;
  findByNormalizedEmail(email: NormalizedEmail): User | null;
  create(user: User): User;
  update(user: User): User | null;
}

export interface CompanyRepositoryPort {
  findById(context: WorkspaceContext, companyId: number): Company | null;
  findByWebsite(context: WorkspaceContext, website: string): Company | null;
  list(context: WorkspaceContext): Company[];
  create(context: WorkspaceContext, input: CompanyCreateInput): Company;
  update(context: WorkspaceContext, companyId: number, input: CompanyPersistenceInput): Company | null;
  delete(context: WorkspaceContext, companyId: number): boolean;
  updateStatus(context: WorkspaceContext, companyId: number, status: CompanyStatus): Company | null;
}

/** Async compatibility seam while legacy Company callers migrate incrementally. */
export interface AsyncCompanyRepositoryPort {
  findById(context: WorkspaceContext, companyId: number): Promise<Company | null>;
  findByWebsite(context: WorkspaceContext, website: string): Promise<Company | null>;
  list(context: WorkspaceContext): Promise<Company[]>;
  create(context: WorkspaceContext, input: CompanyCreateInput): Promise<Company>;
  update(context: WorkspaceContext, companyId: number, input: CompanyPersistenceInput): Promise<Company | null>;
  delete(context: WorkspaceContext, companyId: number): Promise<boolean>;
  updateStatus(context: WorkspaceContext, companyId: number, status: CompanyStatus): Promise<Company | null>;
}

export type CompanyPersistencePort = CompanyRepositoryPort | AsyncCompanyRepositoryPort;

export interface KnowledgeRepositoryPort {
  load(context: WorkspaceContext, companyId: number): Promise<CompanyKnowledge | null>;
}

export interface WorkspaceRepositoryPort {
  findById(workspaceId: number): Workspace | null;
  findByKey(workspaceKey: string): Workspace | null;
  findByPublicId(publicId: string): Workspace | null;
  resolveDefault(): Workspace;
  createForSystemUse(input: { key: string; name: string }): Workspace;
}
