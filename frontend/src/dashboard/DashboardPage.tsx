import { EmptyState, ErrorState, Skeleton, StatusIndicator } from "../design-system/feedback";
import { PageHeader } from "../components/AppShell";
import { useI18n } from "../i18n/I18nContext";
import type { TranslationKey } from "../i18n/translations";
import type { DashboardAction, DashboardConnectionKind, DashboardConnectionStatus, DashboardHealthState, DashboardViewModel } from "./dashboardPresentation";

export type DashboardPageState = "ready" | "loading" | "empty" | "unavailable" | "error";

const healthLabels: Record<DashboardHealthState, TranslationKey> = {
  ready: "dashboard.state.ready", pending: "dashboard.state.pending", attention_required: "dashboard.state.attentionRequired",
  unavailable: "dashboard.state.unavailable", not_assessed: "dashboard.state.notAssessed",
};
const connectionKindLabels: Record<DashboardConnectionKind, TranslationKey> = {
  whatsapp: "dashboard.connection.whatsapp", knowledge: "dashboard.connection.knowledge", assistant: "dashboard.connection.assistant", channels: "dashboard.connection.channels",
};
const actionTitles: Record<DashboardAction["id"], TranslationKey> = { create_company: "dashboard.action.createCompany.title", select_company: "dashboard.action.selectCompany.title", connect_whatsapp: "dashboard.action.connectWhatsApp.title" };
const actionDescriptions: Record<DashboardAction["id"], TranslationKey> = { create_company: "dashboard.action.createCompany.description", select_company: "dashboard.action.selectCompany.description", connect_whatsapp: "dashboard.action.connectWhatsApp.description" };
const actionReasons: Record<DashboardAction["reason"], TranslationKey> = { setup_required: "dashboard.action.reason.setupRequired", connection_not_assessed: "dashboard.action.reason.connectionNotAssessed" };
const insightCopy: Record<DashboardViewModel["insight"], TranslationKey> = { company_setup: "dashboard.insight.companySetup", company_selection: "dashboard.insight.companySelection", connection_status_not_assessed: "dashboard.insight.connectionStatusNotAssessed" };

function tone(state: DashboardHealthState): "neutral" | "success" | "warning" | "danger" | "info" {
  if (state === "ready") return "success";
  if (state === "attention_required") return "danger";
  if (state === "pending") return "warning";
  return "neutral";
}

const connectionLabels: Record<DashboardConnectionStatus, TranslationKey> = {
  connected: "dashboard.connectionState.connected", pending: "dashboard.connectionState.pending", attention_required: "dashboard.connectionState.attentionRequired", disconnected: "dashboard.connectionState.disconnected", not_assessed: "dashboard.connectionState.notAssessed",
};

function connectionTone(state: DashboardConnectionStatus): "neutral" | "success" | "warning" | "danger" | "info" {
  if (state === "connected") return "success";
  if (state === "attention_required" || state === "disconnected") return "danger";
  if (state === "pending") return "warning";
  return "neutral";
}

export function DashboardGrid({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="dashboard-grid">{children}</div>;
}

export function DashboardSection({ children, className = "" }: { readonly children: React.ReactNode; readonly className?: string }): React.JSX.Element {
  return <section className={`dashboard-section ${className}`.trim()}>{children}</section>;
}

export function DashboardWidget({ title, children, className = "" }: { readonly title: string; readonly children: React.ReactNode; readonly className?: string }): React.JSX.Element {
  const id = `dashboard-widget-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return <DashboardSection className={`dashboard-widget ${className}`.trim()}><h2 id={id}>{title}</h2><div aria-labelledby={id}>{children}</div></DashboardSection>;
}

export function DashboardSkeleton(): React.JSX.Element {
  const { t } = useI18n();
  return <div className="dashboard-skeleton"><Skeleton label={t("dashboard.loading")} lines={3} /><Skeleton label={t("dashboard.loading")} lines={4} /><Skeleton label={t("dashboard.loading")} lines={3} /></div>;
}

export function DashboardEmptyState(): React.JSX.Element {
  const { t } = useI18n();
  return <EmptyState title={t("dashboard.empty.title")} description={t("dashboard.empty.description")} />;
}

export function DashboardUnavailableState({ error = false }: { readonly error?: boolean }): React.JSX.Element {
  const { t } = useI18n();
  return <ErrorState title={t(error ? "dashboard.error.title" : "dashboard.unavailable.title")} description={t(error ? "dashboard.error.description" : "dashboard.unavailable.description")} />;
}

export function CompanyOverviewWidget({ model }: { readonly model: DashboardViewModel }): React.JSX.Element {
  const { t } = useI18n();
  const description = model.context === "company_selected" ? "dashboard.overview.companyDescription" : model.context === "workspace_without_companies" ? "dashboard.overview.newCustomerDescription" : "dashboard.overview.selectCompanyDescription";
  return <DashboardWidget title={t("dashboard.overview.title")} className="dashboard-grid__summary"><dl className="dashboard-overview"><div><dt>{t("dashboard.overview.workspace")}</dt><dd>{model.workspaceName ?? t("dashboard.overview.notAvailable")}</dd></div><div><dt>{t("dashboard.overview.company")}</dt><dd>{model.company?.name ?? t("dashboard.overview.noCompany")}</dd></div><div><dt>{t("dashboard.overview.status")}</dt><dd>{model.company ? t(`status.${model.company.status}`) : t("dashboard.state.notAssessed")}</dd></div></dl><p>{t(description)}</p></DashboardWidget>;
}

export function CompanyHealthWidget({ state }: { readonly state: DashboardHealthState }): React.JSX.Element {
  const { t } = useI18n();
  return <DashboardWidget title={t("dashboard.health.title")} className="dashboard-grid__health"><StatusIndicator tone={tone(state)}>{t(healthLabels[state])}</StatusIndicator>{state === "not_assessed" && <p>{t("dashboard.health.notAssessedDescription")}</p>}</DashboardWidget>;
}

export function ConnectionStatusWidget({ model }: { readonly model: DashboardViewModel }): React.JSX.Element {
  const { t } = useI18n();
  return <DashboardWidget title={t("dashboard.connections.title")} className="dashboard-grid__connections"><ul className="dashboard-status-list">{model.connections.map((connection) => <li key={connection.kind}><span>{t(connectionKindLabels[connection.kind])}</span><StatusIndicator tone={connectionTone(connection.state)}>{t(connectionLabels[connection.state])}</StatusIndicator></li>)}</ul></DashboardWidget>;
}

export function RecommendedActionsWidget({ actions, onNavigate }: { readonly actions: readonly DashboardAction[]; readonly onNavigate: (destination: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  return <DashboardWidget title={t("dashboard.actions.title")} className="dashboard-grid__actions"><div className="dashboard-actions">{actions.map((action) => <article className="dashboard-action" key={action.id}><div><h3>{t(actionTitles[action.id])}</h3><p>{t(actionDescriptions[action.id])}</p><small>{t(actionReasons[action.reason])}</small></div><button className={`button ${action.priority === "primary" ? "button--primary" : "button--secondary"}`} type="button" onClick={() => onNavigate(action.destination)}>{t("dashboard.actions.open")}</button></article>)}</div></DashboardWidget>;
}

export function AtlasInsightWidget({ insight }: { readonly insight: DashboardViewModel["insight"] }): React.JSX.Element {
  const { t } = useI18n();
  return <DashboardWidget title={t("dashboard.insight.title")} className="dashboard-grid__insight"><p>{t(insightCopy[insight])}</p></DashboardWidget>;
}

export function RecentActivityWidget({ model }: { readonly model: DashboardViewModel }): React.JSX.Element {
  const { t, formatDate } = useI18n();
  return <DashboardWidget title={t("dashboard.activity.title")} className="dashboard-grid__activity">{model.activity.length === 0 ? <p>{t("dashboard.activity.empty")}</p> : <ol className="dashboard-activity">{model.activity.map((event) => <li key={`${event.timestamp}-${event.title}`}><strong>{event.title}</strong><p>{event.detail}</p><time dateTime={event.timestamp}>{formatDate(event.timestamp)}</time></li>)}</ol>}</DashboardWidget>;
}

export function DashboardPage({ model, state = "ready", onNavigate }: { readonly model: DashboardViewModel; readonly state?: DashboardPageState; readonly onNavigate: (destination: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  return <><PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />{state === "loading" ? <DashboardSkeleton /> : state === "empty" ? <DashboardEmptyState /> : state === "unavailable" ? <DashboardUnavailableState /> : state === "error" ? <DashboardUnavailableState error /> : <DashboardGrid><CompanyOverviewWidget model={model} /><CompanyHealthWidget state={model.health} /><RecommendedActionsWidget actions={model.actions} onNavigate={onNavigate} /><ConnectionStatusWidget model={model} /><RecentActivityWidget model={model} /><AtlasInsightWidget insight={model.insight} /></DashboardGrid>}</>;
}
