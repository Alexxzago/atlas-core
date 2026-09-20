import { randomInt, randomUUID } from "node:crypto";
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
import type { AsyncCompanyDomainRepositoryPort, CompanyDomainRepositoryPort, CompanyEvent, CompanyEventType } from "./ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { type BillingEntitlementPort } from "../../billing/services/billingEntitlementService.js";

export interface CompanyApplicationDependencies {
  readonly clock?: { now(): string };
  readonly eventIds?: { next(): string };
  readonly entitlements?: BillingEntitlementPort;
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

export interface CreateOnboardingCompanyCommand extends CompanyCommand {
  readonly name: string;
  readonly website?: string | null;
  readonly logoAssetReference?: string | null;
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
  | { readonly status: "commercial_limit_reached" }
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
  private readonly entitlements: BillingEntitlementPort | undefined;

  public constructor(
    private readonly companies: CompanyDomainRepositoryPort | AsyncCompanyDomainRepositoryPort,
    dependencies: CompanyApplicationDependencies = {},
    private readonly readinessPolicy: CompanyReadinessPolicy = unavailableReadinessPolicy,
  ) {
    this.clock = dependencies.clock ?? { now: () => new Date().toISOString() };
    this.eventIds = dependencies.eventIds ?? { next: () => randomUUID() };
    this.entitlements = dependencies.entitlements;
  }

  public async createCompany(context: WorkspaceContext, command: CreateCompanyCommand): Promise<CompanyCommandResult> {
    try {
      if (!await this.mayCreateCompany(context)) return { status: "commercial_limit_reached" };
      const company = createCompany({ id: command.id, workspaceId: context.workspaceId, identity: command.identity, ...(command.branding === undefined ? {} : { branding: command.branding }), createdAt: this.clock.now() });
       const persisted = await this.companies.createWithEvents(context, company, this.events(company, command.actorId, [{ type: "CompanyCreated", payload: { companyId: company.id } }]));
      if (persisted.status === "created") return { status: "success", company: persisted.company };
      return persisted;
    } catch (error: unknown) {
      return this.failure(error);
    }
  }

  public async createOnboardingCompany(context: WorkspaceContext, command: CreateOnboardingCompanyCommand): Promise<CompanyCommandResult> {
    try {
      if (!await this.mayCreateCompany(context)) return { status: "commercial_limit_reached" };
      const baseSlug = this.onboardingSlug(command.name);
      for (let suffix = 1; suffix <= 100; suffix += 1) {
        const slug = suffix === 1 ? baseSlug : `${baseSlug.slice(0, 80 - String(suffix).length - 1)}-${suffix}`;
        if (await this.companies.existsBySlug(context, companySlug(slug))) continue;
        const company = createCompany({
          id: randomInt(1, 2_147_483_647), workspaceId: context.workspaceId,
          identity: { name: command.name, slug, ...(command.website === undefined ? {} : { website: command.website }) },
          ...(command.logoAssetReference === undefined ? {} : { branding: { logoAssetReference: command.logoAssetReference } }),
          createdAt: this.clock.now(),
        });
        const persisted = await this.companies.createWithEvents(context, company, this.events(company, command.actorId, [{ type: "CompanyCreated", payload: { companyId: company.id } }]));
        if (persisted.status === "created") return { status: "success", company: persisted.company };
        if (persisted.status !== "slug_conflict") return persisted;
      }
      return { status: "slug_conflict" };
    } catch (error: unknown) {
      return this.failure(error);
    }
  }

  public async updateCompanyIdentity(context: WorkspaceContext, command: UpdateCompanyIdentityCommand): Promise<CompanyCommandResult> {
    return await this.update(context, command, (company) => updateCompanyIdentity(company, command.identity, this.clock.now()), (company) => [{ type: "CompanyIdentityUpdated", payload: { companyId: company.id } }]);
  }

  public async updateCompanyBranding(context: WorkspaceContext, command: UpdateCompanyBrandingCommand): Promise<CompanyCommandResult> {
    return await this.update(context, command, (company) => updateCompanyBranding(company, command.branding, this.clock.now()), (company) => [{ type: "CompanyBrandingUpdated", payload: { companyId: company.id } }]);
  }

  public async updateCompanyConfiguration(context: WorkspaceContext, command: UpdateCompanyConfigurationCommand): Promise<CompanyCommandResult> {
    return await this.update(context, command, (company) => updateCompanyConfiguration(company, command.configuration, this.clock.now()), (company, previous) => [
      { type: "CompanyConfigurationUpdated", payload: { companyId: company.id } },
      ...(previous.lifecycle === "draft" && company.lifecycle === "configured" ? [{ type: "CompanyConfigured" as const, payload: { companyId: company.id } }] : []),
    ]);
  }

  public async evaluateCompanyReadiness(context: WorkspaceContext, command: EvaluateCompanyReadinessCommand): Promise<CompanyReadinessEvaluationResult> {
    try {
      const company = await this.companies.findById(context, companyId(command.companyId));
      if (!company) return { status: "not_found" };
      return { status: "success", assessment: evaluateCompanyReadiness(company, this.readinessPolicy, [], this.clock.now()) };
    } catch (error: unknown) {
      if (error instanceof CompanyDomainError) return { status: "validation_failed", message: error.message };
      return { status: "persistence_failure" };
    }
  }

  public async applyReadinessAssessment(context: WorkspaceContext, command: ApplyReadinessAssessmentCommand): Promise<CompanyReadinessApplicationResult> {
    try {
      const company = await this.companies.findById(context, companyId(command.companyId));
      if (!company) return { status: "not_found" };
      if (company.version !== command.expectedVersion) return { status: "version_conflict" };
      const updated = applyReadinessAssessment(company, command.assessment, this.clock.now());
      if (updated === company) return { status: "success", company, assessment: command.assessment, persisted: false };
      const type: CompanyEventType = updated.lifecycle === "operational" ? "CompanyActivated" : "CompanyAttentionRequired";
      const persisted = await this.companies.saveWithEvents(context, updated, command.expectedVersion, this.events(updated, command.actorId, [{ type, payload: { companyId: updated.id, policyId: command.assessment.policy.id, policyVersion: command.assessment.policy.version, reasonCodes: command.assessment.reasonCodes } }]));
      if (persisted.status === "saved") return { status: "success", company: persisted.company, assessment: command.assessment, persisted: true };
      return persisted;
    } catch (error: unknown) {
      return this.failure(error);
    }
  }

  public async suspendCompany(context: WorkspaceContext, command: SuspendCompanyCommand): Promise<CompanyCommandResult> {
    return await this.update(context, command, (company) => suspendCompany(company, this.clock.now()), (company) => [{ type: "CompanySuspended", payload: { companyId: company.id } }]);
  }

  public async restoreCompany(context: WorkspaceContext, command: RestoreCompanyCommand): Promise<CompanyCommandResult> {
    return await this.update(context, command, (company) => restoreCompany(company, this.clock.now()), (company) => [{ type: "CompanyRestored", payload: { companyId: company.id } }]);
  }

  public async archiveCompany(context: WorkspaceContext, command: ArchiveCompanyCommand): Promise<CompanyCommandResult> {
    return await this.update(context, command, (company) => archiveCompany(company, this.clock.now()), (company) => [{ type: "CompanyArchived", payload: { companyId: company.id } }]);
  }

  public async getCompanyById(context: WorkspaceContext, query: GetCompanyByIdQuery): Promise<CompanyQueryResult> {
    try {
      const company = await this.companies.findById(context, companyId(query.companyId));
      return company ? { status: "found", company } : { status: "not_found" };
    } catch (error: unknown) {
      return this.queryFailure(error);
    }
  }

  public async getCompanyBySlug(context: WorkspaceContext, query: GetCompanyBySlugQuery): Promise<CompanyQueryResult> {
    try {
      const company = await this.companies.findBySlug(context, companySlug(query.slug));
      return company ? { status: "found", company } : { status: "not_found" };
    } catch (error: unknown) {
      return this.queryFailure(error);
    }
  }

  public async listCompanies(context: WorkspaceContext, _query: ListCompaniesQuery = {}): Promise<CompanyListResult> {
    try {
      return { status: "success", companies: await this.companies.listByWorkspace(context) };
    } catch {
      return { status: "persistence_failure" };
    }
  }

  private async update(
    context: WorkspaceContext,
    command: CompanyVersionedCommand,
    operation: (company: Company) => Company,
    eventDefinitions: (company: Company, previous: Company) => readonly { readonly type: CompanyEventType; readonly payload: Readonly<Record<string, unknown>> }[],
  ): Promise<CompanyCommandResult> {
    try {
      const company = await this.companies.findById(context, companyId(command.companyId));
      if (!company) return { status: "not_found" };
      if (company.version !== command.expectedVersion) return { status: "version_conflict" };
      const updated = operation(company);
      const persisted = await this.companies.saveWithEvents(context, updated, command.expectedVersion, this.events(updated, command.actorId, eventDefinitions(updated, company)));
      if (persisted.status === "saved") return { status: "success", company: persisted.company };
      return persisted;
    } catch (error: unknown) {
      return this.failure(error);
    }
  }

  private async mayCreateCompany(context: WorkspaceContext): Promise<boolean> {
    return this.entitlements ? (await this.entitlements.mayCreateCompany(context.workspaceId)).allowed : true;
  }

  private events(company: Company, actorId: string | null | undefined, definitions: readonly { readonly type: CompanyEventType; readonly payload: Readonly<Record<string, unknown>> }[]): readonly CompanyEvent[] {
    return definitions.map((definition, index) => ({ id: this.eventIds.next(), type: definition.type, aggregateVersion: company.version, sequence: index + 1, occurredAt: company.updatedAt, actorId: actorId ?? null, payload: definition.payload }));
  }

  private onboardingSlug(name: string): string {
    const value = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
    return companySlug(value);
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
