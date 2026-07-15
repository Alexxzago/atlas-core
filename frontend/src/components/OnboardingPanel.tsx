import { useEffect, useState, type FormEvent } from "react";
import { atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { Company } from "../types/api";

interface Props {
  company: Company;
  onStart: (companyId: number) => void;
  onComplete: (company: Company) => void;
  onFailure: (companyId: number) => Promise<void>;
}

function validUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
}

export function OnboardingPanel({ company, onStart, onComplete, onFailure }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [url, setUrl] = useState(company.website);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  useEffect(() => { setUrl(company.website); setState("idle"); }, [company.id, company.website]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!validUrl(url)) { setState("error"); return; }
    setLoading(true); setState("idle"); onStart(company.id);
    try {
      const result = await atlasApi.onboardCompany(company.id, url.trim());
      const refreshed = await atlasApi.getCompany(result.companyId);
      onComplete(refreshed); setState("success");
    } catch {
      await onFailure(company.id);
      setState("error");
    }
    finally { setLoading(false); }
  };

  return (
    <section className="workspace-section" aria-labelledby="onboarding-title" aria-busy={loading}>
      <div className="section-heading"><div><h2 id="onboarding-title">{t("onboarding.title")}</h2><p>{t("onboarding.description")}</p></div></div>
      {loading && <div className="processing-panel" role="status"><span className="spinner" aria-hidden="true" /><div><strong>{t("onboarding.processingTitle")}</strong><p>{t("onboarding.processingDescription")}</p></div></div>}
      {!loading && <form className="onboarding-form" onSubmit={(event) => void submit(event)} noValidate><label className="form-field"><span>{t("companies.fields.website")}</span><input type="url" value={url} onChange={(event) => { setUrl(event.target.value); setState("idle"); }} aria-describedby="onboarding-help" required /><small id="onboarding-help">{t("onboarding.websiteHelp")}</small></label><div className="onboarding-actions"><button className="button button--primary">{company.status === "failed" ? t("onboarding.retry") : t("onboarding.start")}</button>{company.status === "ready" && <span className="supporting-copy">{t("onboarding.readyDescription")}</span>}</div></form>}
      {state === "success" && <p className="inline-message inline-message--success" role="status">{t("onboarding.success")}</p>}
      {state === "error" && <div className="inline-message inline-message--error" role="alert"><strong>{validUrl(url) ? t("onboarding.error") : t("onboarding.invalidUrl")}</strong></div>}
    </section>
  );
}
