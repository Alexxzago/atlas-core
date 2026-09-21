import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyInput } from "../types/api";
import { Field } from "../design-system/Field";
import { Alert, Button, Input, LoadingState } from "../design-system/primitives";

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
    <div ref={dialog} className="ds-dialog company-chooser" role="dialog" aria-modal="true" aria-labelledby="company-chooser-title">
      <header className="company-chooser__header"><div className="company-chooser__heading"><p className="company-chooser__eyebrow eyebrow">{t("companyChooser.eyebrow")}</p><h2 className="company-chooser__title" id="company-chooser-title">{props.companies.length === 0 ? t("companyChooser.firstTitle") : t("companyChooser.title")}</h2><p className="company-chooser__subtitle">{props.companies.length === 0 ? t("companyChooser.firstDescription") : t("companyChooser.description")}</p></div><Button ref={closeButton} className="company-chooser__close" size="sm" variant="quiet" aria-label={t("common.close")} onClick={props.onClose}>×</Button></header>
      {!props.workspaceSelected && <Alert tone="warning">{t("portal.workspaceRequired")}</Alert>}
      {props.loading && <LoadingState title={t("companyChooser.loading")}/>}
      {props.error && <Alert tone="danger">{t("companyChooser.error")}<Button variant="secondary" onClick={props.onRetry}>{t("common.retry")}</Button></Alert>}
      {!props.loading && !props.error && props.companies.length > 0 && <div className="company-chooser__list" aria-label={t("companyChooser.available")}>
        {current && <div className="company-chooser__group"><p>{t("companyChooser.current")}</p><CompanyChoice company={current} current onChoose={() => props.onCompanySelected(current.id)} /></div>}
        <div className="company-chooser__group"><p>{current ? t("companyChooser.other") : t("companyChooser.available")}</p>{props.companies.filter((company) => company.id !== current?.id).map((company) => <CompanyChoice company={company} key={company.id} onChoose={() => props.onCompanySelected(company.id)} />)}</div>
      </div>}
      {props.workspaceSelected && !showCreate && <Button className="company-chooser__create-trigger" variant={props.companies.length === 0 ? "primary" : "quiet"} onClick={() => setShowCreate(true)}>{props.companies.length === 0 ? t("companyChooser.createFirst") : t("companyChooser.createAnother")}</Button>}
      {props.workspaceSelected && showCreate && <form className="company-chooser__create" onSubmit={(event) => void submit(event)} aria-busy={props.creating}><h3>{t("companyChooser.createTitle")}</h3><p>{t("companyChooser.createDescription")}</p><fieldset disabled={props.creating}><Field id="company-chooser-name" label={t("companies.fields.name")}><Input autoFocus id="company-chooser-name" name="name" placeholder={t("companies.placeholders.name")} required /></Field><Field id="company-chooser-website" label={`${t("companies.fields.website")} (${t("common.optional")})`}><Input id="company-chooser-website" name="website" placeholder={t("companies.placeholders.website")} type="url" /></Field><div className="action-row"><Button type="submit">{props.creating ? t("common.saving") : t("companyChooser.create")}</Button><Button type="button" variant="quiet" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button></div></fieldset></form>}
    </div>
  </div>;
}

function CompanyChoice({ company, current = false, onChoose }: { readonly company: Company; readonly current?: boolean; readonly onChoose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return <Button className="company-choice" variant="quiet" aria-current={current ? "true" : undefined} onClick={onChoose}><span><strong>{company.name}</strong><small>{company.website || t("companies.unknownWebsite")}</small></span>{current && <span className="company-choice__current">{t("companyChooser.selected")}</span>}</Button>;
}
