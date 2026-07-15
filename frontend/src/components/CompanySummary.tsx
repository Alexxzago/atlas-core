import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyUpdate } from "../types/api";
import { StatusBadge } from "./StatusBadge";

interface Props {
  company: Company;
  onUpdate: (input: CompanyUpdate) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function CompanySummary({ company, onUpdate, onDelete }: Props): React.JSX.Element {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ name: company.name, website: company.website, phone: company.phone, email: company.email });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try { await onUpdate(form); setEditing(false); setMessage({ type: "success", text: t("companies.updateSuccess") }); }
    catch { setMessage({ type: "error", text: t("companies.operationError") }); }
    finally { setBusy(false); }
  };

  const remove = async (): Promise<void> => {
    setBusy(true); setMessage(null);
    try { await onDelete(); }
    catch { setMessage({ type: "error", text: t("companies.deleteError") }); setBusy(false); setConfirmingDelete(false); }
  };

  return (
    <section className="workspace-section company-summary" aria-labelledby="company-title">
      <div className="workspace-title-row"><div><h1 id="company-title">{company.name}</h1><a href={company.website} target="_blank" rel="noreferrer">{company.website}<span className="sr-only"> ({t("accessibility.externalLink")})</span></a></div><StatusBadge status={company.status} /></div>
      {!editing && <>
        <dl className="company-details"><div><dt>{t("companies.fields.phone")}</dt><dd>{company.phone || t("workspace.contactMissing")}</dd></div><div><dt>{t("companies.fields.email")}</dt><dd>{company.email || t("workspace.contactMissing")}</dd></div><div><dt>{t("companies.fields.createdAt")}</dt><dd>{formatDate(company.createdAt)}</dd></div></dl>
        <div className="action-row"><button className="button button--secondary" type="button" onClick={() => { setForm({ name: company.name, website: company.website, phone: company.phone, email: company.email }); setEditing(true); }}>{t("common.edit")}</button><button className="button button--danger-quiet" type="button" onClick={() => setConfirmingDelete(true)}>{t("common.delete")}</button></div>
      </>}
      {editing && <form className="edit-form" onSubmit={(event) => void submit(event)}><h2>{t("workspace.editTitle")}</h2><div className="form-grid"><label className="form-field"><span>{t("companies.fields.name")}</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label><label className="form-field"><span>{t("companies.fields.website")}</span><input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} required /></label><label className="form-field"><span>{t("companies.fields.phone")}</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label><label className="form-field"><span>{t("companies.fields.email")}</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label></div><div className="action-row"><button className="button button--primary" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button><button className="button button--secondary" type="button" onClick={() => setEditing(false)}>{t("common.cancel")}</button></div></form>}
      {confirmingDelete && <div className="confirm-panel" role="group" aria-labelledby="delete-title"><h2 id="delete-title">{t("companies.deleteTitle")}</h2><p>{t("companies.deletePrompt", { companyName: company.name })}</p><div className="action-row"><button className="button button--danger" disabled={busy} onClick={() => void remove()}>{t("common.confirm")}</button><button className="button button--secondary" type="button" disabled={busy} onClick={() => setConfirmingDelete(false)}>{t("common.cancel")}</button></div></div>}
      {message && <p className={`inline-message inline-message--${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</p>}
    </section>
  );
}
