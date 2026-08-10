import type { Company } from "../types/api";

export type AuthenticatedOnboardingProgress = "loading" | "error" | "needs-workspace" | "needs-workspace-selection" | "needs-company" | "activation-pending" | "ready";

export interface OnboardingProgressSnapshot {
  readonly workspacesLoading: boolean;
  readonly workspaceError: boolean;
  readonly initialWorkspaceResolved?: boolean;
  readonly pendingWorkspaceId: string | null;
  readonly selectedWorkspaceId: string | null;
  readonly workspaceCount: number;
  readonly companiesLoading: boolean;
  readonly companyError: boolean;
  readonly companies: readonly Company[];
}

export function resolveAuthenticatedOnboardingProgress(snapshot: OnboardingProgressSnapshot): AuthenticatedOnboardingProgress {
  if (snapshot.workspacesLoading || snapshot.pendingWorkspaceId !== null || (snapshot.selectedWorkspaceId !== null && snapshot.companiesLoading)) return "loading";
  if (snapshot.workspaceError || (snapshot.selectedWorkspaceId !== null && snapshot.companyError)) return "error";
  if (snapshot.workspaceCount > 0 && snapshot.initialWorkspaceResolved === false) return "loading";
  if (snapshot.workspaceCount === 0) return "needs-workspace";
  if (snapshot.selectedWorkspaceId === null) return "needs-workspace-selection";
  if (snapshot.companies.length === 0) return "needs-company";
  // Company Core lifecycle is handled by the checklist. Only the legacy asynchronous state uses this screen.
  if (snapshot.companies.length === 1 && snapshot.companies[0]?.status === "processing" && snapshot.companies[0].lifecycle === undefined) return "activation-pending";
  return "ready";
}

export function onboardingProgressPath(progress: AuthenticatedOnboardingProgress): string | null {
  if (progress === "needs-workspace" || progress === "needs-workspace-selection") return "/onboarding/workspace";
  if (progress === "needs-company") return "/onboarding/company";
  if (progress === "activation-pending") return "/activation-pending";
  return null;
}
