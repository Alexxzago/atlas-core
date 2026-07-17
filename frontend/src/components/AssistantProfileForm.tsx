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
  const set = <K extends keyof AssistantProfileFormValues>(key: K, value: AssistantProfileFormValues[K]): void => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent): void => {
    event.preventDefault(); setError(null);
    if (!values.name.trim() || !values.assistantLanguage) { setError(t("profiles.validationRequired")); return; }
    if (mode === "edit" && !values.fallbackMessage.trim()) { setError(t("profiles.validationFallback")); return; }
    onSubmit(buildAssistantProfileInput(values, mode));
  };
  const field = (key: keyof AssistantProfileFormValues): string => `${prefix}-${key}`;
  const errorId = `${prefix}-error`;
  return <form className="assistant-form" onSubmit={submit} aria-busy={submitting} noValidate>
    <h3>{t(mode === "create" ? "profiles.createTitle" : "profiles.editTitle")}</h3>
    <fieldset className="assistant-form-fields" disabled={submitting}>
    <div className="assistant-form-grid">
      <label className="form-field" htmlFor={field("name")}><span>{t("profiles.field.name")}</span><input autoFocus id={field("name")} value={values.name} maxLength={80} required aria-invalid={error ? "true" : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => set("name", event.target.value)} /></label>
      <label className="form-field" htmlFor={field("assistantLanguage")}><span>{t("profiles.field.language")}</span><select id={field("assistantLanguage")} required value={values.assistantLanguage} aria-invalid={error ? "true" : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => set("assistantLanguage", event.target.value as AssistantLanguage)}><option value="">{t("profiles.languageSelect")}</option><option value="es">{t("language.es")}</option><option value="en">{t("language.en")}</option></select></label>
      <label className="form-field assistant-form-wide" htmlFor={field("description")}><span>{t("profiles.field.description")} <small>{t("common.optional")}</small></span><textarea id={field("description")} maxLength={240} value={values.description} onChange={(event) => set("description", event.target.value)} /></label>
      <label className="form-field" htmlFor={field("businessRole")}><span>{t("profiles.field.businessRole")} <small>{t("common.optional")}</small></span><input id={field("businessRole")} maxLength={120} value={values.businessRole} onChange={(event) => set("businessRole", event.target.value)} /></label>
      <label className="form-field" htmlFor={field("tone")}><span>{t("profiles.field.tone")}</span><select id={field("tone")} value={values.tone} onChange={(event) => set("tone", event.target.value as AssistantTone)}>{(["professional", "friendly", "concise", "empathetic"] as const).map((tone) => <option key={tone} value={tone}>{t(`profiles.tone.${tone}`)}</option>)}</select></label>
      <label className="form-field assistant-form-wide" htmlFor={field("objective")}><span>{t("profiles.field.objective")} <small>{t("common.optional")}</small></span><textarea id={field("objective")} maxLength={500} value={values.objective} onChange={(event) => set("objective", event.target.value)} /></label>
      <label className="form-field assistant-form-wide" htmlFor={field("audience")}><span>{t("profiles.field.audience")} <small>{t("common.optional")}</small></span><textarea id={field("audience")} maxLength={300} value={values.audience} onChange={(event) => set("audience", event.target.value)} /></label>
      <label className="form-field assistant-form-wide" htmlFor={field("welcomeMessage")}><span>{t("profiles.field.welcomeMessage")} <small>{t("common.optional")}</small></span><textarea id={field("welcomeMessage")} maxLength={500} value={values.welcomeMessage} onChange={(event) => set("welcomeMessage", event.target.value)} /></label>
      <label className="form-field assistant-form-wide" htmlFor={field("fallbackMessage")}><span>{t("profiles.field.fallbackMessage")} {mode === "create" && <small>{t("common.optional")}</small>}</span><textarea id={field("fallbackMessage")} maxLength={500} required={mode === "edit"} value={values.fallbackMessage} onChange={(event) => set("fallbackMessage", event.target.value)} /></label>
    </div>
    </fieldset>
    {error && <p id={errorId} className="inline-message inline-message--error" role="alert">{error}</p>}
    <div className="action-row"><button className="button button--primary" disabled={submitting}>{submitting ? t("common.saving") : t("common.save")}</button><button className="button button--secondary" type="button" disabled={submitting} onClick={onCancel}>{t("common.cancel")}</button></div>
  </form>;
}
