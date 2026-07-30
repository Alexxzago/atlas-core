import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReadinessAssessment,
  archiveCompany,
  companyId,
  companyLocale,
  companyName,
  companySlug,
  companyTimezone,
  createBranding,
  createBusinessHours,
  createCompany,
  createCompanyConfiguration,
  createOperatingLocale,
  createReadinessAssessment,
  evaluateCompanyReadiness,
  reconstructCompany,
  restoreArchivedCompany,
  restoreCompany,
  suspendCompany,
  updateCompanyBranding,
  updateCompanyConfiguration,
  updateCompanyIdentity,
  websiteUrl,
  type BusinessHoursInput,
  type Company,
  type CompanyReadinessPolicy,
  type ReadinessAssessment,
} from "../company/domain/company.js";

const createdAt = "2026-07-30T10:00:00.000Z";
const changedAt = "2026-07-30T11:00:00.000Z";
const weekly: BusinessHoursInput["weekly"] = {
  monday: [{ opensAt: "09:00", closesAt: "17:00" }], tuesday: [{ opensAt: "09:00", closesAt: "17:00" }], wednesday: [{ opensAt: "09:00", closesAt: "17:00" }], thursday: [{ opensAt: "09:00", closesAt: "17:00" }], friday: [{ opensAt: "09:00", closesAt: "17:00" }], saturday: [], sunday: [],
};
const configuration = { timezone: "America/Argentina/Buenos_Aires", locale: "es-AR", operatingLocale: { countryCode: "ar", currencyCode: "ars", dateFormat: "DD/MM/YYYY" as const, phoneFormat: "international" as const }, businessHours: { weekly, exceptions: { "2026-12-25": [] } } };

function draftCompany() { return createCompany({ id: 7, workspaceId: 2, identity: { name: "  Atlas Realty  ", slug: "atlas-realty", description: "  Property advisors ", website: "https://atlas.example" }, createdAt }); }
function configuredCompany() { return updateCompanyConfiguration(draftCompany(), configuration, changedAt); }
function assessment(company: Company, outcome: ReadinessAssessment["outcome"], action: ReadinessAssessment["action"], evaluatedAt = changedAt): ReadinessAssessment { return { companyId: company.id, aggregateVersion: company.version, policy: { id: "standard", version: "1", productCapabilities: ["customer_support"], dependencyCategories: ["knowledge", "assistant", "channel"] }, outcome, action, reasonCodes: outcome === "eligible" ? [] : ["missing_dependency"], evidence: [{ source: "knowledge", state: "published", version: "2", asOf: createdAt }], evaluatedAt }; }

test("Company value objects normalize valid values and reject invalid values", () => {
  assert.equal(companyId(1), 1);
  assert.equal(companyName("  Atlas Realty "), "Atlas Realty");
  assert.equal(companySlug("  Atlas-Realty "), "atlas-realty");
  assert.equal(websiteUrl("https://atlas.example/path"), "https://atlas.example/path");
  assert.equal(companyTimezone("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos_Aires");
  assert.equal(companyLocale("es-ar"), "es-AR");
  assert.throws(() => companyId(0));
  assert.throws(() => companyName(" "));
  assert.throws(() => companySlug("Atlas Realty"));
  assert.throws(() => websiteUrl("ftp://atlas.example"));
  assert.throws(() => websiteUrl("https://user:password@atlas.example"));
  assert.throws(() => companyTimezone("Not/A_Timezone"));
  assert.throws(() => companyLocale("not a locale"));
});

test("Branding, operating locale and business hours validate their structural invariants", () => {
  const branding = createBranding({ publicName: " Atlas ", logoAssetReference: "asset_1", colorTokens: { primary: "#123abc", accent: "#FFFFFF" } });
  assert.deepEqual(branding, { publicName: "Atlas", logoAssetReference: "asset_1", colorTokens: { primary: "#123ABC", accent: "#FFFFFF" } });
  assert.deepEqual(createOperatingLocale(configuration.operatingLocale), { countryCode: "AR", currencyCode: "ARS", dateFormat: "DD/MM/YYYY", phoneFormat: "international" });
  assert.deepEqual(createBusinessHours(configuration.businessHours).exceptions["2026-12-25"], []);
  assert.throws(() => createBranding({ colorTokens: { primary: "blue" } }));
  assert.throws(() => createOperatingLocale({ ...configuration.operatingLocale, countryCode: "ARG" }));
  assert.throws(() => createBusinessHours({ weekly: { ...weekly, monday: [{ opensAt: "17:00", closesAt: "09:00" }] } }));
  assert.throws(() => createBusinessHours({ weekly: { ...weekly, monday: [{ opensAt: "09:00", closesAt: "12:00" }, { opensAt: "11:00", closesAt: "14:00" }] } }));
  assert.throws(() => createBusinessHours({ weekly, exceptions: { invalid: [] } }));
  assert.throws(() => createBusinessHours({ weekly, exceptions: { "2026-02-30": [] } }));
});

test("Company creation is immutable and always draft until configuration completion", () => {
  const draft = draftCompany(), configured = configuredCompany();
  assert.equal(draft.lifecycle, "draft");
  assert.equal(draft.configuration, null);
  assert.equal(draft.normalizedName, "atlas realty");
  assert.equal(configured.lifecycle, "configured");
  assert.equal(configured.configuration?.locale, "es-AR");
  assert.equal(configured.version, 2);
  assert.ok(Object.isFrozen(draft));
  assert.throws(() => createCompanyConfiguration({ ...configuration, timezone: "invalid" }));
});

test("Identity, branding and configuration updates preserve ownership and advance the aggregate version", () => {
  const draft = draftCompany();
  const identity = updateCompanyIdentity(draft, { name: "Atlas Group", slug: "atlas-group", website: "https://group.example", description: null }, changedAt);
  const branded = updateCompanyBranding(identity, { publicName: "Atlas Group", colorTokens: { secondary: "#112233" } }, "2026-07-30T12:00:00.000Z");
  const configured = updateCompanyConfiguration(branded, configuration, "2026-07-30T13:00:00.000Z");
  assert.equal(configured.workspaceId, 2);
  assert.equal(configured.lifecycle, "configured");
  assert.equal(configured.version, 4);
  assert.equal(configured.description, null);
  assert.equal(configured.branding.colorTokens.secondary, "#112233");
  assert.equal(configured.lifecycleChangedAt, "2026-07-30T13:00:00.000Z");
});

test("Company lifecycle enforces suspension, deterministic restore, archive and explicit archived restoration", () => {
  const configured = configuredCompany();
  const suspended = suspendCompany(configured, "2026-07-30T12:00:00.000Z");
  assert.equal(suspended.lifecycle, "suspended");
  assert.equal(suspended.suspendedAt, "2026-07-30T12:00:00.000Z");
  const restored = restoreCompany(suspended, "2026-07-30T13:00:00.000Z");
  assert.equal(restored.lifecycle, "configured");
  assert.equal(restored.suspendedAt, null);
  const archived = archiveCompany(restored, "2026-07-30T14:00:00.000Z");
  assert.equal(archived.lifecycle, "archived");
  assert.throws(() => updateCompanyIdentity(archived, { name: "Other", slug: "other", website: "https://other.example" }, changedAt));
  assert.throws(() => suspendCompany(archived, changedAt));
  const archivedRestored = restoreArchivedCompany(archived, "configured", "2026-07-30T15:00:00.000Z");
  assert.equal(archivedRestored.lifecycle, "configured");
  assert.equal(archivedRestored.archivedAt, null);
  assert.throws(() => restoreCompany(draftCompany(), changedAt));
  assert.throws(() => restoreArchivedCompany(archiveCompany(draftCompany(), changedAt), "configured", changedAt));
});

test("Company lifecycle supports every frozen valid transition and rejects non-monotonic timestamps", () => {
  const draft = draftCompany();
  const draftSuspended = suspendCompany(draft, changedAt);
  assert.throws(() => restoreCompany(draftSuspended, "2026-07-30T12:00:00.000Z"));
  const configured = updateCompanyConfiguration(draft, configuration, changedAt);
  const operational = applyReadinessAssessment(configured, assessment(configured, "eligible", "promote_to_operational"), "2026-07-30T12:00:00.000Z");
  const attention = applyReadinessAssessment(operational, assessment(operational, "ineligible", "mark_attention_required", "2026-07-30T12:00:00.000Z"), "2026-07-30T13:00:00.000Z");
  assert.equal(applyReadinessAssessment(attention, assessment(attention, "eligible", "promote_to_operational", "2026-07-30T13:00:00.000Z"), "2026-07-30T14:00:00.000Z").lifecycle, "operational");
  for (const company of [draft, configured, operational, attention]) {
    assert.equal(suspendCompany(company, "2026-07-31T10:00:00.000Z").lifecycle, "suspended");
    assert.equal(archiveCompany(company, "2026-07-31T10:00:00.000Z").lifecycle, "archived");
  }
  const archived = archiveCompany(configured, "2026-07-30T12:00:00.000Z");
  assert.equal(restoreArchivedCompany(archived, "draft", "2026-07-30T13:00:00.000Z").lifecycle, "draft");
  assert.equal(restoreArchivedCompany(archived, "configured", "2026-07-30T13:00:00.000Z").lifecycle, "configured");
  assert.equal(restoreArchivedCompany(archived, "suspended", "2026-07-30T13:00:00.000Z").lifecycle, "suspended");
  assert.throws(() => updateCompanyBranding(configured, {}, changedAt));
});

test("Readiness policy contracts are validated and only authoritative assessments transition lifecycle", () => {
  const configured = configuredCompany();
  const policy: CompanyReadinessPolicy = { definition: assessment(configured, "eligible", "promote_to_operational").policy, assess: (company, _evidence, evaluatedAt) => ({ ...assessment(company, "eligible", "promote_to_operational", evaluatedAt) }) };
  const evaluated = evaluateCompanyReadiness(configured, policy, assessment(configured, "eligible", "promote_to_operational").evidence, changedAt);
  const operational = applyReadinessAssessment(configured, evaluated, "2026-07-30T12:00:00.000Z");
  assert.equal(operational.lifecycle, "operational");
  const attention = applyReadinessAssessment(operational, assessment(operational, "ineligible", "mark_attention_required", "2026-07-30T12:00:00.000Z"), "2026-07-30T13:00:00.000Z");
  assert.equal(attention.lifecycle, "attention_required");
  const recovered = applyReadinessAssessment(attention, assessment(attention, "eligible", "promote_to_operational", "2026-07-30T13:00:00.000Z"), "2026-07-30T14:00:00.000Z");
  assert.equal(recovered.lifecycle, "operational");
  assert.deepEqual(applyReadinessAssessment(recovered, assessment(recovered, "indeterminate", "none", "2026-07-30T14:00:00.000Z"), changedAt), recovered);
  assert.throws(() => createReadinessAssessment(assessment(configured, "indeterminate", "promote_to_operational")));
  assert.throws(() => applyReadinessAssessment(configured, assessment(configured, "ineligible", "mark_attention_required"), "2026-07-30T12:00:00.000Z"));
  const suspended = suspendCompany(configured, "2026-07-30T12:00:00.000Z");
  assert.throws(() => applyReadinessAssessment(suspended, assessment(suspended, "eligible", "promote_to_operational", "2026-07-30T12:00:00.000Z"), "2026-07-30T13:00:00.000Z"));
});

test("Readiness policy evaluation rejects mismatched policy identity and malformed evidence", () => {
  const configured = configuredCompany();
  const policy: CompanyReadinessPolicy = { definition: { id: "policy-a", version: "1", productCapabilities: [], dependencyCategories: [] }, assess: (company, _evidence, evaluatedAt) => ({ ...assessment(company, "eligible", "promote_to_operational", evaluatedAt), policy: { id: "policy-a", version: "1", productCapabilities: ["different"], dependencyCategories: [] } }) };
  assert.throws(() => evaluateCompanyReadiness(configured, policy, [], changedAt));
  assert.throws(() => createReadinessAssessment({ ...assessment(configured, "eligible", "promote_to_operational"), evidence: [{ source: "", state: "ready", version: "1", asOf: changedAt }] }));
  assert.throws(() => createCompanyConfiguration({ ...configuration, businessHours: { weekly: { ...weekly, sunday: [{ opensAt: "24:00", closesAt: "25:00" }] } } }));
});

test("Readiness assessments reject stale revisions and cross-Company application", () => {
  const configured = configuredCompany();
  const eligible = assessment(configured, "eligible", "promote_to_operational");
  const changed = updateCompanyBranding(configured, { publicName: "Atlas" }, "2026-07-30T12:00:00.000Z");
  assert.throws(() => applyReadinessAssessment(changed, eligible, "2026-07-30T13:00:00.000Z"));
  const other = updateCompanyConfiguration(createCompany({ id: 8, workspaceId: 2, identity: { name: "Other", slug: "other", website: "https://other.example" }, createdAt }), configuration, changedAt);
  assert.throws(() => applyReadinessAssessment(other, eligible, "2026-07-30T12:00:00.000Z"));
});

test("Reconstruction and nested runtime validation reject forged aggregate and malformed containers", () => {
  const configured = configuredCompany();
  assert.throws(() => reconstructCompany({ ...configured, normalizedName: "forged" }));
  assert.throws(() => reconstructCompany({ ...configured, lifecycle: "operational", configuration: null }));
  assert.throws(() => reconstructCompany({ ...configured, lifecycle: "suspended", suspendedAt: null }));
  assert.throws(() => createBusinessHours({ weekly: { ...weekly, monday: null as unknown as BusinessHoursInput["weekly"]["monday"] } }));
  assert.throws(() => createBusinessHours({ weekly: { ...weekly, monday: [{ opensAt: 9 as unknown as string, closesAt: "17:00" }] } }));
});
