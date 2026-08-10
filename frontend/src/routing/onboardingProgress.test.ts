import { expect, test } from "vitest";
import { onboardingProgressPath, resolveAuthenticatedOnboardingProgress } from "./onboardingProgress";

const base = { workspacesLoading: false, workspaceError: false, pendingWorkspaceId: null, selectedWorkspaceId: null, workspaceCount: 0, companiesLoading: false, companyError: false, companies: [] } as const;
const company = { id: 1, name: "Company", website: null, phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01" };

test("resolves post-login progress without treating Company Core draft as operational", () => {
  expect(resolveAuthenticatedOnboardingProgress(base)).toBe("needs-workspace");
  expect(resolveAuthenticatedOnboardingProgress({ ...base, workspaceCount: 1, initialWorkspaceResolved: false })).toBe("loading");
  expect(resolveAuthenticatedOnboardingProgress({ ...base, workspaceCount: 2 })).toBe("needs-workspace-selection");
  expect(resolveAuthenticatedOnboardingProgress({ ...base, workspaceCount: 1, selectedWorkspaceId: "workspace" })).toBe("needs-company");
  expect(resolveAuthenticatedOnboardingProgress({ ...base, workspaceCount: 1, selectedWorkspaceId: "workspace", companies: [{ ...company, status: "processing", lifecycle: "draft" }] })).toBe("ready");
  expect(resolveAuthenticatedOnboardingProgress({ ...base, workspaceCount: 1, selectedWorkspaceId: "workspace", companies: [{ ...company, status: "processing" }] })).toBe("activation-pending");
  expect(resolveAuthenticatedOnboardingProgress({ ...base, workspaceCount: 1, selectedWorkspaceId: "workspace", companies: [{ ...company, lifecycle: "operational" }] })).toBe("ready");
});

test("maps only incomplete authenticated states to canonical onboarding routes", () => {
  expect(onboardingProgressPath("needs-workspace")).toBe("/onboarding/workspace");
  expect(onboardingProgressPath("needs-workspace-selection")).toBe("/onboarding/workspace");
  expect(onboardingProgressPath("needs-company")).toBe("/onboarding/company");
  expect(onboardingProgressPath("activation-pending")).toBe("/activation-pending");
  expect(onboardingProgressPath("ready")).toBeNull();
});
