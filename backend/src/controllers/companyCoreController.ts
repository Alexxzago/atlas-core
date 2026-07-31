import type { RequestHandler, Response } from "express";
import { randomInt } from "node:crypto";
import type { CompanyApplicationService, CompanyApplicationFailure } from "../company/application/companyApplicationService.js";
import type { Company, ReadinessAssessment } from "../company/domain/company.js";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import {
  CompanyHttpValidationError,
  parseCompanyId,
  parseCreateCompanyRequest,
  parseCreateOnboardingCompanyRequest,
  parseListCompaniesQuery,
  parseSlug,
  parseUpdateBrandingRequest,
  parseUpdateConfigurationRequest,
  parseUpdateIdentityRequest,
  parseVersionedRequest,
  type CompanyResponseDto,
  type ReadinessAssessmentDto,
} from "../company/http/companyDtos.js";

export interface CompanyCoreControllers {
  readonly list: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly create: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly createOnboarding: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly get: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly getBySlug: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly updateIdentity: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly updateBranding: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly updateConfiguration: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly evaluateReadiness: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly applyReadiness: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly suspend: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly restore: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  readonly archive: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
}

export function createCompanyCoreControllers(service: CompanyApplicationService): CompanyCoreControllers {
  return {
    list: (context) => (req, res) => {
      try {
        parseListCompaniesQuery(req.query);
        const result = service.listCompanies(context);
        if (result.status === "success") res.status(200).json({ data: result.companies.map(toCompanyResponse) }); else respondApplication(res, result);
      } catch (error: unknown) { respondError(res, error); }
    },
    create: (context, actor) => (req, res) => {
      try {
        const request = parseCreateCompanyRequest(req.body);
        const result = service.createCompany(context, { ...request, id: randomInt(1, 2_147_483_647), actorId: actor.userId });
        if (result.status === "success") res.status(201).json({ data: toCompanyResponse(result.company) }); else respondApplication(res, result);
      } catch (error: unknown) { respondError(res, error); }
    },
    createOnboarding: (context, actor) => (req, res) => {
      try {
        const request = parseCreateOnboardingCompanyRequest(req.body);
        const result = service.createOnboardingCompany(context, { ...request, actorId: actor.userId });
        if (result.status === "success") res.status(201).json({ data: toCompanyResponse(result.company) }); else respondApplication(res, result);
      } catch (error: unknown) { respondError(res, error); }
    },
    get: (context) => (req, res) => {
      try {
        const result = service.getCompanyById(context, { companyId: parseCompanyId(req.params.companyId) });
        if (result.status === "found") res.status(200).json({ data: toCompanyResponse(result.company) }); else respondApplication(res, result);
      } catch (error: unknown) { respondError(res, error); }
    },
    getBySlug: (context) => (req, res) => {
      try {
        const result = service.getCompanyBySlug(context, { slug: parseSlug(req.params.slug) });
        if (result.status === "found") res.status(200).json({ data: toCompanyResponse(result.company) }); else respondApplication(res, result);
      } catch (error: unknown) { respondError(res, error); }
    },
    updateIdentity: (context, actor) => mutation(context, actor, (req) => { const request = parseUpdateIdentityRequest(req.body); return service.updateCompanyIdentity(context, { ...request, companyId: parseCompanyId(req.params.companyId), actorId: actor.userId }); }),
    updateBranding: (context, actor) => mutation(context, actor, (req) => { const request = parseUpdateBrandingRequest(req.body); return service.updateCompanyBranding(context, { ...request, companyId: parseCompanyId(req.params.companyId), actorId: actor.userId }); }),
    updateConfiguration: (context, actor) => mutation(context, actor, (req) => { const request = parseUpdateConfigurationRequest(req.body); return service.updateCompanyConfiguration(context, { ...request, companyId: parseCompanyId(req.params.companyId), actorId: actor.userId }); }),
    evaluateReadiness: (context) => (req, res) => {
      try {
        const result = service.evaluateCompanyReadiness(context, { companyId: parseCompanyId(req.params.companyId) });
        if (result.status === "success") res.status(200).json({ data: readinessResponse(result.assessment) }); else respondApplication(res, result);
      } catch (error: unknown) { respondError(res, error); }
    },
    applyReadiness: (context, actor) => (req, res) => {
      try {
        const request = parseVersionedRequest(req.body), companyId = parseCompanyId(req.params.companyId);
        const assessment = service.evaluateCompanyReadiness(context, { companyId });
        if (assessment.status !== "success") { respondApplication(res, assessment); return; }
        if (assessment.assessment.action === "none") {
          const company = service.getCompanyById(context, { companyId });
          if (company.status === "found") { res.status(200).json({ data: { company: toCompanyResponse(company.company), assessment: readinessResponse(assessment.assessment), persisted: false } }); return; }
          respondApplication(res, company);
          return;
        }
        const result = service.applyReadinessAssessment(context, { ...request, companyId, assessment: assessment.assessment, actorId: actor.userId });
        if (result.status === "success") res.status(200).json({ data: { company: toCompanyResponse(result.company), assessment: readinessResponse(result.assessment), persisted: result.persisted } }); else respondApplication(res, result);
      } catch (error: unknown) { respondError(res, error); }
    },
    suspend: (context, actor) => lifecycle(context, actor, (companyId, expectedVersion) => service.suspendCompany(context, { companyId, expectedVersion, actorId: actor.userId })),
    restore: (context, actor) => lifecycle(context, actor, (companyId, expectedVersion) => service.restoreCompany(context, { companyId, expectedVersion, actorId: actor.userId })),
    archive: (context, actor) => lifecycle(context, actor, (companyId, expectedVersion) => service.archiveCompany(context, { companyId, expectedVersion, actorId: actor.userId })),
  };
}

function mutation(context: WorkspaceContext, actor: ActorContext, operation: (req: Parameters<RequestHandler>[0]) => ReturnType<CompanyApplicationService["updateCompanyIdentity"]>): RequestHandler {
  return (req, res): void => { try { const result = operation(req); if (result.status === "success") res.status(200).json({ data: toCompanyResponse(result.company) }); else respondApplication(res, result); } catch (error: unknown) { respondError(res, error); } };
}

function lifecycle(context: WorkspaceContext, actor: ActorContext, operation: (companyId: number, expectedVersion: number) => ReturnType<CompanyApplicationService["suspendCompany"]>): RequestHandler {
  return (req, res): void => { try { const request = parseVersionedRequest(req.body), result = operation(parseCompanyId(req.params.companyId), request.expectedVersion); if (result.status === "success") res.status(200).json({ data: toCompanyResponse(result.company) }); else respondApplication(res, result); } catch (error: unknown) { respondError(res, error); } };
}

function toCompanyResponse(company: Company): CompanyResponseDto {
  return {
    id: company.id, name: company.name, slug: company.slug, description: company.description, website: company.website,
    branding: { publicName: company.branding.publicName, logoAssetReference: company.branding.logoAssetReference, colorTokens: { ...company.branding.colorTokens } },
    configuration: company.configuration === null ? null : { timezone: company.configuration.timezone, locale: company.configuration.locale, operatingLocale: { countryCode: company.configuration.operatingLocale.countryCode, currencyCode: company.configuration.operatingLocale.currencyCode, dateFormat: company.configuration.operatingLocale.dateFormat, phoneFormat: company.configuration.operatingLocale.phoneFormat }, businessHours: { weekly: Object.fromEntries(Object.entries(company.configuration.businessHours.weekly).map(([day, intervals]) => [day, intervals.map((interval) => ({ opensAt: interval.opensAt, closesAt: interval.closesAt }))])), exceptions: Object.fromEntries(Object.entries(company.configuration.businessHours.exceptions).map(([date, intervals]) => [date, intervals.map((interval) => ({ opensAt: interval.opensAt, closesAt: interval.closesAt }))])) } },
    lifecycle: company.lifecycle, version: company.version, createdAt: company.createdAt, updatedAt: company.updatedAt, lifecycleChangedAt: company.lifecycleChangedAt, suspendedAt: company.suspendedAt, archivedAt: company.archivedAt,
  };
}

function readinessResponse(assessment: ReadinessAssessment): ReadinessAssessmentDto {
  return { companyId: assessment.companyId, aggregateVersion: assessment.aggregateVersion, policy: assessment.policy, outcome: assessment.outcome, action: assessment.action, reasonCodes: assessment.reasonCodes, evidence: assessment.evidence, evaluatedAt: assessment.evaluatedAt };
}

function respondApplication(res: Response, result: Exclude<CompanyApplicationFailure, { readonly status: "validation_failed" }> | { readonly status: "validation_failed"; readonly message: string } | { readonly status: "persistence_failure" }): void {
  if (result.status === "validation_failed") { res.status(400).json({ error: { code: result.status, message: result.message } }); return; }
  if (result.status === "not_found") { res.status(404).json({ error: { code: result.status, message: "Company was not found." } }); return; }
  if (result.status === "slug_conflict" || result.status === "name_conflict" || result.status === "version_conflict") { res.status(409).json({ error: { code: result.status, message: "Company update conflicts with current state." } }); return; }
  res.status(500).json({ error: { code: "company_unavailable", message: "Company service is temporarily unavailable." } });
}

function respondError(res: Response, error: unknown): void {
  if (error instanceof CompanyHttpValidationError) { res.status(400).json({ error: { code: "validation_failed", message: error.message } }); return; }
  res.status(500).json({ error: { code: "company_unavailable", message: "Company service is temporarily unavailable." } });
}
