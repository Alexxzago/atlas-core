import type { Company } from "../types/api";

export type ProductBootstrapState = "bootstrapping" | "no_workspace" | "no_company" | "choose_company" | "error" | "ready";
export type ProductBootstrapStage = "session" | "memberships" | "workspace" | "companies" | "company" | "permissions";

export interface ProductBootstrapSnapshot {
  readonly workspacesLoading: boolean;
  readonly workspaceError: boolean;
  readonly initialWorkspaceResolved: boolean;
  readonly pendingWorkspaceId: string | null;
  readonly selectedWorkspaceId: string | null;
  readonly workspaceCount: number;
  readonly companiesLoading: boolean;
  readonly companiesResolved: boolean;
  readonly companyError: boolean;
  readonly companies: readonly Company[];
  readonly selectedCompanyId: number | null;
  readonly companySelectionPending: boolean;
  readonly workspaceCapabilitiesResolved: boolean;
}

export interface ProductBootstrapProgress {
  readonly state: ProductBootstrapState;
  readonly completedStages: readonly ProductBootstrapStage[];
  readonly currentStage: ProductBootstrapStage;
}

const stages: readonly ProductBootstrapStage[] = ["session", "memberships", "workspace", "companies", "company", "permissions"];

export function resolveProductBootstrap(snapshot: ProductBootstrapSnapshot): ProductBootstrapProgress {
  const completed: ProductBootstrapStage[] = ["session"];
  if (!snapshot.workspacesLoading) completed.push("memberships");
  if (completed.length === 2 && snapshot.selectedWorkspaceId !== null) completed.push("workspace");
  if (completed.length === 3 && snapshot.companiesResolved) completed.push("companies");
  if (completed.length === 4 && snapshot.selectedCompanyId !== null) completed.push("company");
  if (completed.length === 5 && snapshot.workspaceCapabilitiesResolved) completed.push("permissions");

  if (snapshot.workspacesLoading) {
    return { state: "bootstrapping", completedStages: completed, currentStage: stages[completed.length] ?? "permissions" };
  }
  if (snapshot.workspaceError) {
    return { state: "error", completedStages: completed, currentStage: stages[completed.length] ?? "permissions" };
  }
  if (!snapshot.initialWorkspaceResolved || snapshot.pendingWorkspaceId !== null || (snapshot.selectedWorkspaceId !== null && (!snapshot.companiesResolved || snapshot.companySelectionPending))) return { state: "bootstrapping", completedStages: completed, currentStage: stages[completed.length] ?? "permissions" };
  if (snapshot.selectedWorkspaceId !== null && snapshot.companyError) return { state: "error", completedStages: completed, currentStage: stages[completed.length] ?? "permissions" };
  if (snapshot.workspaceCount === 0) return { state: "no_workspace", completedStages: completed, currentStage: "workspace" };
  if (snapshot.selectedWorkspaceId === null) return { state: "no_workspace", completedStages: completed, currentStage: "workspace" };
  if (snapshot.companies.length === 0) return { state: "no_company", completedStages: completed, currentStage: "company" };
  if (snapshot.selectedCompanyId === null) return { state: "choose_company", completedStages: completed, currentStage: "company" };
  return { state: "ready", completedStages: stages, currentStage: "permissions" };
}
