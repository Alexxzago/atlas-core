import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAtlasNextAction, buildCompanyWorkspaceViewModel, type CompanyWorkspaceSnapshot } from "./dashboardPresentation.ts";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: [] };
const company = { id: 7, name: "Company", website: "", phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };
const readiness = { assistantIdentifier: "default" as const, workspaceId: 1, companyId: 7, status: "ready" as const, blockers: [], knowledgeVersionId: "knowledge", assistantProfileId: "assistant", evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "1", configurationDigest: "digest" };
const snapshot = (overrides: Partial<CompanyWorkspaceSnapshot> = {}): CompanyWorkspaceSnapshot => ({ readiness, webChatConnections: 0, whatsAppConnections: 0, ...overrides });

test("focuses the first-company state on one creation action", () => {
  const model = buildCompanyWorkspaceViewModel({ workspace, companies: [], company: null });
  assert.equal(model.context, "first_company"); assert.equal(model.action.id, "create_company"); assert.equal(model.evidence.length, 0);
});

test("maps every supported readiness outcome to one action", () => {
  assert.equal(buildAtlasNextAction(company, snapshot({ readiness: { ...readiness, status: "blocked", blockers: ["default_assistant_missing"], assistantProfileId: null } })).id, "prepare_atlas");
  assert.equal(buildAtlasNextAction(company, snapshot({ readiness: { ...readiness, status: "blocked", blockers: ["published_knowledge_missing"], knowledgeVersionId: null } })).id, "teach_atlas");
  assert.equal(buildAtlasNextAction(company, snapshot()).id, "connect_place");
  assert.equal(buildAtlasNextAction(company, snapshot({ whatsAppConnections: 1 })).id, "supervise");
  assert.equal(buildAtlasNextAction(company, snapshot({ readiness: { ...readiness, status: "blocked", blockers: ["unknown"] } })).id, "review_setup");
});

test("represents unavailable checks without fabricated operational values", () => {
  const model = buildCompanyWorkspaceViewModel({ workspace, companies: [company], company, unavailable: true });
  assert.equal(model.state, "unavailable"); assert.equal(model.message, "unavailable"); assert.ok(model.evidence.every((item) => item.state === "unavailable"));
});

test("company-list loading and failure never become first-company creation", () => {
  const loading = buildCompanyWorkspaceViewModel({ workspace, companies: [], company: null, companiesLoading: true });
  assert.equal(loading.message, "companies_loading"); assert.equal(loading.action.id, "wait_for_company");
  const failed = buildCompanyWorkspaceViewModel({ workspace, companies: [], company: null, companiesUnavailable: true });
  assert.equal(failed.message, "companies_unavailable"); assert.equal(failed.action.id, "retry");
  const empty = buildCompanyWorkspaceViewModel({ workspace, companies: [], company: null });
  assert.equal(empty.message, "first_company"); assert.equal(empty.action.id, "create_company");
});
