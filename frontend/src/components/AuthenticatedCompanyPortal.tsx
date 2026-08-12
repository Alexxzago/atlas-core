import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { AuthenticatedPortalProvider, useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import { AssistantProfilesPanel } from "./AssistantProfilesPanel";
import { WorkspaceMembershipPortal } from "./WorkspaceMembershipPortal";
import { ContextBackLink } from "./ContextBackLink";
import { CompanyKnowledgePanel } from "./CompanyKnowledgePanel";
import { WebChatConnectionsPanel } from "./WebChatConnectionsPanel";
import { WhatsAppOnboardingPanel } from "./WhatsAppOnboardingPanel";
import { AppShell, PageHeader } from "./AppShell";
import { RouteErrorBoundary, RouteLoadingBoundary } from "./RouteBoundaries";
import { EmptyState } from "../design-system/feedback";
import { routeCompanyId } from "../routing/routes";
import { companyRouteKey, companyRoutePresentation, type CompanyRouteValidation } from "../routing/companyRoutePresentation";
import { DashboardPage } from "../dashboard/DashboardPage";
import { buildCompanyWorkspaceViewModel } from "../dashboard/dashboardPresentation";
import { useRouter } from "../routing/RouterProvider";
import { ConversationInbox } from "./ConversationInbox";
import { CompanySetupChecklist } from "./CompanySetupChecklist";
import { ChannelHub } from "./ChannelHub";
import { onboardingProgressPath, resolveAuthenticatedOnboardingProgress } from "../routing/onboardingProgress";
import { StartupState } from "./StartupState";

interface Props { csrf: string; userId?: string | undefined; email: string; isPlatformAdmin?: boolean; onPassword: () => void; onLogout: () => void }

export function AuthenticatedCompanyPortal({ csrf, userId, email, isPlatformAdmin, onPassword, onLogout }: Props): React.JSX.Element {
  return <AuthenticatedPortalProvider csrf={csrf}><AuthenticatedCompanyPortalContent csrf={csrf} userId={userId} email={email} isPlatformAdmin={isPlatformAdmin ?? false} onPassword={onPassword} onLogout={onLogout} /></AuthenticatedPortalProvider>;
}

function AuthenticatedCompanyPortalContent({ csrf, userId, email, isPlatformAdmin, onPassword, onLogout }: Props): React.JSX.Element {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const [routeCompanyValidation, setRouteCompanyValidation] = useState<CompanyRouteValidation>({ key: null, status: "idle" });
  const [autoSelectingCompanyId, setAutoSelectingCompanyId] = useState<number | null>(null);
  const { state, selectedCompany, selectWorkspace, selectCompany, createCompany, refresh, refreshCompanies, refreshSelectedCompany,
    clearWorkspace, selectProfile, reloadProfiles, submitProfile, transitionProfile, clearNotice, openProfileForm, closeProfileForm } = useAuthenticatedPortal();

  const selectedProfile = useMemo(() => state.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null, [state.profiles, state.selectedProfileId]);
  const requestedCompanyId = routeCompanyId(route);
  const routeCompanyState = companyRoutePresentation(state.selectedWorkspace?.id ?? null, requestedCompanyId, state.selectedCompanyId, state.profilesLoading, routeCompanyValidation);
  const progress = resolveAuthenticatedOnboardingProgress({ workspacesLoading: state.workspacesLoading, workspaceError: state.workspaceError, initialWorkspaceResolved: state.initialWorkspaceResolved, pendingWorkspaceId: state.pendingWorkspaceId, selectedWorkspaceId: state.selectedWorkspace?.id ?? null, workspaceCount: state.workspaces.length, companiesLoading: state.companiesLoading, companyError: state.companyError, companies: state.companies });
  const onboardingRedirect = onboardingProgressPath(progress);
  const companyAutoSelecting = autoSelectingCompanyId !== null || (!requestedCompanyId && !!state.selectedWorkspace && !state.companiesLoading && !state.companyError && state.selectedCompanyId === null && state.companies.length === 1);

  useEffect(() => { if (onboardingRedirect) navigate(onboardingRedirect, { replace: true }); }, [navigate, onboardingRedirect]);

  useEffect(() => {
    if (!requestedCompanyId || !state.selectedWorkspace || state.companiesLoading) {
      setRouteCompanyValidation({ key: null, status: "idle" });
      return;
    }
    let current = true;
    const key = companyRouteKey(state.selectedWorkspace.id, requestedCompanyId);
    if (state.selectedCompanyId === requestedCompanyId) {
      setRouteCompanyValidation({ key, status: "ready" });
      return () => { current = false; };
    }
    setRouteCompanyValidation({ key, status: "loading" });
    void selectCompany(requestedCompanyId).then((selected) => {
      if (current) setRouteCompanyValidation({ key, status: selected ? "ready" : "error" });
    });
    return () => { current = false; };
  }, [requestedCompanyId, state.selectedWorkspace?.id, state.companiesLoading, state.selectedCompanyId]);

  useEffect(() => {
    if (requestedCompanyId || !state.selectedWorkspace || state.companiesLoading || state.companyError || state.selectedCompanyId !== null || state.companies.length !== 1) return;
    const companyId = state.companies[0]!.id;
    setAutoSelectingCompanyId(companyId);
    void selectCompany(companyId).then((selected) => { if (selected) navigate(`/companies/${companyId}`, { replace: true }); }).finally(() => setAutoSelectingCompanyId(null));
  }, [requestedCompanyId, state.selectedWorkspace?.id, state.companiesLoading, state.companyError, state.selectedCompanyId, state.companies]);

  useEffect(() => {
    if (state.notice?.type !== "success") return;
    const timeout = window.setTimeout(clearNotice, 4_000);
    return () => window.clearTimeout(timeout);
  }, [state.notice, clearNotice]);

  const assistantPanel = <AssistantProfilesPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} workspaceRole={state.selectedWorkspace?.role ?? null} capabilities={state.selectedWorkspace?.capabilities ?? []} companyId={state.selectedCompanyId} companyName={selectedCompany?.name ?? null} companySelected={state.selectedCompanyId !== null} profiles={state.profiles} selectedProfile={selectedProfile} transientArchivedProfile={state.transientArchivedProfile} loading={state.profilesLoading} error={state.profileError} formMode={state.formMode} submitting={state.submitting} transitionTarget={state.transitionTarget} onSelectProfile={(id) => void selectProfile(id)} onOpenCreate={() => openProfileForm("create")} onOpenEdit={() => openProfileForm("edit")} onCloseForm={closeProfileForm} onSubmitForm={(input) => void submitProfile(input)} onTransition={(profile, target) => void transitionProfile(profile, target)} onRetry={reloadProfiles}/>;
  const knowledgePanel = <CompanyKnowledgePanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} capabilities={state.selectedWorkspace?.capabilities ?? []} onPublicationCompleted={refreshSelectedCompany}/>;
  const whatsappPanel = <WhatsAppOnboardingPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} profiles={state.profiles} capabilities={state.selectedWorkspace?.capabilities ?? []}/>;
  const webChatPanel = <WebChatConnectionsPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} companyStatus={selectedCompany?.status ?? null} profiles={state.profiles} capabilities={state.selectedWorkspace?.capabilities ?? []} onNavigate={navigate}/>;

  const routeContent = (): React.JSX.Element => {
    if (route.name === "dashboard" || route.name === "company-overview") {
      if (state.selectedWorkspace && selectedCompany) return <CompanySetupChecklist workspace={state.selectedWorkspace} companies={state.companies} company={selectedCompany} onNavigate={navigate} onChooseCompany={() => navigate("/companies")}/>;
      return <DashboardPage model={buildCompanyWorkspaceViewModel({ workspace: state.selectedWorkspace, companies: state.companies, company: null, companiesLoading: state.companiesLoading, companiesUnavailable: state.companyError })} onNavigate={navigate} onRetry={refreshCompanies} onChooseCompany={() => navigate("/companies")}/>;
    }
    if (route.name === "companies") return <DashboardPage model={buildCompanyWorkspaceViewModel({ workspace: state.selectedWorkspace, companies: state.companies, company: null, companiesLoading: state.companiesLoading, companiesUnavailable: state.companyError })} onNavigate={navigate} onRetry={refreshCompanies} onChooseCompany={() => {}}/>;
    if (route.name === "conversations") return <ConversationInbox csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} capabilities={state.selectedWorkspace?.capabilities ?? []}/>;
    if (route.name === "analytics") return <><PageHeader title={t("shell.analyticsTitle")} description={t("shell.analyticsDescription")} /><EmptyState title={t("shell.analyticsTitle")} description={t("shell.analyticsDescription")} /></>;
    if (route.name === "settings") return <WorkspaceMembershipPortal csrf={csrf} currentUserId={userId} currentUserEmail={email} workspaces={state.workspaces} selectedWorkspace={state.selectedWorkspace} pendingWorkspaceId={state.pendingWorkspaceId} loading={state.workspacesLoading} error={state.workspaceError} onSelectWorkspace={(id) => { void selectWorkspace(id).then((selected) => { if (selected) navigate("/companies", { replace: true }); }); }} onWorkspacesChanged={() => void refresh()} onActiveWorkspaceLeft={clearWorkspace}/>;
    if (route.name === "company-assistant") return assistantPanel;
    if (route.name === "company-knowledge") return knowledgePanel;
    if (route.name === "company-channels") return <>{requestedCompanyId && <ChannelHub companyId={requestedCompanyId} onNavigate={navigate}/>}</>;
    if (route.name === "company-web-chat") return <><ContextBackLink href={`/companies/${requestedCompanyId}/channels`} label={t("channels.back")} onNavigate={(event)=>{event.preventDefault();navigate(`/companies/${requestedCompanyId}/channels`);}}/>{webChatPanel}</>;
    if (route.name === "company-whatsapp") return whatsappPanel;
    return <></>;
  };

  if (onboardingRedirect) return <StartupState />;
  return <AppShell route={route} workspace={state.selectedWorkspace} workspaces={state.workspaces} companies={state.companies} selectedCompany={selectedCompany} companiesLoading={state.companiesLoading || companyAutoSelecting} companyError={state.companyError} companyCreating={state.companyCreating} companyTransitioning={routeCompanyState === "loading" || companyAutoSelecting} companyAutoSelecting={companyAutoSelecting} email={email} isPlatformAdmin={isPlatformAdmin ?? false} onNavigate={navigate} onSelectWorkspace={(id) => { void selectWorkspace(id).then((selected) => { if (selected) navigate("/companies", { replace: true }); }); }} onSelectCompany={(id) => navigate(`/companies/${id}`)} onCreateCompany={createCompany} onRetryCompanies={refreshCompanies} onPassword={onPassword} onLogout={onLogout}>
    {state.notice && <div className={`portal-notice inline-message inline-message--${state.notice.type}`} role={state.notice.type === "error" ? "alert" : "status"}><span>{t(state.notice.key as Parameters<typeof t>[0])}</span>{state.notice.type === "success" && <button className="button button--quiet button--compact" type="button" onClick={clearNotice}>{t("common.close")}</button>}</div>}
    <RouteLoadingBoundary loading={state.workspacesLoading || state.pendingWorkspaceId !== null || companyAutoSelecting || routeCompanyState === "loading"}><RouteErrorBoundary active={route.name === "not-found" || routeCompanyState === "error"} onBack={() => navigate("/companies", { replace: true })}>{routeContent()}</RouteErrorBoundary></RouteLoadingBoundary>
  </AppShell>;
}
