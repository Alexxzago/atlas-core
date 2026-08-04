import { useEffect, useRef, useState } from "react";
import { Button, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import { useRouter } from "../routing/RouterProvider";
import { useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import { useAuthentication } from "../state/AuthenticationContext";
import { WebsiteKnowledgeStep } from "./WebsiteKnowledgeStep";
import { ActivationPending } from "./ActivationPending";

export function GuidedAssistantSetup(): React.JSX.Element {
  const { locale, t } = useI18n(); const { navigate } = useRouter(); const { state: auth } = useAuthentication();
  const { selectedWorkspace, selectedCompany, createWorkspace, createOnboardingCompany } = useAuthenticatedPortal();
  const [name, setName] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [activationPending, setActivationPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [selectedWorkspace?.id]);
  if (activationPending) return <ActivationPending />;
  if (selectedWorkspace && selectedCompany && auth.status === "authenticated") return <WebsiteKnowledgeStep csrf={auth.csrfToken} workspaceId={selectedWorkspace.id} companyId={selectedCompany.id} onContinue={() => setActivationPending(true)} />;
  const companyStep = selectedWorkspace !== null;
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setError(null);
    setLoading(true);
    const completed = companyStep ? await createOnboardingCompany(name.trim()) : await createWorkspace(name.trim(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", locale);
    setLoading(false);
    if (!completed) { setError(t("assistantSetup.error.unavailable")); return; }
    navigate(companyStep ? "/onboarding/company" : "/onboarding/company", { replace: true });
  };
  const title=companyStep?"assistantSetup.company.title":"assistantSetup.welcome.title",description=companyStep?"assistantSetup.company.description":"assistantSetup.welcome.description",field=companyStep?"assistantSetup.company.field":"guided.workspace.title";
  return <Surface className="guided-registration" key={String(companyStep)} tone="raised"><form onSubmit={(event)=>void submit(event)}><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t(title)}</h1><p aria-live="polite">{t(description)}</p><label>{t(field)}<input autoFocus autoComplete="organization" required value={name} onChange={event=>setName(event.target.value)}/></label>{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={loading}>{t(loading?"assistantSetup.loading":companyStep?"guided.company.title":"guided.workspace.title")}</Button></Stack></form></Surface>;
}
