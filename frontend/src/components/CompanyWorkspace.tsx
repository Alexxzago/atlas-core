import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyUpdate } from "../types/api";
import { ChatPanel } from "./ChatPanel";
import { CompanySummary } from "./CompanySummary";
import { OnboardingPanel } from "./OnboardingPanel";

interface Props {
  company: Company | null;
  loading: boolean;
  onUpdate: (input: CompanyUpdate) => Promise<void>;
  onDelete: () => Promise<void>;
  onOnboardingStart: (companyId: number) => void;
  onOnboardingComplete: (company: Company) => void;
  onOnboardingFailure: (companyId: number) => Promise<void>;
}

export function CompanyWorkspace({ company, loading, onUpdate, onDelete, onOnboardingStart, onOnboardingComplete, onOnboardingFailure }: Props): React.JSX.Element {
  const { t } = useI18n();
  if (loading) return <main className="workspace workspace-state" aria-label={t("accessibility.mainContent")}><p role="status">{t("states.loadingCompany")}</p></main>;
  if (!company) return <main className="workspace workspace-state" aria-label={t("accessibility.mainContent")}><div><h1>{t("companies.selectPrompt")}</h1><p>{t("companies.emptyDescription")}</p></div></main>;
  return <main className="workspace" aria-label={t("accessibility.mainContent")}><div className="workspace-surface"><CompanySummary company={company} onUpdate={onUpdate} onDelete={onDelete} /><OnboardingPanel company={company} onStart={onOnboardingStart} onComplete={onOnboardingComplete} onFailure={onOnboardingFailure} /><ChatPanel company={company} /></div></main>;
}
