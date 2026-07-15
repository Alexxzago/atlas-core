import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyInput } from "../types/api";

interface Props {
  onCreate: (input: CompanyInput) => Promise<Company>;
  onClose: () => void;
}

function isValidUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
}

export function CompanyCreateForm({ onCreate, onClose }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim()) { setError(t("companies.validation.name")); return; }
    if (!isValidUrl(website)) { setError(t("companies.validation.website")); return; }
    setSubmitting(true); setError(null);
    try {
      const input: CompanyInput = { name: name.trim(), website: website.trim() };
      if (phone.trim()) input.phone = phone.trim();
      if (email.trim()) input.email = email.trim();
      await onCreate(input);
      onClose();
    } catch { setError(t("companies.operationError")); }
    finally { setSubmitting(false); }
  };

  return (
    <form className="sidebar-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="section-heading"><h2>{t("companies.createTitle")}</h2><button className="button button--quiet button--compact" type="button" onClick={onClose}>{t("common.close")}</button></div>
      <label className="form-field"><span>{t("companies.fields.name")}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("companies.placeholders.name")} required /></label>
      <label className="form-field"><span>{t("companies.fields.website")}</span><input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder={t("companies.placeholders.website")} required /></label>
      <label className="form-field"><span>{t("companies.fields.phone")} <small>{t("common.optional")}</small></span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t("companies.placeholders.phone")} /></label>
      <label className="form-field"><span>{t("companies.fields.email")} <small>{t("common.optional")}</small></span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("companies.placeholders.email")} /></label>
      {error && <p className="inline-message inline-message--error" role="alert">{error}</p>}
      <button className="button button--primary button--full" disabled={submitting}>{submitting ? t("common.saving") : t("companies.create")}</button>
    </form>
  );
}
