import type { Company, CompanyId, CompanySlug } from "../domain/company.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type CompanyEventType = "CompanyCreated" | "CompanyIdentityUpdated" | "CompanyBrandingUpdated" | "CompanyConfigurationUpdated" | "CompanyConfigured" | "CompanyActivated" | "CompanyAttentionRequired" | "CompanySuspended" | "CompanyRestored" | "CompanyArchived" | "CompanyUpdated";

export interface CompanyEvent {
  readonly id: string;
  readonly type: CompanyEventType;
  readonly aggregateVersion: number;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly actorId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type CreateCompanyPersistenceResult =
  | { readonly status: "created"; readonly company: Company }
  | { readonly status: "slug_conflict" }
  | { readonly status: "name_conflict" }
  | { readonly status: "commercial_limit_reached" };

export type SaveCompanyPersistenceResult =
  | { readonly status: "saved"; readonly company: Company }
  | { readonly status: "not_found" }
  | { readonly status: "version_conflict" }
  | { readonly status: "slug_conflict" }
  | { readonly status: "name_conflict" };

export interface CompanyDomainRepositoryPort {
  findById(context: WorkspaceContext, companyId: CompanyId): Company | null;
  findBySlug(context: WorkspaceContext, slug: CompanySlug): Company | null;
  listByWorkspace(context: WorkspaceContext): readonly Company[];
  existsBySlug(context: WorkspaceContext, slug: CompanySlug, excludingCompanyId?: CompanyId): boolean;
  existsByNormalizedName(context: WorkspaceContext, normalizedName: string, excludingCompanyId?: CompanyId): boolean;
  createWithEvents(context: WorkspaceContext, company: Company, events: readonly CompanyEvent[]): CreateCompanyPersistenceResult;
  saveWithEvents(context: WorkspaceContext, company: Company, expectedVersion: number, events: readonly CompanyEvent[]): SaveCompanyPersistenceResult;
}
