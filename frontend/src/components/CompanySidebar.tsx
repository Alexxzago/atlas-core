import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyInput } from "../types/api";
import { CompanyCreateForm } from "./CompanyCreateForm";
import { StatusBadge } from "./StatusBadge";

interface Props {
  companies: Company[];
  selectedId: number | null;
  loading: boolean;
  error: boolean;
  onSelect: (companyId: number) => void;
  onCreate: (input: CompanyInput) => Promise<Company>;
  onRetry: () => void;
}

function hostname(website: string): string {
  try { return new URL(website).hostname; } catch { return website; }
}

export function CompanySidebar(props: Props): React.JSX.Element {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const selected = props.companies.find((company) => company.id === props.selectedId);
  const choose = (id: number): void => { props.onSelect(id); setMobileOpen(false); };
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { setMobileOpen(false); mobileTrigger.current?.focus(); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const content = (
    <>
      <div className="sidebar-heading"><h1>{t("companies.title")}</h1><button className="button button--secondary" type="button" onClick={() => setCreating(true)}>+ {t("companies.create")}</button></div>
      {creating && <CompanyCreateForm onCreate={props.onCreate} onClose={() => setCreating(false)} />}
      <div className="company-list" aria-busy={props.loading}>
        {props.loading && <div className="skeleton-list" role="status"><span className="sr-only">{t("states.loadingCompanies")}</span>{[0, 1, 2, 3].map((item) => <span className="skeleton-row" key={item} aria-hidden="true"><span /><span /></span>)}</div>}
        {props.error && <div className="state-block" role="alert"><strong>{t("companies.loadError")}</strong><button className="button button--secondary" type="button" onClick={props.onRetry}>{t("common.retry")}</button></div>}
        {!props.loading && !props.error && props.companies.length === 0 && <div className="state-block"><strong>{t("companies.emptyTitle")}</strong><p>{t("companies.emptyDescription")}</p><button className="button button--primary" type="button" onClick={() => setCreating(true)}>{t("companies.create")}</button></div>}
        {props.companies.map((company) => (
          <button key={company.id} type="button" className={`company-item${company.id === props.selectedId ? " is-selected" : ""}`} onClick={() => choose(company.id)} aria-current={company.id === props.selectedId ? "true" : undefined}>
            <span className="company-item__content"><strong>{company.name}</strong><small>{hostname(company.website)}</small></span><StatusBadge status={company.status} />
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div className="mobile-company-switcher">
        <button ref={mobileTrigger} className="mobile-company-trigger" type="button" onClick={() => setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-label={mobileOpen ? t("accessibility.closeCompanies") : t("accessibility.openCompanies")}>
          <span><small>{t("companies.mobileSelector")}</small><strong>{selected?.name ?? t("companies.selectPrompt")}</strong></span>{selected && <StatusBadge status={selected.status} />}<span aria-hidden="true">⌄</span>
        </button>
      </div>
      <aside className={`company-sidebar${mobileOpen ? " is-open" : ""}`} aria-label={t("accessibility.companyNavigation")}>{content}</aside>
    </>
  );
}
