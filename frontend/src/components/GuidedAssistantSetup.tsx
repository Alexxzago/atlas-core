import { useEffect, useRef, useState } from "react";
import { Button, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import { useRouter } from "../routing/RouterProvider";
import { useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import { useAuthentication } from "../state/AuthenticationContext";
import { WebsiteKnowledgeStep } from "./WebsiteKnowledgeStep";
import { ActivationPending } from "./ActivationPending";

type WorkspaceStep = "welcome" | "company" | "preferences";

export function GuidedAssistantSetup(): React.JSX.Element {
  const { locale, t } = useI18n(); const { navigate } = useRouter(); const { state: auth } = useAuthentication();
  const { selectedWorkspace, selectedCompany, createWorkspace, createOnboardingCompany } = useAuthenticatedPortal();
  const [step, setStep] = useState<WorkspaceStep>("welcome"), [companyName, setCompanyName] = useState(""), [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), [businessLocale, setBusinessLocale] = useState<"en" | "es">(locale), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [activationPending, setActivationPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step, selectedWorkspace?.id]);
  if (activationPending) return <ActivationPending />;
  if (selectedWorkspace && selectedCompany && auth.status === "authenticated") return <WebsiteKnowledgeStep csrf={auth.csrfToken} workspaceId={selectedWorkspace.id} companyId={selectedCompany.id} onContinue={() => setActivationPending(true)} />;
  const companyStep = selectedWorkspace !== null;
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setError(null);
    if (!companyStep && step === "welcome") { setStep("company"); return; }
    if (!companyStep && step === "company") { setStep("preferences"); return; }
    setLoading(true);
    const completed = companyStep ? await createOnboardingCompany(companyName.trim()) : await createWorkspace(companyName.trim(), timezone, businessLocale);
    setLoading(false);
    if (!completed) { setError(t("assistantSetup.error.unavailable")); return; }
    navigate(companyStep ? "/onboarding/company" : "/onboarding/company", { replace: true });
  };
  const title = companyStep ? "assistantSetup.company.title" : step === "welcome" ? "assistantSetup.welcome.title" : step === "company" ? "assistantSetup.company.title" : "assistantSetup.preferences.title";
  const description = companyStep ? "assistantSetup.company.description" : step === "welcome" ? "assistantSetup.welcome.description" : step === "company" ? "assistantSetup.company.description" : "assistantSetup.preferences.description";
  return <Surface className="guided-registration" key={`${companyStep}-${step}`} tone="raised"><form onSubmit={(event) => void submit(event)}><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t(title)}</h1><p aria-live="polite">{t(description)}</p>{(companyStep || step === "company") && <label>{t("assistantSetup.company.field")}<input autoFocus autoComplete="organization" required name="companyName" value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>}{!companyStep && step === "preferences" && <><label>{t("assistantSetup.preferences.locale")}<select value={businessLocale} onChange={(event) => setBusinessLocale(event.target.value as "en" | "es")}><option value="en">{t("language.en")}</option><option value="es">{t("language.es")}</option></select></label><label>{t("assistantSetup.preferences.timezone")}<input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label></>}{error && <p role="alert">{error}</p>}<Button type="submit" disabled={loading}>{t(loading ? "assistantSetup.loading" : "assistantSetup.continue")}</Button></Stack></form></Surface>;
}
