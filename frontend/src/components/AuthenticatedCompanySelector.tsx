import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyInput } from "../types/api";

interface Props {
  companies: Company[];
  selectedCompanyId: number | null;
  workspaceSelected: boolean;
  loading: boolean;
  error: boolean;
  creating: boolean;
  onCreate: (input: CompanyInput) => Promise<boolean>;
  onCompanySelected: (companyId: number) => void;
  onRetry: () => void;
}

export function AuthenticatedCompanySelector(props: Props): React.JSX.Element {
  const { t } = useI18n();
  const create = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const created = await props.onCreate({ name: String(data.get("name") ?? ""), website: String(data.get("website") ?? "") });
    if (created) form.reset();
  };
  return <section className="authenticated-section company-context" aria-busy={props.loading}>
    <div className="section-heading"><div><h2>{t("portal.companiesTitle")}</h2><p>{t("portal.companiesDescription")}</p></div></div>
    {!props.workspaceSelected && <p className="state-copy">{t("portal.workspaceRequired")}</p>}
    {props.workspaceSelected && <form className="authenticated-company-create" onSubmit={(event) => void create(event)} aria-busy={props.creating}>
      <h3>{t("companies.createTitle")}</h3>
      <fieldset disabled={props.creating}>
        <label className="form-field"><span>{t("companies.fields.name")}</span><input name="name" required placeholder={t("companies.placeholders.name")} /></label>
        <label className="form-field"><span>{t("companies.fields.website")}</span><input name="website" type="url" required placeholder={t("companies.placeholders.website")} /></label>
        <button className="button button--primary">{props.creating ? t("common.saving") : t("companies.create")}</button>
      </fieldset>
    </form>}
    {props.workspaceSelected && props.loading && <p role="status">{t("portal.companiesLoading")}</p>}
    {props.workspaceSelected && props.error && <div className="inline-message inline-message--error" role="alert"><p>{t("portal.companiesError")}</p><button className="button button--secondary" type="button" onClick={props.onRetry}>{t("common.retry")}</button></div>}
    {props.workspaceSelected && !props.loading && !props.error && props.companies.length === 0 && <p className="state-copy">{t("portal.companiesEmpty")}</p>}
    {props.companies.length > 0 && <label className="form-field" htmlFor="authenticated-company-selector">
      <span>{t("portal.companySelect")}</span>
      <select id="authenticated-company-selector" value={props.selectedCompanyId ?? ""} onChange={(event) => { if (event.target.value) props.onCompanySelected(Number(event.target.value)); }}>
        <option value="">{t("portal.companyNone")}</option>
        {props.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
    </label>}
  </section>;
}
