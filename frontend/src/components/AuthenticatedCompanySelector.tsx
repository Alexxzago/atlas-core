import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyInput } from "../types/api";

interface Props {
  readonly open: boolean;
  readonly companies: readonly Company[];
  readonly selectedCompanyId: number | null;
  readonly workspaceSelected: boolean;
  readonly loading: boolean;
  readonly error: boolean;
  readonly creating: boolean;
  readonly onCreate: (input: CompanyInput) => Promise<boolean>;
  readonly onCompanySelected: (companyId: number) => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

export function AuthenticatedCompanySelector(props: Props): React.JSX.Element | null {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) { setShowCreate(false); return; }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButton.current?.focus(), 0);
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]');
      if (!focusable?.length) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); document.body.style.overflow = previousOverflow; };
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  const current = props.companies.find((company) => company.id === props.selectedCompanyId) ?? null;
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form), website = String(data.get("website") ?? "").trim();
    const created = await props.onCreate({ name: String(data.get("name") ?? "").trim(), website: website || null });
    if (created) { form.reset(); setShowCreate(false); }
  };

  return <div className="company-chooser-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <div ref={dialog} className="company-chooser" role="dialog" aria-modal="true" aria-labelledby="company-chooser-title">
      <header className="company-chooser__header"><div><p className="eyebrow">{t("companyChooser.eyebrow")}</p><h2 id="company-chooser-title">{props.companies.length === 0 ? t("companyChooser.firstTitle") : t("companyChooser.title")}</h2><p>{props.companies.length === 0 ? t("companyChooser.firstDescription") : t("companyChooser.description")}</p></div><button ref={closeButton} className="atlas-icon-button" type="button" aria-label={t("common.close")} onClick={props.onClose}>×</button></header>
      {!props.workspaceSelected && <p className="inline-message inline-message--warning">{t("portal.workspaceRequired")}</p>}
      {props.loading && <p className="company-chooser__state" role="status">{t("companyChooser.loading")}</p>}
      {props.error && <div className="inline-message inline-message--error" role="alert"><p>{t("companyChooser.error")}</p><button className="button button--secondary" type="button" onClick={props.onRetry}>{t("common.retry")}</button></div>}
      {!props.loading && !props.error && props.companies.length > 0 && <div className="company-chooser__list" aria-label={t("companyChooser.available")}>
        {current && <div className="company-chooser__group"><p>{t("companyChooser.current")}</p><CompanyChoice company={current} current onChoose={() => props.onCompanySelected(current.id)} /></div>}
        <div className="company-chooser__group"><p>{current ? t("companyChooser.other") : t("companyChooser.available")}</p>{props.companies.filter((company) => company.id !== current?.id).map((company) => <CompanyChoice company={company} key={company.id} onChoose={() => props.onCompanySelected(company.id)} />)}</div>
      </div>}
      {props.workspaceSelected && !showCreate && <button className={props.companies.length === 0 ? "button button--primary" : "button button--quiet company-chooser__create-trigger"} type="button" onClick={() => setShowCreate(true)}>{props.companies.length === 0 ? t("companyChooser.createFirst") : t("companyChooser.createAnother")}</button>}
      {props.workspaceSelected && showCreate && <form className="company-chooser__create" onSubmit={(event) => void submit(event)} aria-busy={props.creating}><h3>{t("companyChooser.createTitle")}</h3><p>{t("companyChooser.createDescription")}</p><fieldset disabled={props.creating}><label className="form-field"><span>{t("companies.fields.name")}</span><input name="name" required autoFocus placeholder={t("companies.placeholders.name")} /></label><label className="form-field"><span>{t("companies.fields.website")} <small>{t("common.optional")}</small></span><input name="website" type="url" placeholder={t("companies.placeholders.website")} /></label><div className="action-row"><button className="button button--primary">{props.creating ? t("common.saving") : t("companyChooser.create")}</button><button className="button button--quiet" type="button" onClick={() => setShowCreate(false)}>{t("common.cancel")}</button></div></fieldset></form>}
    </div>
  </div>;
}

function CompanyChoice({ company, current = false, onChoose }: { readonly company: Company; readonly current?: boolean; readonly onChoose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return <button className="company-choice" type="button" aria-current={current ? "true" : undefined} onClick={onChoose}><span><strong>{company.name}</strong><small>{company.website || t("companies.unknownWebsite")}</small></span>{current && <span className="company-choice__current">{t("companyChooser.selected")}</span>}</button>;
}
