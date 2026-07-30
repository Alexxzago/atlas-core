import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardViewModel } from "./dashboardPresentation.ts";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: [] };
const company = { id: 7, name: "Company", website: "", phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };

test("a workspace without companies receives a deterministic company setup action", () => {
  const model = buildDashboardViewModel(workspace, [], null);
  assert.equal(model.context, "workspace_without_companies");
  assert.equal(model.actions[0]?.id, "create_company");
  assert.equal(model.actions[0]?.destination, "/companies");
  assert.equal(model.activity.length, 0);
  assert.equal(model.health, "not_assessed");
});

test("a workspace with companies and no selection prompts for company selection", () => {
  const model = buildDashboardViewModel(workspace, [company], null);
  assert.equal(model.context, "workspace_with_companies");
  assert.equal(model.actions[0]?.id, "select_company");
  assert.equal(model.actions[0]?.destination, "/companies");
});

test("company dashboard data contains no fabricated operational readiness", () => {
  const model = buildDashboardViewModel(workspace, [company], company);
  assert.equal(model.context, "company_selected");
  assert.equal(model.company?.id, company.id);
  assert.equal(model.actions[0]?.destination, "/companies/7/channels/whatsapp");
  assert.ok(model.connections.every((connection) => connection.state === "not_assessed"));
  assert.equal(model.activity.length, 0);
});
