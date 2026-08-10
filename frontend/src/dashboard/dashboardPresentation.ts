import type { AssistantReadinessAssessment, Company, WorkspaceSummary } from "../types/api";

export type WorkspaceEvidenceState = "ready" | "needs_attention" | "not_connected" | "configuring" | "checking" | "unavailable";
export type WorkspaceActionId = "create_company" | "choose_company" | "wait_for_company" | "repair_company" | "prepare_atlas" | "teach_atlas" | "connect_place" | "continue_place" | "supervise" | "review_setup" | "retry";

export interface CompanyWorkspaceSnapshot {
  readonly readiness: AssistantReadinessAssessment;
  readonly webChatConnections: number;
  readonly whatsAppConnections: number;
  readonly operationalWebChatConnections: number;
  readonly operationalWhatsAppConnections: number;
}

export interface WorkspaceEvidence {
  readonly id: "brief" | "knowledge" | "places";
  readonly state: WorkspaceEvidenceState;
}

export interface WorkspaceNextAction {
  readonly id: WorkspaceActionId;
  readonly destination: string | null;
}

export interface CompanyWorkspaceViewModel {
  readonly context: "no_workspace" | "first_company" | "choose_company" | "company";
  readonly workspaceName: string | null;
  readonly company: Company | null;
  readonly state: "ready" | "loading" | "unavailable";
  readonly message: "no_workspace" | "companies_loading" | "companies_unavailable" | "first_company" | "choose_company" | "company_processing" | "company_failed" | "brief_missing" | "knowledge_missing" | "place_missing" | "place_configuring" | "working" | "setup_blocked" | "unavailable";
  readonly action: WorkspaceNextAction;
  readonly evidence: readonly WorkspaceEvidence[];
}

interface BuildCompanyWorkspaceInput {
  readonly workspace: WorkspaceSummary | null;
  readonly companies: readonly Company[];
  readonly company: Company | null;
  readonly snapshot?: CompanyWorkspaceSnapshot | null;
  readonly loading?: boolean;
  readonly unavailable?: boolean;
  readonly companiesLoading?: boolean;
  readonly companiesUnavailable?: boolean;
}

function evidence(snapshot: CompanyWorkspaceSnapshot | null | undefined, state: "loading" | "unavailable" | "ready"): readonly WorkspaceEvidence[] {
  if (state !== "ready" || !snapshot) {
    const evidenceState: WorkspaceEvidenceState = state === "loading" ? "checking" : "unavailable";
    return ["brief", "knowledge", "places"].map((id) => ({ id, state: evidenceState })) as readonly WorkspaceEvidence[];
  }
  return [
    { id: "brief", state: snapshot.readiness.assistantProfileId ? "ready" : "needs_attention" },
    { id: "knowledge", state: snapshot.readiness.knowledgeVersionId ? "ready" : "needs_attention" },
    { id: "places", state: snapshot.operationalWebChatConnections + snapshot.operationalWhatsAppConnections > 0 ? "ready" : snapshot.webChatConnections + snapshot.whatsAppConnections > 0 ? "configuring" : "not_connected" },
  ];
}

export function buildAtlasNextAction(company: Company, snapshot: CompanyWorkspaceSnapshot): WorkspaceNextAction {
  const base = `/companies/${company.id}`;
  if (company.status === "processing" && company.lifecycle === undefined) return { id: "wait_for_company", destination: null };
  if (company.status === "failed") return { id: "repair_company", destination: base };
  if (!snapshot.readiness.assistantProfileId || snapshot.readiness.blockers.includes("default_assistant_missing")) return { id: "prepare_atlas", destination: `${base}/assistant` };
  if (!snapshot.readiness.knowledgeVersionId || snapshot.readiness.blockers.includes("published_knowledge_missing")) return { id: "teach_atlas", destination: `${base}/knowledge` };
  if (snapshot.readiness.status !== "ready") return { id: "review_setup", destination: `${base}/channels` };
  if (snapshot.operationalWebChatConnections + snapshot.operationalWhatsAppConnections > 0) return { id: "supervise", destination: "/conversations" };
  if (snapshot.webChatConnections + snapshot.whatsAppConnections > 0) return { id: "continue_place", destination: snapshot.whatsAppConnections === 1 && snapshot.webChatConnections === 0 ? `${base}/channels/whatsapp` : `${base}/channels` };
  if (snapshot.webChatConnections + snapshot.whatsAppConnections === 0) return { id: "connect_place", destination: `${base}/channels` };
  return { id: "supervise", destination: "/conversations" };
}

export function buildCompanyWorkspaceViewModel(input: BuildCompanyWorkspaceInput): CompanyWorkspaceViewModel {
  if (!input.workspace) return { context: "no_workspace", workspaceName: null, company: null, state: "ready", message: "no_workspace", action: { id: "retry", destination: "/settings" }, evidence: [] };
  if (!input.company && input.companiesLoading) return { context: "choose_company", workspaceName: input.workspace.name, company: null, state: "loading", message: "companies_loading", action: { id: "wait_for_company", destination: null }, evidence: [] };
  if (!input.company && input.companiesUnavailable) return { context: "choose_company", workspaceName: input.workspace.name, company: null, state: "unavailable", message: "companies_unavailable", action: { id: "retry", destination: null }, evidence: [] };
  if (!input.company) {
    const first = input.companies.length === 0;
    return { context: first ? "first_company" : "choose_company", workspaceName: input.workspace.name, company: null, state: "ready", message: first ? "first_company" : "choose_company", action: { id: first ? "create_company" : "choose_company", destination: "/companies" }, evidence: [] };
  }
  const state = input.unavailable ? "unavailable" : input.loading || !input.snapshot ? "loading" : "ready";
  if (state === "unavailable") return { context: "company", workspaceName: input.workspace.name, company: input.company, state, message: "unavailable", action: { id: "retry", destination: null }, evidence: evidence(null, state) };
  if (state === "loading") return { context: "company", workspaceName: input.workspace.name, company: input.company, state, message: input.company.status === "processing" && input.company.lifecycle === undefined ? "company_processing" : "brief_missing", action: { id: "wait_for_company", destination: null }, evidence: evidence(null, state) };
  const snapshot = input.snapshot!;
  const action = buildAtlasNextAction(input.company, snapshot);
  const message = input.company.status === "processing" && input.company.lifecycle === undefined ? "company_processing" : input.company.status === "failed" ? "company_failed" : action.id === "prepare_atlas" ? "brief_missing" : action.id === "teach_atlas" ? "knowledge_missing" : action.id === "connect_place" ? "place_missing" : action.id === "continue_place" ? "place_configuring" : action.id === "supervise" ? "working" : "setup_blocked";
  return { context: "company", workspaceName: input.workspace.name, company: input.company, state, message, action, evidence: evidence(snapshot, state) };
}
