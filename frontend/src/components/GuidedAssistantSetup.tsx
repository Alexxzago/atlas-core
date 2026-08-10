import { useState } from "react";
import { Alert, Button, Input, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import { useRouter } from "../routing/RouterProvider";
import { useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import { Callout, ProductHero } from "../design-system/product";
import { ProgressIndicator } from "../design-system/feedback";

export function GuidedAssistantSetup(): React.JSX.Element {
  const { locale, t } = useI18n(); const { navigate } = useRouter();
  const { state, selectedWorkspace, createWorkspace, createOnboardingCompany, selectWorkspace } = useAuthenticatedPortal();
  const [name, setName] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const waitingForSoleWorkspace = !selectedWorkspace && state.workspaces.length === 1 && !creatingWorkspace;
  const selectingWorkspace = !selectedWorkspace && state.workspaces.length > 1 && !creatingWorkspace;
  const companyStep = selectedWorkspace !== null;
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setError(null);
    setLoading(true);
    const completed = companyStep ? await createOnboardingCompany(name.trim()) : await createWorkspace(name.trim(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", locale);
    setLoading(false);
    if (!completed) { setError(t("assistantSetup.error.unavailable")); return; }
    if (companyStep) {
      navigate(`/companies/${completed}`, { replace: true });
      return;
    }
    navigate("/onboarding/company", { replace: true });
  };
  if (waitingForSoleWorkspace) return <Surface tone="raised"><ProgressIndicator label={t("assistantSetup.loading")}/></Surface>;
  if (selectingWorkspace) return <Surface tone="raised"><Stack gap="5"><ProductHero eyebrow={t("guided.workspace.title")} title={t("assistantSetup.workspaceSelection.title")} description={t("assistantSetup.workspaceSelection.description")}/><div role="list"><Stack gap="3">{state.workspaces.map((workspace) => <Button key={workspace.id} variant="secondary" onClick={() => void selectWorkspace(workspace.id)}>{workspace.name}</Button>)}</Stack></div><Callout tone="info" title={t("assistantSetup.workspaceSelection.newTitle")}><p>{t("assistantSetup.workspaceSelection.newDescription")}</p><Button variant="quiet" onClick={() => setCreatingWorkspace(true)}>{t("assistantSetup.workspaceSelection.newAction")}</Button></Callout></Stack></Surface>;
  const title=companyStep?"assistantSetup.company.title":"assistantSetup.welcome.title",description=companyStep?"assistantSetup.company.description":"assistantSetup.welcome.description",field=companyStep?"assistantSetup.company.field":"assistantSetup.workspace.field";
  return <Surface className="guided-workspace-card" padding="7" tone="raised"><form onSubmit={(event)=>void submit(event)}><Stack gap="6"><ProductHero title={t(title)} description={t(description)}/><label className="form-field"><span>{t(field)}</span><Input autoFocus autoComplete="organization" required value={name} onChange={event=>setName(event.target.value)}/></label>{error&&<Alert tone="danger">{error}</Alert>}<Button type="submit" disabled={loading}>{t(loading?"assistantSetup.loading":"assistantSetup.continue")}</Button>{creatingWorkspace&&<Button variant="quiet" onClick={()=>setCreatingWorkspace(false)}>{t("common.back")}</Button>}</Stack></form></Surface>;
}
