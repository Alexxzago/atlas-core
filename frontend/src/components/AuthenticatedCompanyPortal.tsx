import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { AuthenticatedPortalProvider, useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import { AssistantProfilesPanel } from "./AssistantProfilesPanel";
import { AuthenticatedCompanySelector } from "./AuthenticatedCompanySelector";
import { WorkspaceMembershipPortal } from "./WorkspaceMembershipPortal";
import { CompanyKnowledgePanel } from "./CompanyKnowledgePanel";
import { WebChatConnectionsPanel } from "./WebChatConnectionsPanel";
import { WhatsAppOnboardingPanel } from "./WhatsAppOnboardingPanel";
import { AppShell, CompanySubnav, PageHeader } from "./AppShell";
import { RouteErrorBoundary, RouteLoadingBoundary } from "./RouteBoundaries";
import { EmptyState } from "../design-system/feedback";
import { routeCompanyId } from "../routing/routes";
import { companyRouteKey, companyRoutePresentation, type CompanyRouteValidation } from "../routing/companyRoutePresentation";
import { DashboardPage } from "../dashboard/DashboardPage";
import { buildDashboardViewModel } from "../dashboard/dashboardPresentation";
import { useRouter } from "../routing/RouterProvider";
import { ConversationInbox } from "./ConversationInbox";

interface Props { csrf: string; email: string; onPassword: () => void; onLogout: () => void }

export function AuthenticatedCompanyPortal({ csrf, email, onPassword, onLogout }: Props): React.JSX.Element {
  return <AuthenticatedPortalProvider csrf={csrf}><AuthenticatedCompanyPortalContent csrf={csrf} email={email} onPassword={onPassword} onLogout={onLogout} /></AuthenticatedPortalProvider>;
}

function AuthenticatedCompanyPortalContent({ csrf, email, onPassword, onLogout }: Props): React.JSX.Element {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const [routeCompanyValidation, setRouteCompanyValidation] = useState<CompanyRouteValidation>({ key: null, status: "idle" });
  const { state, selectedCompany, selectWorkspace, selectCompany, createCompany, refresh, refreshCompanies, refreshSelectedCompany,
    clearWorkspace, selectProfile, reloadProfiles, submitProfile, transitionProfile, openProfileForm, closeProfileForm } = useAuthenticatedPortal();

  const selectedProfile = useMemo(() => state.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null, [state.profiles, state.selectedProfileId]);
  const requestedCompanyId = routeCompanyId(route);
  const routeCompanyState = companyRoutePresentation(state.selectedWorkspace?.id ?? null, requestedCompanyId, state.selectedCompanyId, state.profilesLoading, routeCompanyValidation);

  useEffect(() => {
    if (!requestedCompanyId || !state.selectedWorkspace) {
      setRouteCompanyValidation({ key: null, status: "idle" });
      return;
    }
    let current = true;
    const key = companyRouteKey(state.selectedWorkspace.id, requestedCompanyId);
    setRouteCompanyValidation({ key, status: "loading" });
    void selectCompany(requestedCompanyId).then((selected) => {
      if (current) setRouteCompanyValidation({ key, status: selected ? "ready" : "error" });
    });
    return () => { current = false; };
  }, [requestedCompanyId, state.selectedWorkspace?.id]);

  const companySelector = <AuthenticatedCompanySelector companies={state.companies} selectedCompanyId={state.selectedCompanyId} workspaceSelected={state.selectedWorkspace !== null} loading={state.companiesLoading} error={state.companyError} creating={state.companyCreating} onCreate={createCompany} onCompanySelected={(id) => navigate(`/companies/${id}`)} onRetry={refreshCompanies}/>;
  const companySubnav = requestedCompanyId && selectedCompany ? <CompanySubnav route={route} companyId={requestedCompanyId} onNavigate={navigate} /> : null;
  const assistantPanel = <AssistantProfilesPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} workspaceRole={state.selectedWorkspace?.role ?? null} capabilities={state.selectedWorkspace?.capabilities ?? []} companyId={state.selectedCompanyId} companyName={selectedCompany?.name ?? null} companySelected={state.selectedCompanyId !== null} profiles={state.profiles} selectedProfile={selectedProfile} transientArchivedProfile={state.transientArchivedProfile} loading={state.profilesLoading} error={state.profileError} formMode={state.formMode} submitting={state.submitting} transitionTarget={state.transitionTarget} onSelectProfile={(id) => void selectProfile(id)} onOpenCreate={() => openProfileForm("create")} onOpenEdit={() => openProfileForm("edit")} onCloseForm={closeProfileForm} onSubmitForm={(input) => void submitProfile(input)} onTransition={(profile, target) => void transitionProfile(profile, target)} onRetry={reloadProfiles}/>;
  const knowledgePanel = <CompanyKnowledgePanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} capabilities={state.selectedWorkspace?.capabilities ?? []} onPublicationCompleted={refreshSelectedCompany}/>;
  const whatsappPanel = <WhatsAppOnboardingPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} profiles={state.profiles} capabilities={state.selectedWorkspace?.capabilities ?? []}/>;
  const webChatPanel = <WebChatConnectionsPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} companyStatus={selectedCompany?.status ?? null} profiles={state.profiles} capabilities={state.selectedWorkspace?.capabilities ?? []}/>;

  const routeContent = (): React.JSX.Element => {
    if (route.name === "dashboard") return <DashboardPage model={buildDashboardViewModel(state.selectedWorkspace, state.companies, selectedCompany)} onNavigate={navigate} />;
    if (route.name === "companies") return <><PageHeader title={t("shell.companiesTitle")} description={t("shell.companiesDescription")} />{companySelector}</>;
    if (route.name === "conversations") return <><PageHeader title={t("shell.conversationsTitle")} description={t("shell.conversationsDescription")} /><ConversationInbox csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} capabilities={state.selectedWorkspace?.capabilities ?? []}/></>;
    if (route.name === "analytics") return <><PageHeader title={t("shell.analyticsTitle")} description={t("shell.analyticsDescription")} /><EmptyState title={t("shell.analyticsTitle")} description={t("shell.analyticsDescription")} /></>;
    if (route.name === "settings") return <><PageHeader title={t("shell.settingsTitle")} description={t("shell.settingsDescription")} /><WorkspaceMembershipPortal csrf={csrf} workspaces={state.workspaces} selectedWorkspace={state.selectedWorkspace} pendingWorkspaceId={state.pendingWorkspaceId} loading={state.workspacesLoading} error={state.workspaceError} onSelectWorkspace={(id) => { void selectWorkspace(id).then((selected) => { if (selected) navigate("/companies", { replace: true }); }); }} onWorkspacesChanged={() => void refresh()} onActiveWorkspaceLeft={clearWorkspace}/></>;
    if (route.name === "company-overview") return <><PageHeader title={t("shell.companyOverviewTitle")} description={t("shell.companyOverviewDescription")} {...(selectedCompany ? { trail: selectedCompany.name } : {})} />{companySubnav}<EmptyState title={t("shell.companyOverviewTitle")} description={t("shell.companyOverviewDescription")} /></>;
    if (route.name === "company-assistant") return <><PageHeader title={t("shell.assistantTitle")} description={t("shell.assistantDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{assistantPanel}</>;
    if (route.name === "company-knowledge") return <><PageHeader title={t("shell.knowledgeTitle")} description={t("shell.knowledgeDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{knowledgePanel}</>;
    if (route.name === "company-channels") return <><PageHeader title={t("shell.channelsTitle")} description={t("shell.channelsDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{whatsappPanel}{webChatPanel}</>;
    if (route.name === "company-whatsapp") return <><PageHeader title={t("shell.whatsappTitle")} description={t("shell.whatsappDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{whatsappPanel}</>;
    return <></>;
  };

  return <AppShell route={route} workspace={state.selectedWorkspace} workspaces={state.workspaces} companies={state.companies} selectedCompany={selectedCompany} email={email} onNavigate={navigate} onSelectWorkspace={(id) => { void selectWorkspace(id).then((selected) => { if (selected) navigate("/companies", { replace: true }); }); }} onSelectCompany={(id) => navigate(`/companies/${id}`)} onPassword={onPassword} onLogout={onLogout}>
    {state.notice && <div className={`portal-notice inline-message inline-message--${state.notice.type}`} role={state.notice.type === "error" ? "alert" : "status"}>{t(state.notice.key as Parameters<typeof t>[0])}</div>}
    <RouteLoadingBoundary loading={state.workspacesLoading || state.pendingWorkspaceId !== null || routeCompanyState === "loading"}><RouteErrorBoundary active={route.name === "not-found" || routeCompanyState === "error"} onBack={() => navigate("/companies", { replace: true })}>{routeContent()}</RouteErrorBoundary></RouteLoadingBoundary>
  </AppShell>;
}
