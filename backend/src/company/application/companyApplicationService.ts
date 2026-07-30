import { randomUUID } from "node:crypto";
import {
  CompanyDomainError,
  applyReadinessAssessment,
  archiveCompany,
  companyId,
  companySlug,
  createCompany,
  evaluateCompanyReadiness,
  restoreCompany,
  suspendCompany,
  updateCompanyBranding,
  updateCompanyConfiguration,
  updateCompanyIdentity,
  type BrandingInput,
  type Company,
  type CompanyConfigurationInput,
  type CompanyIdentityInput,
  type CompanyReadinessPolicy,
  type ReadinessAssessment,
} from "../domain/company.js";
import type { CompanyDomainRepositoryPort, CompanyEvent, CompanyEventType } from "./ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface CompanyApplicationDependencies {
  readonly clock?: { now(): string };
  readonly eventIds?: { next(): string };
}

interface CompanyCommand {
  readonly actorId?: string | null;
}

interface CompanyVersionedCommand extends CompanyCommand {
  readonly companyId: number;
  readonly expectedVersion: number;
}

export interface CreateCompanyCommand extends CompanyCommand {
  readonly id: number;
  readonly identity: CompanyIdentityInput;
  readonly branding?: BrandingInput;
}

export interface UpdateCompanyIdentityCommand extends CompanyVersionedCommand {
  readonly identity: CompanyIdentityInput;
}

export interface UpdateCompanyBrandingCommand extends CompanyVersionedCommand {
  readonly branding: BrandingInput;
}

export interface UpdateCompanyConfigurationCommand extends CompanyVersionedCommand {
  readonly configuration: CompanyConfigurationInput;
}

export interface EvaluateCompanyReadinessCommand {
  readonly companyId: number;
}

export interface ApplyReadinessAssessmentCommand extends CompanyVersionedCommand {
  readonly assessment: ReadinessAssessment;
}

export interface SuspendCompanyCommand extends CompanyVersionedCommand {}
export interface RestoreCompanyCommand extends CompanyVersionedCommand {}
export interface ArchiveCompanyCommand extends CompanyVersionedCommand {}

export interface GetCompanyByIdQuery { readonly companyId: number; }
export interface GetCompanyBySlugQuery { readonly slug: string; }
export interface ListCompaniesQuery {}

export type CompanyApplicationFailure =
  | { readonly status: "validation_failed"; readonly message: string }
  | { readonly status: "not_found" }
  | { readonly status: "slug_conflict" }
  | { readonly status: "name_conflict" }
  | { readonly status: "version_conflict" }
  | { readonly status: "persistence_failure" };

export type CompanyCommandResult = { readonly status: "success"; readonly company: Company } | CompanyApplicationFailure;
export type CompanyReadinessEvaluationResult = { readonly status: "success"; readonly assessment: ReadinessAssessment } | CompanyApplicationFailure;
export type CompanyReadinessApplicationResult = { readonly status: "success"; readonly company: Company; readonly assessment: ReadinessAssessment; readonly persisted: boolean } | CompanyApplicationFailure;
export type CompanyQueryResult = { readonly status: "found"; readonly company: Company } | { readonly status: "not_found" } | { readonly status: "validation_failed"; readonly message: string } | { readonly status: "persistence_failure" };
export type CompanyListResult = { readonly status: "success"; readonly companies: readonly Company[] } | { readonly status: "persistence_failure" };

const unavailableReadinessPolicy: CompanyReadinessPolicy = {
  definition: Object.freeze({ id: "company-core-unavailable-evidence", version: "1", productCapabilities: Object.freeze([]), dependencyCategories: Object.freeze(["authoritative-dependency-evidence"]) }),
  assess(company, _evidence, evaluatedAt) {
    return {
      companyId: company.id,
      aggregateVersion: company.version,
      policy: this.definition,
      outcome: "indeterminate",
      action: "none",
      reasonCodes: ["required_dependency_evidence_unavailable"],
      evidence: [],
      evaluatedAt,
    };
  },
};

export class CompanyApplicationService {
  private readonly clock: { now(): string };
  private readonly eventIds: { next(): string };

  public constructor(
    private readonly companies: CompanyDomainRepositoryPort,
    dependencies: CompanyApplicationDependencies = {},
    private readonly readinessPolicy: CompanyReadinessPolicy = unavailableReadinessPolicy,
  ) {
    this.clock = dependencies.clock ?? { now: () => new Date().toISOString() };
    this.eventIds = dependencies.eventIds ?? { next: () => randomUUID() };
  }

  public createCompany(context: WorkspaceContext, command: CreateCompanyCommand): CompanyCommandResult {
    try {
      const company = createCompany({ id: command.id, workspaceId: context.workspaceId, identity: command.identity, ...(command.branding === undefined ? {} : { branding: command.branding }), createdAt: this.clock.now() });
      const persisted = this.companies.createWithEvents(context, company, this.events(company, command.actorId, [{ type: "CompanyCreated", payload: { companyId: company.id } }]));
      if (persisted.status === "created") return { status: "success", company: persisted.company };
      return persisted;
    } catch (error: unknown) {
      return this.failure(error);
    }
  }

  public updateCompanyIdentity(context: WorkspaceContext, command: UpdateCompanyIdentityCommand): CompanyCommandResult {
    return this.update(context, command, (company) => updateCompanyIdentity(company, command.identity, this.clock.now()), (company) => [{ type: "CompanyIdentityUpdated", payload: { companyId: company.id } }]);
  }

  public updateCompanyBranding(context: WorkspaceContext, command: UpdateCompanyBrandingCommand): CompanyCommandResult {
    return this.update(context, command, (company) => updateCompanyBranding(company, command.branding, this.clock.now()), (company) => [{ type: "CompanyBrandingUpdated", payload: { companyId: company.id } }]);
  }

  public updateCompanyConfiguration(context: WorkspaceContext, command: UpdateCompanyConfigurationCommand): CompanyCommandResult {
    return this.update(context, command, (company) => updateCompanyConfiguration(company, command.configuration, this.clock.now()), (company, previous) => [
      { type: "CompanyConfigurationUpdated", payload: { companyId: company.id } },
      ...(previous.lifecycle === "draft" && company.lifecycle === "configured" ? [{ type: "CompanyConfigured" as const, payload: { companyId: company.id } }] : []),
    ]);
  }

  public evaluateCompanyReadiness(context: WorkspaceContext, command: EvaluateCompanyReadinessCommand): CompanyReadinessEvaluationResult {
    try {
      const company = this.companies.findById(context, companyId(command.companyId));
      if (!company) return { status: "not_found" };
      return { status: "success", assessment: evaluateCompanyReadiness(company, this.readinessPolicy, [], this.clock.now()) };
    } catch (error: unknown) {
      if (error instanceof CompanyDomainError) return { status: "validation_failed", message: error.message };
      return { status: "persistence_failure" };
    }
  }

  public applyReadinessAssessment(context: WorkspaceContext, command: ApplyReadinessAssessmentCommand): CompanyReadinessApplicationResult {
    try {
      const company = this.companies.findById(context, companyId(command.companyId));
      if (!company) return { status: "not_found" };
      if (company.version !== command.expectedVersion) return { status: "version_conflict" };
      const updated = applyReadinessAssessment(company, command.assessment, this.clock.now());
      if (updated === company) return { status: "success", company, assessment: command.assessment, persisted: false };
      const type: CompanyEventType = updated.lifecycle === "operational" ? "CompanyActivated" : "CompanyAttentionRequired";
      const persisted = this.companies.saveWithEvents(context, updated, command.expectedVersion, this.events(updated, command.actorId, [{ type, payload: { companyId: updated.id, policyId: command.assessment.policy.id, policyVersion: command.assessment.policy.version, reasonCodes: command.assessment.reasonCodes } }]));
      if (persisted.status === "saved") return { status: "success", company: persisted.company, assessment: command.assessment, persisted: true };
      return persisted;
    } catch (error: unknown) {
      return this.failure(error);
    }
  }

  public suspendCompany(context: WorkspaceContext, command: SuspendCompanyCommand): CompanyCommandResult {
    return this.update(context, command, (company) => suspendCompany(company, this.clock.now()), (company) => [{ type: "CompanySuspended", payload: { companyId: company.id } }]);
  }

  public restoreCompany(context: WorkspaceContext, command: RestoreCompanyCommand): CompanyCommandResult {
    return this.update(context, command, (company) => restoreCompany(company, this.clock.now()), (company) => [{ type: "CompanyRestored", payload: { companyId: company.id } }]);
  }

  public archiveCompany(context: WorkspaceContext, command: ArchiveCompanyCommand): CompanyCommandResult {
    return this.update(context, command, (company) => archiveCompany(company, this.clock.now()), (company) => [{ type: "CompanyArchived", payload: { companyId: company.id } }]);
  }

  public getCompanyById(context: WorkspaceContext, query: GetCompanyByIdQuery): CompanyQueryResult {
    try {
      const company = this.companies.findById(context, companyId(query.companyId));
      return company ? { status: "found", company } : { status: "not_found" };
    } catch (error: unknown) {
      return this.queryFailure(error);
    }
  }

  public getCompanyBySlug(context: WorkspaceContext, query: GetCompanyBySlugQuery): CompanyQueryResult {
    try {
      const company = this.companies.findBySlug(context, companySlug(query.slug));
      return company ? { status: "found", company } : { status: "not_found" };
    } catch (error: unknown) {
      return this.queryFailure(error);
    }
  }

  public listCompanies(context: WorkspaceContext, _query: ListCompaniesQuery = {}): CompanyListResult {
    try {
      return { status: "success", companies: this.companies.listByWorkspace(context) };
    } catch {
      return { status: "persistence_failure" };
    }
  }

  private update(
    context: WorkspaceContext,
    command: CompanyVersionedCommand,
    operation: (company: Company) => Company,
    eventDefinitions: (company: Company, previous: Company) => readonly { readonly type: CompanyEventType; readonly payload: Readonly<Record<string, unknown>> }[],
  ): CompanyCommandResult {
    try {
      const company = this.companies.findById(context, companyId(command.companyId));
      if (!company) return { status: "not_found" };
      if (company.version !== command.expectedVersion) return { status: "version_conflict" };
      const updated = operation(company);
      const persisted = this.companies.saveWithEvents(context, updated, command.expectedVersion, this.events(updated, command.actorId, eventDefinitions(updated, company)));
      if (persisted.status === "saved") return { status: "success", company: persisted.company };
      return persisted;
    } catch (error: unknown) {
      return this.failure(error);
    }
  }

  private events(company: Company, actorId: string | null | undefined, definitions: readonly { readonly type: CompanyEventType; readonly payload: Readonly<Record<string, unknown>> }[]): readonly CompanyEvent[] {
    return definitions.map((definition, index) => ({ id: this.eventIds.next(), type: definition.type, aggregateVersion: company.version, sequence: index + 1, occurredAt: company.updatedAt, actorId: actorId ?? null, payload: definition.payload }));
  }

  private failure(error: unknown): CompanyApplicationFailure {
    if (error instanceof CompanyDomainError) return { status: "validation_failed", message: error.message };
    return { status: "persistence_failure" };
  }

  private queryFailure(error: unknown): Extract<CompanyQueryResult, { readonly status: "validation_failed" | "persistence_failure" }> {
    if (error instanceof CompanyDomainError) return { status: "validation_failed", message: error.message };
    return { status: "persistence_failure" };
  }
}
