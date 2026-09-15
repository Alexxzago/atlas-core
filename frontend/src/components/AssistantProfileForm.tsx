import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../i18n/I18nContext";
import { buildAssistantProfileInput, type AssistantProfileFormValues } from "../state/authenticatedPortalState";
import type { AssistantLanguage, AssistantProfile, AssistantTone, CreateAssistantProfileInput, UpdateAssistantProfileInput } from "../types/api";

interface Props {
  mode: "create" | "edit";
  profile?: AssistantProfile;
  submitting: boolean;
  onSubmit: (input: CreateAssistantProfileInput | UpdateAssistantProfileInput) => Promise<AssistantProfile | null> | void;
  onCancel: () => void;
  section?: "general" | "behavior" | "capabilities";
}

type Step = "identity" | "response" | "purpose" | "messages";
const steps: readonly { id: Step; title: string; description: string }[] = [
  { id: "identity", title: "Identity", description: "Name, language and role" },
  { id: "response", title: "How it responds", description: "Tone and guidance" },
  { id: "purpose", title: "Role and goal", description: "Objective and audience" },
  { id: "messages", title: "Messages and help", description: "Welcome and fallback" },
];

function initial(profile?: AssistantProfile): AssistantProfileFormValues {
  return { name: profile?.name ?? "", assistantLanguage: profile?.assistantLanguage ?? "", description: profile?.description ?? "", businessRole: profile?.businessRole ?? "", objective: profile?.objective ?? "", audience: profile?.audience ?? "", tone: profile?.tone ?? "professional", welcomeMessage: profile?.welcomeMessage ?? "", fallbackMessage: profile?.fallbackMessage ?? "" };
}

function completedSteps(values: AssistantProfileFormValues, persisted: boolean): ReadonlySet<Step> {
  const completed = new Set<Step>();
  if (values.name.trim() && values.assistantLanguage) completed.add("identity");
  // These groups contain optional fields. Their completion follows the persisted profile, never local progress.
  if (persisted) { completed.add("response"); completed.add("purpose"); }
  if (persisted && values.fallbackMessage.trim()) completed.add("messages");
  return completed;
}

export function AssistantProfileForm({ mode, profile, submitting, onSubmit, onCancel, section }: Props): React.JSX.Element {
  const { t } = useI18n(); const prefix = useId();
  const [values, setValues] = useState<AssistantProfileFormValues>(() => initial(profile));
  const [step, setStep] = useState<Step>(() => section === "behavior" ? "response" : profile?.fallbackMessage ? "messages" : "identity");
  const [advanceAfterSave, setAdvanceAfterSave] = useState(false);
  const profileId = useRef(profile?.id);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AssistantProfileFormValues>(key: K, value: AssistantProfileFormValues[K]): void => setValues((current) => ({ ...current, [key]: value }));
  const field = (key: keyof AssistantProfileFormValues): string => `${prefix}-${key}`;
  const currentIndex = steps.findIndex((item) => item.id === step);
  const persisted = profile !== undefined;
  useEffect(() => { if (profile?.id && profile.id !== profileId.current) { profileId.current = profile.id; setValues(initial(profile)); } }, [profile]);
  useEffect(() => { if (advanceAfterSave && !submitting && profile && currentIndex < steps.length - 1) { setStep(steps[currentIndex + 1]!.id); setAdvanceAfterSave(false); } }, [advanceAfterSave, currentIndex, profile, submitting]);
  const completed = completedSteps(values, persisted);
  const validateCurrent = (): boolean => {
    setError(null);
    if (step === "identity" && (!values.name.trim() || !values.assistantLanguage)) { setError(t("profiles.validationRequired")); return false; }
    if (step === "messages" && mode === "edit" && !values.fallbackMessage.trim()) { setError(t("profiles.validationFallback")); return false; }
    return true;
  };
  const save = async (advance: boolean): Promise<void> => {
    if (!validateCurrent()) return;
    if (advance) setAdvanceAfterSave(true);
    const saved = await onSubmit(buildAssistantProfileInput(values, mode));
    if (saved && advance && currentIndex < steps.length - 1) { setStep(steps[currentIndex + 1]!.id); setAdvanceAfterSave(false); }
    if (!saved && !advance) setAdvanceAfterSave(false);
  };
  const submit = (event: FormEvent): void => { event.preventDefault(); void save(false); };
  const current = steps[currentIndex]!;

  return <form className="assistant-form assistant-form--stepper" onSubmit={submit} aria-busy={submitting} noValidate>
    <ol className="assistant-stepper" aria-label="Assistant setup progress">{steps.map((item, index) => {
      const state = item.id === step ? "current" : completed.has(item.id) ? "completed" : "pending";
      return <li key={item.id} className={`assistant-stepper__step is-${state}`}><button type="button" disabled={submitting} aria-current={state === "current" ? "step" : undefined} onClick={() => setStep(item.id)}><span aria-hidden="true">{state === "completed" ? "✓" : index + 1}</span><span>{item.title}</span></button></li>;
    })}</ol>
    <fieldset className="assistant-form-fields" disabled={submitting}>
      <section className="assistant-form-section">
        <div className="assistant-form-section__heading"><h3>{current.title}</h3><p>{current.description}</p></div>
        {step === "identity" && <div className="assistant-form-grid"><label className="form-field" htmlFor={field("name")}><span className="form-field__label">{t("profiles.field.name")}</span><input autoFocus id={field("name")} value={values.name} maxLength={80} required aria-invalid={error ? "true" : undefined} onChange={(event) => set("name", event.target.value)} /></label><label className="form-field" htmlFor={field("assistantLanguage")}><span className="form-field__label">{t("profiles.field.language")}</span><select id={field("assistantLanguage")} required value={values.assistantLanguage} aria-invalid={error ? "true" : undefined} onChange={(event) => set("assistantLanguage", event.target.value as AssistantLanguage)}><option value="">{t("profiles.languageSelect")}</option><option value="es">{t("language.es")}</option><option value="en">{t("language.en")}</option></select></label><label className="form-field assistant-form-wide" htmlFor={field("businessRole")}><span className="form-field__label">{t("profiles.field.businessRole")}</span><input id={field("businessRole")} maxLength={120} value={values.businessRole} onChange={(event) => set("businessRole", event.target.value)} /></label></div>}
        {step === "response" && <div className="assistant-form-grid"><label className="form-field" htmlFor={field("tone")}><span className="form-field__label">{t("profiles.field.tone")}</span><select id={field("tone")} value={values.tone} onChange={(event) => set("tone", event.target.value as AssistantTone)}>{(["professional", "friendly", "concise", "empathetic"] as const).map((tone) => <option key={tone} value={tone}>{t(`profiles.tone.${tone}`)}</option>)}</select></label><label className="form-field" htmlFor={field("description")}><span className="form-field__label">{t("profiles.field.description")}</span><textarea id={field("description")} maxLength={240} value={values.description} onChange={(event) => set("description", event.target.value)} /></label></div>}
        {step === "purpose" && <div className="assistant-form-grid"><label className="form-field" htmlFor={field("objective")}><span className="form-field__label">{t("profiles.field.objective")}</span><textarea id={field("objective")} maxLength={500} value={values.objective} onChange={(event) => set("objective", event.target.value)} /></label><label className="form-field" htmlFor={field("audience")}><span className="form-field__label">{t("profiles.field.audience")}</span><textarea id={field("audience")} maxLength={300} value={values.audience} onChange={(event) => set("audience", event.target.value)} /></label></div>}
        {step === "messages" && <div className="assistant-form-grid"><label className="form-field" htmlFor={field("welcomeMessage")}><span className="form-field__label">{t("profiles.field.welcomeMessage")}</span><textarea id={field("welcomeMessage")} maxLength={500} value={values.welcomeMessage} onChange={(event) => set("welcomeMessage", event.target.value)} /></label><label className="form-field" htmlFor={field("fallbackMessage")}><span className="form-field__label">{t("profiles.field.fallbackMessage")}</span><textarea id={field("fallbackMessage")} maxLength={500} required={mode === "edit"} value={values.fallbackMessage} onChange={(event) => set("fallbackMessage", event.target.value)} /></label></div>}
      </section>
    </fieldset>
    {error && <p className="inline-message inline-message--error" role="alert">{error}</p>}
    <div className="assistant-form-actions"><div className="action-row">{currentIndex > 0 && <button className="button button--secondary" type="button" disabled={submitting} onClick={() => setStep(steps[currentIndex - 1]!.id)}>Back</button>}<button className="button button--secondary" disabled={submitting}>{submitting ? t("common.saving") : t("profiles.save")}</button><button className="button button--primary" type="button" disabled={submitting || currentIndex === steps.length - 1} onClick={() => void save(true)}>Save and continue</button></div><button className="button button--quiet" type="button" disabled={submitting} onClick={onCancel}>{t("common.cancel")}</button></div>
  </form>;
}
