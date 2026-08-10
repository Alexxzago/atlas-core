import { useI18n } from "../i18n/I18nContext";
import type { TranslationKey } from "../i18n/translations";
import type { CompanyWorkspaceViewModel, WorkspaceActionId, WorkspaceEvidenceState } from "./dashboardPresentation";
import { ProgressIndicator } from "../design-system/feedback";

const messageTitle: Record<CompanyWorkspaceViewModel["message"], TranslationKey> = {
  no_workspace: "today.noWorkspace.title", companies_loading: "today.companiesLoading.title", companies_unavailable: "today.companiesUnavailable.title", first_company: "today.firstCompany.title", choose_company: "today.chooseCompany.title", company_processing: "today.processing.title", company_failed: "today.failed.title", brief_missing: "today.briefMissing.title", knowledge_missing: "today.knowledgeMissing.title", place_missing: "today.placeMissing.title", place_configuring: "today.placeConfiguring.title", working: "today.working.title", setup_blocked: "today.blocked.title", unavailable: "today.unavailable.title",
};
const messageDescription: Record<CompanyWorkspaceViewModel["message"], TranslationKey> = {
  no_workspace: "today.noWorkspace.description", companies_loading: "today.companiesLoading.description", companies_unavailable: "today.companiesUnavailable.description", first_company: "today.firstCompany.description", choose_company: "today.chooseCompany.description", company_processing: "today.processing.description", company_failed: "today.failed.description", brief_missing: "today.briefMissing.description", knowledge_missing: "today.knowledgeMissing.description", place_missing: "today.placeMissing.description", place_configuring: "today.placeConfiguring.description", working: "today.working.description", setup_blocked: "today.blocked.description", unavailable: "today.unavailable.description",
};
const actionLabel: Record<WorkspaceActionId, TranslationKey> = {
  create_company: "today.action.createCompany", choose_company: "today.action.chooseCompany", wait_for_company: "today.action.wait", repair_company: "today.action.reviewCompany", prepare_atlas: "today.action.prepare", teach_atlas: "today.action.teach", connect_place: "today.action.connect", continue_place: "today.action.continuePlace", supervise: "today.action.supervise", review_setup: "today.action.reviewSetup", retry: "common.retry",
};
const evidenceLabel = { brief: "today.evidence.brief", knowledge: "today.evidence.knowledge", places: "today.evidence.places" } as const satisfies Record<string, TranslationKey>;
const evidenceState: Record<WorkspaceEvidenceState, TranslationKey> = { ready: "today.evidence.ready", needs_attention: "today.evidence.needsAttention", not_connected: "today.evidence.notConnected", configuring: "today.evidence.configuring", checking: "today.evidence.checking", unavailable: "today.evidence.unavailable" };

interface Props {
  readonly model: CompanyWorkspaceViewModel;
  readonly onNavigate: (destination: string) => void;
  readonly onRetry?: () => void;
  readonly onChooseCompany?: () => void;
}

export function DashboardPage({ model, onNavigate, onRetry, onChooseCompany }: Props): React.JSX.Element {
  const { t } = useI18n();
  const activate = (): void => {
    if (model.action.id === "retry" && onRetry) { onRetry(); return; }
    if ((model.action.id === "create_company" || model.action.id === "choose_company") && onChooseCompany) { onChooseCompany(); return; }
    if (model.action.destination) onNavigate(model.action.destination);
  };
  const actionAvailable = model.action.id !== "wait_for_company" && (model.action.destination !== null || Boolean(onRetry) || Boolean(onChooseCompany));
  return <div className={`today-workspace today-workspace--${model.state}`} aria-busy={model.state === "loading"}>
    <header className="work-anchor">
      <p className="work-anchor__context">{model.company ? t("today.companyContext", { companyName: model.company.name }) : model.workspaceName ?? t("today.workspaceContext")}</p>
      <h1 tabIndex={-1}>{model.company ? t("today.title") : t(messageTitle[model.message])}</h1>
      {model.company && model.state === "loading" ? <ProgressIndicator label={t("today.evidence.checking")}/> : <div className="readiness-statement" {...(model.state === "unavailable" ? { role: "alert" } : { role: "status" })}>
        <strong>{t(messageTitle[model.message])}</strong>
        <p>{t(messageDescription[model.message])}</p>
      </div>}
      {!model.company && <p className="work-anchor__lead">{t(messageDescription[model.message])}</p>}
      {actionAvailable && <button className="button button--primary next-action" type="button" onClick={activate}>{t(actionLabel[model.action.id])}</button>}
      {model.action.id === "wait_for_company" && <p className="work-anchor__quiet" role="status">{t(actionLabel.wait_for_company)}</p>}
    </header>
    {model.evidence.length > 0 && <section className="readiness-evidence" aria-labelledby="readiness-evidence-title">
      <h2 id="readiness-evidence-title">{t("today.evidence.title")}</h2>
      <dl>{model.evidence.map((item) => <div className="evidence-row" key={item.id}><dt>{t(evidenceLabel[item.id])}</dt><dd data-state={item.state}>{t(evidenceState[item.state])}</dd></div>)}</dl>
    </section>}
  </div>;
}
