export type CompanyRouteValidationStatus = "idle" | "loading" | "ready" | "error";

export interface CompanyRouteValidation {
  readonly key: string | null;
  readonly status: CompanyRouteValidationStatus;
}

export function companyRouteKey(workspaceId: string, companyId: number): string {
  return `${workspaceId}:${companyId}`;
}

export function companyRoutePresentation(
  workspaceId: string | null,
  companyId: number | null,
  selectedCompanyId: number | null,
  profilesLoading: boolean,
  validation: CompanyRouteValidation,
): "none" | "loading" | "ready" | "error" {
  if (!companyId) return "none";
  if (!workspaceId) return "loading";
  const key = companyRouteKey(workspaceId, companyId);
  if (validation.key !== key || validation.status === "idle" || validation.status === "loading") return "loading";
  if (validation.status === "error") return "error";
  return selectedCompanyId === companyId && !profilesLoading ? "ready" : "loading";
}
