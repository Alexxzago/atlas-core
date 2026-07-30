export type DashboardHealthState = "ready" | "pending" | "attention_required" | "unavailable" | "not_assessed";
export type DashboardConnectionStatus = "connected" | "pending" | "attention_required" | "disconnected" | "not_assessed";
export type DashboardConnectionKind = "whatsapp" | "knowledge" | "assistant" | "channels";
export type DashboardActionId = "create_company" | "select_company" | "connect_whatsapp";
export type DashboardInsightId = "company_setup" | "company_selection" | "connection_status_not_assessed";
export type DashboardCompanyStatus = "processing" | "ready" | "failed";
export type DashboardContext = "workspace_without_companies" | "workspace_with_companies" | "company_selected";

export interface DashboardWorkspaceSource {
  readonly id: string;
  readonly name: string;
}

export interface DashboardCompany {
  readonly id: number;
  readonly name: string;
  readonly status: DashboardCompanyStatus;
}

export interface DashboardConnectionState {
  readonly kind: DashboardConnectionKind;
  readonly state: DashboardConnectionStatus;
}

export interface DashboardAction {
  readonly id: DashboardActionId;
  readonly destination: string;
  readonly priority: "primary" | "secondary";
  readonly reason: "setup_required" | "connection_not_assessed";
}

export interface DashboardActivityEvent {
  readonly type: "system" | "connection" | "knowledge" | "assistant";
  readonly title: string;
  readonly detail: string;
  readonly timestamp: string;
  readonly severity: "neutral" | "attention";
}

export interface DashboardViewModel {
  readonly context: DashboardContext;
  readonly workspaceName: string | null;
  readonly company: DashboardCompany | null;
  readonly health: DashboardHealthState;
  readonly connections: readonly DashboardConnectionState[];
  readonly actions: readonly DashboardAction[];
  readonly activity: readonly DashboardActivityEvent[];
  readonly insight: DashboardInsightId;
}

const notAssessedConnections: readonly DashboardConnectionState[] = [
  { kind: "whatsapp", state: "not_assessed" },
  { kind: "knowledge", state: "not_assessed" },
  { kind: "assistant", state: "not_assessed" },
  { kind: "channels", state: "not_assessed" },
];

export function buildDashboardViewModel(workspace: DashboardWorkspaceSource | null, companies: readonly DashboardCompany[], company: DashboardCompany | null): DashboardViewModel {
  if (!company) {
    const hasCompanies = companies.length > 0;
    return {
      context: hasCompanies ? "workspace_with_companies" : "workspace_without_companies",
      workspaceName: workspace?.name ?? null,
      company: null,
      health: "not_assessed",
      connections: notAssessedConnections,
      actions: [{ id: hasCompanies ? "select_company" : "create_company", destination: "/companies", priority: "primary", reason: "setup_required" }],
      activity: [],
      insight: hasCompanies ? "company_selection" : "company_setup",
    };
  }
  return {
    context: "company_selected",
    workspaceName: workspace?.name ?? null,
    company: { id: company.id, name: company.name, status: company.status },
    health: "not_assessed",
    connections: notAssessedConnections,
    actions: [{ id: "connect_whatsapp", destination: `/companies/${company.id}/channels/whatsapp`, priority: "primary", reason: "connection_not_assessed" }],
    activity: [],
    insight: "connection_status_not_assessed",
  };
}
