import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { CompanyApplicationService } from "../company/application/companyApplicationService.js";
import type { CompanyDomainRepositoryPort } from "../company/application/ports.js";
import { CompanyDomainRepository } from "../repositories/companyDomainRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const configuration = {
  timezone: "Europe/London",
  locale: "en-GB",
  operatingLocale: { countryCode: "GB", currencyCode: "GBP", dateFormat: "DD/MM/YYYY" as const, phoneFormat: "national" as const },
  businessHours: { weekly: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } },
};

function service(repository: CompanyDomainRepositoryPort): CompanyApplicationService {
  let instant = 0;
  let event = 0;
  return new CompanyApplicationService(repository, {
    clock: { now: () => `2026-07-30T10:${String(instant++).padStart(2, "0")}:00.000Z` },
    eventIds: { next: () => `event-${++event}` },
  });
}

function create(serviceUnderTest: CompanyApplicationService, context: ReturnType<typeof createWorkspaceContext>, id = 901) {
  return serviceUnderTest.createCompany(context, { id, actorId: "operator-1", identity: { name: "Atlas Realty", slug: "atlas-realty", website: "https://atlas.example" } });
}

test("Company application commands execute domain operations and persist complete event sets", () => {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace);
  const repository = new CompanyDomainRepository(db), companies = service(repository);
  const created = create(companies, context);
  assert.equal(created.status, "success");
  if (created.status !== "success") throw new Error("Expected Company creation.");
  const branded = companies.updateCompanyBranding(context, { companyId: created.company.id, expectedVersion: 1, actorId: "operator-1", branding: { publicName: "Atlas" } });
  assert.equal(branded.status, "success");
  if (branded.status !== "success") throw new Error("Expected Company branding update.");
  const configured = companies.updateCompanyConfiguration(context, { companyId: branded.company.id, expectedVersion: 2, actorId: "operator-1", configuration });
  assert.equal(configured.status, "success");
  if (configured.status !== "success") throw new Error("Expected Company configuration update.");
  assert.equal(configured.company.lifecycle, "configured");
  const suspended = companies.suspendCompany(context, { companyId: configured.company.id, expectedVersion: 3 });
  assert.equal(suspended.status, "success");
  if (suspended.status !== "success") throw new Error("Expected Company suspension.");
  const restored = companies.restoreCompany(context, { companyId: suspended.company.id, expectedVersion: 4 });
  assert.equal(restored.status, "success");
  if (restored.status !== "success") throw new Error("Expected Company restoration.");
  const archived = companies.archiveCompany(context, { companyId: restored.company.id, expectedVersion: 5 });
  assert.equal(archived.status, "success");
  assert.deepEqual(
    (db.prepare("SELECT event_type FROM company_events WHERE company_id=? ORDER BY aggregate_version,event_sequence").all(created.company.id) as Array<{ event_type: string }>).map((row) => row.event_type),
    ["CompanyCreated", "CompanyBrandingUpdated", "CompanyConfigurationUpdated", "CompanyConfigured", "CompanySuspended", "CompanyRestored", "CompanyArchived"],
  );
  db.close();
});

test("Company application translates domain, repository, and optimistic concurrency failures", () => {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace);
  const repository = new CompanyDomainRepository(db), companies = service(repository);
  const invalid = companies.createCompany(context, { id: 902, identity: { name: "", slug: "atlas", website: "https://atlas.example" } });
  assert.equal(invalid.status, "validation_failed");
  const created = create(companies, context, 903);
  assert.equal(created.status, "success");
  if (created.status !== "success") throw new Error("Expected Company creation.");
  const stale = companies.updateCompanyBranding(context, { companyId: created.company.id, expectedVersion: 0, branding: { publicName: "Atlas" } });
  assert.equal(stale.status, "version_conflict");
  const failingRepository: CompanyDomainRepositoryPort = {
    findById: () => { throw new Error("sqlite unavailable"); },
    findBySlug: () => null,
    listByWorkspace: () => [],
    existsBySlug: () => false,
    existsByNormalizedName: () => false,
    createWithEvents: () => { throw new Error("sqlite unavailable"); },
    saveWithEvents: () => { throw new Error("sqlite unavailable"); },
  };
  assert.equal(service(failingRepository).getCompanyById(context, { companyId: created.company.id }).status, "persistence_failure");
  db.close();
});

test("Company application queries are workspace-scoped and perform no writes", () => {
  const db = createDatabase(":memory:"), workspaces = new WorkspaceRepository(db), first = workspaces.resolveDefault(), second = workspaces.createForSystemUse({ key: "second", name: "Second" });
  const repository = new CompanyDomainRepository(db), companies = service(repository), firstContext = createWorkspaceContext(first), secondContext = createWorkspaceContext(second);
  const created = create(companies, firstContext, 904);
  assert.equal(created.status, "success");
  if (created.status !== "success") throw new Error("Expected Company creation.");
  const eventsBeforeQueries = (db.prepare("SELECT COUNT(*) AS count FROM company_events").get() as { count: number }).count;
  assert.equal(companies.getCompanyById(secondContext, { companyId: created.company.id }).status, "not_found");
  assert.equal(companies.getCompanyBySlug(secondContext, { slug: created.company.slug }).status, "not_found");
  const listed = companies.listCompanies(secondContext);
  assert.equal(listed.status, "success");
  if (listed.status !== "success") throw new Error("Expected Company list.");
  assert.deepEqual(listed.companies, []);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM company_events").get() as { count: number }).count, eventsBeforeQueries);
  db.close();
});

test("Company readiness evaluation is ephemeral and applying an assessment persists its lifecycle event", () => {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace);
  const repository = new CompanyDomainRepository(db), companies = service(repository), created = create(companies, context, 905);
  assert.equal(created.status, "success");
  if (created.status !== "success") throw new Error("Expected Company creation.");
  const configured = companies.updateCompanyConfiguration(context, { companyId: created.company.id, expectedVersion: 1, configuration });
  assert.equal(configured.status, "success");
  if (configured.status !== "success") throw new Error("Expected Company configuration update.");
  const eventsBeforeEvaluation = (db.prepare("SELECT COUNT(*) AS count FROM company_events").get() as { count: number }).count;
  const evaluated = companies.evaluateCompanyReadiness(context, { companyId: configured.company.id });
  assert.equal(evaluated.status, "success");
  if (evaluated.status !== "success") throw new Error("Expected readiness evaluation.");
  assert.equal(evaluated.assessment.outcome, "indeterminate");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM company_events").get() as { count: number }).count, eventsBeforeEvaluation);
  const applied = companies.applyReadinessAssessment(context, {
    companyId: configured.company.id,
    expectedVersion: 2,
    assessment: { companyId: configured.company.id, aggregateVersion: 2, policy: { id: "test-policy", version: "1", productCapabilities: [], dependencyCategories: [] }, outcome: "eligible", action: "promote_to_operational", reasonCodes: [], evidence: [], evaluatedAt: "2026-07-30T12:00:00.000Z" },
  });
  assert.equal(applied.status, "success");
  if (applied.status !== "success") throw new Error("Expected readiness application.");
  assert.equal(applied.company.lifecycle, "operational");
  assert.equal(applied.persisted, true);
  assert.equal((db.prepare("SELECT event_type FROM company_events WHERE company_id=? ORDER BY aggregate_version DESC,event_sequence DESC LIMIT 1").get(created.company.id) as { event_type: string }).event_type, "CompanyActivated");
  db.close();
});
