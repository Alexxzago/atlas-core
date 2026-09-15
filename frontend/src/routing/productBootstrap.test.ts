import { expect, test } from "vitest";
import { resolveProductBootstrap } from "./productBootstrap";

const company = { id: 1, name: "Company", website: null, phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01" };
const base = { workspacesLoading: false, workspaceError: false, initialWorkspaceResolved: true, pendingWorkspaceId: null, selectedWorkspaceId: "workspace", workspaceCount: 1, companiesLoading: false, companiesResolved: true, companyError: false, companies: [company], selectedCompanyId: 1, companySelectionPending: false, workspaceCapabilitiesResolved: true } as const;

test("holds every unresolved product input in the bootstrapping state", () => {
  expect(resolveProductBootstrap({ ...base, workspacesLoading: true }).state).toBe("bootstrapping");
  expect(resolveProductBootstrap({ ...base, initialWorkspaceResolved: false }).state).toBe("bootstrapping");
  expect(resolveProductBootstrap({ ...base, companiesResolved: false, companiesLoading: true }).state).toBe("bootstrapping");
  expect(resolveProductBootstrap({ ...base, selectedCompanyId: null, companySelectionPending: true, workspaceCapabilitiesResolved: false }).state).toBe("bootstrapping");
});

test("derives monotonic progress only from completed bootstrap stages", () => {
  const memberships = resolveProductBootstrap({ ...base, selectedWorkspaceId: null, companiesResolved: false, companies: [], selectedCompanyId: null, workspaceCapabilitiesResolved: false });
  const workspace = resolveProductBootstrap({ ...base, companiesResolved: false, companies: [], selectedCompanyId: null, workspaceCapabilitiesResolved: false });
  const companies = resolveProductBootstrap({ ...base, companies: [], selectedCompanyId: null, workspaceCapabilitiesResolved: false });
  const ready = resolveProductBootstrap(base);
  expect(memberships.completedStages).toEqual(["session", "memberships"]);
  expect(workspace.completedStages).toEqual(["session", "memberships", "workspace"]);
  expect(companies.completedStages).toEqual(["session", "memberships", "workspace", "companies"]);
  expect(ready.completedStages).toHaveLength(6);
  expect(ready.state).toBe("ready");
});

test("renders semantic fallbacks only after the corresponding input resolved", () => {
  expect(resolveProductBootstrap({ ...base, selectedWorkspaceId: null, workspaceCount: 0, companiesResolved: false, companies: [], selectedCompanyId: null, workspaceCapabilitiesResolved: false }).state).toBe("no_workspace");
  expect(resolveProductBootstrap({ ...base, companies: [], selectedCompanyId: null, workspaceCapabilitiesResolved: false }).state).toBe("no_company");
  expect(resolveProductBootstrap({ ...base, selectedCompanyId: null, workspaceCapabilitiesResolved: false }).state).toBe("choose_company");
  expect(resolveProductBootstrap({ ...base, companyError: true, companies: [], selectedCompanyId: null, workspaceCapabilitiesResolved: false }).state).toBe("error");
});
