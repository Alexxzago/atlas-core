import { useId, useState, type FormEvent } from "react";
import { useI18n } from "../i18n/I18nContext";
import { buildAssistantProfileInput, type AssistantProfileFormValues } from "../state/authenticatedPortalState";
import type { AssistantLanguage, AssistantProfile, AssistantTone, CreateAssistantProfileInput, UpdateAssistantProfileInput } from "../types/api";

interface Props {
  mode: "create" | "edit";
  profile?: AssistantProfile;
  submitting: boolean;
  onSubmit: (input: CreateAssistantProfileInput | UpdateAssistantProfileInput) => void;
  onCancel: () => void;
}

function initial(profile?: AssistantProfile): AssistantProfileFormValues {
  return { name: profile?.name ?? "", assistantLanguage: profile?.assistantLanguage ?? "",
    description: profile?.description ?? "", businessRole: profile?.businessRole ?? "",
    objective: profile?.objective ?? "", audience: profile?.audience ?? "", tone: profile?.tone ?? "professional",
    welcomeMessage: profile?.welcomeMessage ?? "", fallbackMessage: profile?.fallbackMessage ?? "" };
}

export function AssistantProfileForm({ mode, profile, submitting, onSubmit, onCancel }: Props): React.JSX.Element {
  const { t } = useI18n(); const prefix = useId();
  const [values, setValues] = useState<AssistantProfileFormValues>(() => initial(profile));
  const [error, setError] = useState<string | null>(null);
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const set = <K extends keyof AssistantProfileFormValues>(key: K, value: AssistantProfileFormValues[K]): void => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent): void => {
    event.preventDefault(); setError(null);
    if (!values.name.trim() || !values.assistantLanguage) { setError(t("profiles.validationRequired")); return; }
    if (mode === "edit" && !values.fallbackMessage.trim()) { setMessagesOpen(true); setError(t("profiles.validationFallback")); return; }
    onSubmit(buildAssistantProfileInput(values, mode));
  };
  const field = (key: keyof AssistantProfileFormValues): string => `${prefix}-${key}`;
  const errorId = `${prefix}-error`;
  const disclosure = (id: string, title: string, description: string, open: boolean, toggle: () => void, children: React.ReactNode): React.JSX.Element => <section className="assistant-form-section assistant-form-section--disclosure">
    <button className="assistant-form-disclosure" type="button" aria-expanded={open} aria-controls={id} onClick={toggle}><span><strong>{title}</strong><small>{description}</small></span><span aria-hidden="true">{open ? "−" : "+"}</span></button>
    {open && <div className="assistant-form-grid" id={id}>{children}</div>}
  </section>;

  return <form className="assistant-form" onSubmit={submit} aria-busy={submitting} noValidate>
    <fieldset className="assistant-form-fields" disabled={submitting}>
      <section className="assistant-form-section">
        <div className="assistant-form-section__heading"><h3>{t("profiles.form.identity")}</h3><p>{t("profiles.form.identityDescription")}</p></div>
        <div className="assistant-form-grid">
          <label className="form-field" htmlFor={field("name")}><span className="form-field__label">{t("profiles.field.name")}</span><input autoFocus id={field("name")} value={values.name} maxLength={80} required aria-invalid={error ? "true" : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => set("name", event.target.value)} /></label>
          <label className="form-field" htmlFor={field("assistantLanguage")}><span className="form-field__label">{t("profiles.field.language")}</span><select id={field("assistantLanguage")} required value={values.assistantLanguage} aria-invalid={error ? "true" : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => set("assistantLanguage", event.target.value as AssistantLanguage)}><option value="">{t("profiles.languageSelect")}</option><option value="es">{t("language.es")}</option><option value="en">{t("language.en")}</option></select></label>
          <label className="form-field assistant-form-wide" htmlFor={field("businessRole")}><span className="form-field__label">{t("profiles.field.businessRole")}</span><input id={field("businessRole")} maxLength={120} value={values.businessRole} onChange={(event) => set("businessRole", event.target.value)} /></label>
        </div>
      </section>
      <section className="assistant-form-section assistant-form-section--optional">
        <div className="assistant-form-section__heading"><h3>{t("profiles.form.communication")}</h3><p>{t("profiles.form.optionalDescription")}</p></div>
        <div className="assistant-form-grid">
          <label className="form-field" htmlFor={field("tone")}><span className="form-field__label">{t("profiles.field.tone")}</span><select id={field("tone")} value={values.tone} onChange={(event) => set("tone", event.target.value as AssistantTone)}>{(["professional", "friendly", "concise", "empathetic"] as const).map((tone) => <option key={tone} value={tone}>{t(`profiles.tone.${tone}`)}</option>)}</select></label>
          <label className="form-field assistant-form-wide" htmlFor={field("description")}><span className="form-field__label">{t("profiles.field.description")}</span><textarea id={field("description")} maxLength={240} value={values.description} onChange={(event) => set("description", event.target.value)} /></label>
        </div>
      </section>
      {disclosure(`${prefix}-purpose`, t("profiles.form.purpose"), t("profiles.form.optionalDescription"), purposeOpen, () => setPurposeOpen((open) => !open), <>
        <label className="form-field assistant-form-wide" htmlFor={field("objective")}><span className="form-field__label">{t("profiles.field.objective")}</span><textarea id={field("objective")} maxLength={500} value={values.objective} onChange={(event) => set("objective", event.target.value)} /></label>
        <label className="form-field assistant-form-wide" htmlFor={field("audience")}><span className="form-field__label">{t("profiles.field.audience")}</span><textarea id={field("audience")} maxLength={300} value={values.audience} onChange={(event) => set("audience", event.target.value)} /></label>
      </>)}
      {disclosure(`${prefix}-messages`, t("profiles.form.messages"), mode === "edit" ? t("profiles.form.messagesEditDescription") : t("profiles.form.optionalDescription"), messagesOpen, () => setMessagesOpen((open) => !open), <>
        <label className="form-field assistant-form-wide" htmlFor={field("welcomeMessage")}><span className="form-field__label">{t("profiles.field.welcomeMessage")}</span><textarea id={field("welcomeMessage")} maxLength={500} value={values.welcomeMessage} onChange={(event) => set("welcomeMessage", event.target.value)} /></label>
        <label className="form-field assistant-form-wide" htmlFor={field("fallbackMessage")}><span className="form-field__label">{t("profiles.field.fallbackMessage")}</span><textarea id={field("fallbackMessage")} maxLength={500} required={mode === "edit"} value={values.fallbackMessage} onChange={(event) => set("fallbackMessage", event.target.value)} /></label>
      </>)}
    </fieldset>
    {error && <p id={errorId} className="inline-message inline-message--error" role="alert">{error}</p>}
    <div className="assistant-form-actions"><p className="assistant-form-required-hint">{t("profiles.form.requiredHint")}</p><div className="action-row"><button className="button button--primary" disabled={submitting}>{submitting ? t("common.saving") : t("profiles.save")}</button><button className="button button--secondary" type="button" disabled={submitting} onClick={onCancel}>{t("common.cancel")}</button></div></div>
  </form>;
}
