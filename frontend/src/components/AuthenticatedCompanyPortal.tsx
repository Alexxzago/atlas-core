import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import { authenticatedPortalReducer, canCreateCompany, initialAuthenticatedPortalState, initialWorkspace, isCurrentIntent,
  type ProfileMutationContext, type ProfileMutationOperation, type RequestContext } from "../state/authenticatedPortalState";
import type { AssistantProfile, AssistantProfileStatus, CompanyInput, CreateAssistantProfileInput, UpdateAssistantProfileInput, WorkspaceSummary } from "../types/api";
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

interface Props { csrf: string; email: string; onPassword: () => void; onLogout: () => void }

function aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

export function AuthenticatedCompanyPortal({ csrf, email, onPassword, onLogout }: Props): React.JSX.Element {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const [state, dispatch] = useReducer(authenticatedPortalReducer, initialAuthenticatedPortalState);
  const [routeCompanyValidation, setRouteCompanyValidation] = useState<CompanyRouteValidation>({ key: null, status: "idle" });
  const sequence = useRef(0);
  const workspaceSelectionIntent = useRef(0);
  const initialWorkspaceResolved = useRef(false);
  const companySelectionIntent = useRef(0);
  const workspaceAbort = useRef<AbortController | null>(null);
  const companiesAbort = useRef<AbortController | null>(null);
  const companyCreateAbort = useRef<AbortController | null>(null);
  const profilesAbort = useRef<AbortController | null>(null);
  const profileAbort = useRef<AbortController | null>(null);
  const mutationAbort = useRef<AbortController | null>(null);

  const nextRequest = (generation: number, workspaceId?: string, companyId?: number, profileId?: string): RequestContext => ({
    requestId: ++sequence.current, generation, ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(companyId === undefined ? {} : { companyId }), ...(profileId === undefined ? {} : { profileId }),
  });
  const nextMutation = (operation: ProfileMutationOperation, generation: number, workspaceId: string,
    companyId: number, profileId?: string): ProfileMutationContext => ({
    ...nextRequest(generation, workspaceId, companyId, profileId), operation,
  });
  const abortProfiles = (): void => { profilesAbort.current?.abort(); profileAbort.current?.abort(); mutationAbort.current?.abort(); };
  const abortTenant = (): void => {
    workspaceAbort.current?.abort(); companiesAbort.current?.abort(); companyCreateAbort.current?.abort(); abortProfiles();
    workspaceSelectionIntent.current = ++sequence.current; companySelectionIntent.current = ++sequence.current;
  };

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    try { dispatch({ type: "workspacesLoaded", workspaces: await atlasApi.listWorkspaces() }); }
    catch { dispatch({ type: "workspacesFailed" }); }
  }, []);

  useEffect(() => { void loadWorkspaces(); return () => abortTenant(); }, [loadWorkspaces]);

  const loadCompanies = async (workspace: WorkspaceSummary, generation: number): Promise<void> => {
    companiesAbort.current?.abort(); const controller = new AbortController(); companiesAbort.current = controller;
    const request = nextRequest(generation, workspace.id); dispatch({ type: "companiesLoadStarted", request });
    try { dispatch({ type: "companiesLoaded", request, companies: await atlasApi.listWorkspaceCompanies(workspace.id, controller.signal) }); }
    catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      dispatch(error instanceof ApiError && error.status === 404 ? { type: "companiesNotFound", request } : { type: "companiesLoadFailed", request });
    }
  };

  const selectWorkspace = async (workspaceId: string, navigateAfterSelection = false): Promise<void> => {
    abortTenant(); const request = nextRequest(state.workspaceGeneration + 1, workspaceId);
    workspaceSelectionIntent.current = request.requestId;
    const controller = new AbortController(); workspaceAbort.current = controller;
    dispatch({ type: "workspaceSelectionRequested", workspaceId, request });
    try {
      const workspace = await atlasApi.selectWorkspace(csrf, workspaceId, controller.signal);
      if (!isCurrentIntent(workspaceSelectionIntent.current, request.requestId)) return;
      dispatch({ type: "workspaceSelectionSucceeded", request, workspace });
      if (!isCurrentIntent(workspaceSelectionIntent.current, request.requestId)) return;
      if (navigateAfterSelection) navigate("/companies", { replace: true });
      await loadCompanies(workspace, request.generation);
      if (!isCurrentIntent(workspaceSelectionIntent.current, request.requestId)) return;
    } catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      dispatch({ type: "workspaceSelectionNotFound", request });
    }
  };

  useEffect(() => {
    if (state.workspacesLoading || state.workspaceError || initialWorkspaceResolved.current) return;
    initialWorkspaceResolved.current = true;
    void (async () => {
      let persisted: WorkspaceSummary | null = null;
      try { persisted = await atlasApi.selectedWorkspace(); } catch { /* The single-workspace fallback remains safe. */ }
      const workspace = initialWorkspace(state.workspaces, persisted);
      if (workspace) await selectWorkspace(workspace.id);
    })();
  }, [state.workspacesLoading, state.workspaceError, state.workspaces]);

  const loadProfiles = async (workspaceId: string, companyId: number, generation: number): Promise<void> => {
    profilesAbort.current?.abort(); const controller = new AbortController(); profilesAbort.current = controller;
    const request = nextRequest(generation, workspaceId, companyId); dispatch({ type: "profilesLoadStarted", request });
    try { dispatch({ type: "profilesLoaded", request, profiles: await atlasApi.listAssistantProfiles(workspaceId, companyId, controller.signal) }); }
    catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      dispatch(error instanceof ApiError && error.status === 404 ? { type: "profilesNotFound", request } : { type: "profilesLoadFailed", request });
    }
  };

  const selectCompany = async (companyId: number): Promise<boolean> => {
    const workspace = state.selectedWorkspace; if (!workspace) return false;
    abortProfiles(); dispatch({ type: "companySelected", companyId });
    const intentId = ++sequence.current; companySelectionIntent.current = intentId;
    const workspaceIntentId = workspaceSelectionIntent.current;
    const controller = new AbortController(); profileAbort.current = controller;
    try {
      await atlasApi.getWorkspaceCompany(workspace.id, companyId, controller.signal);
      if (!isCurrentIntent(companySelectionIntent.current, intentId)) return false;
      if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false;
      await loadProfiles(workspace.id, companyId, state.profileGeneration + 1);
      return true;
    } catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return false; }
      if (!isCurrentIntent(companySelectionIntent.current, intentId)) return false;
      if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false;
      if (error instanceof ApiError && error.status === 404) dispatch({ type: "companyNotFound" });
      else dispatch({ type: "noticeSet", noticeKey: "portal.companyLoadError" });
      return false;
    }
  };

  const createCompany = async (input: CompanyInput): Promise<boolean> => {
    const workspace = state.selectedWorkspace; if (!workspace) return false;
    companyCreateAbort.current?.abort(); const controller = new AbortController(); companyCreateAbort.current = controller;
    const request = nextRequest(state.workspaceGeneration, workspace.id);
    const workspaceIntentId = workspaceSelectionIntent.current;
    dispatch({ type: "companyCreateStarted", request });
    try {
      const company = await atlasApi.createWorkspaceCompany(csrf, workspace.id, input, controller.signal);
      if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false;
      dispatch({ type: "companyCreated", request, company });
      if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false;
      await loadCompanies(workspace, request.generation);
      return true;
    } catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return false; }
      if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false;
      dispatch(error instanceof ApiError && error.status === 404
        ? { type: "companyCreateNotFound", request } : { type: "companyCreateFailed", request });
      return false;
    }
  };

  const selectProfile = async (profileId: string): Promise<void> => {
    const workspace = state.selectedWorkspace, companyId = state.selectedCompanyId; if (!workspace || !companyId) return;
    profileAbort.current?.abort(); const controller = new AbortController(); profileAbort.current = controller;
    dispatch({ type: "profileSelected", profileId });
    const request = nextRequest(state.profileGeneration, workspace.id, companyId, profileId);
    dispatch({ type: "profileLoadStarted", request });
    try { dispatch({ type: "profileLoaded", request, profile: await atlasApi.getAssistantProfile(workspace.id, companyId, profileId, controller.signal) }); }
    catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      if (error instanceof ApiError && error.status === 404) dispatch({ type: "profileNotFound", request });
      else dispatch({ type: "profileLoadFailed", request });
    }
  };

  const reloadProfiles = useCallback((): void => {
    if (!state.selectedWorkspace || !state.selectedCompanyId) return;
    void loadProfiles(state.selectedWorkspace.id, state.selectedCompanyId, state.profileGeneration);
  }, [state.selectedWorkspace?.id, state.selectedCompanyId, state.profileGeneration]);

  useEffect(() => { if (state.profileReloadRequested) reloadProfiles(); }, [state.profileReloadRequested, reloadProfiles]);

  const refreshSelectedCompany = async (): Promise<void> => {
    const workspace = state.selectedWorkspace, companyId = state.selectedCompanyId;
    if (!workspace || !companyId) return;
    try {
      const company = await atlasApi.getWorkspaceCompany(workspace.id, companyId);
      dispatch({ type: "companyRefreshed", workspaceId: workspace.id, company });
    } catch {
      // The publication succeeded; leave the existing Company DTO intact if its follow-up read fails.
    }
  };

  const submitProfile = async (input: CreateAssistantProfileInput | UpdateAssistantProfileInput): Promise<void> => {
    const workspace = state.selectedWorkspace, companyId = state.selectedCompanyId; if (!workspace || !companyId) return;
    mutationAbort.current?.abort(); const controller = new AbortController(); mutationAbort.current = controller;
    const operation: ProfileMutationOperation = state.formMode === "create" ? "create" : "update";
    const request = nextMutation(operation, state.profileGeneration, workspace.id, companyId,
      operation === "update" ? state.selectedProfileId ?? undefined : undefined);
    dispatch({ type: "submissionStarted", request });
    try {
      if (state.formMode === "create") {
        const profile = await atlasApi.createAssistantProfile(csrf, workspace.id, companyId, input as CreateAssistantProfileInput, controller.signal);
        dispatch({ type: "profileCreated", request, profile });
      } else if (state.selectedProfileId) {
        const profile = await atlasApi.updateAssistantProfile(csrf, workspace.id, companyId, state.selectedProfileId, input, controller.signal);
        dispatch({ type: "profileUpdated", request, profile });
      }
    } catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      if (error instanceof ApiError && error.status === 404) dispatch(operation === "create" ? { type: "profileCreateNotFound", request } : { type: "profileMutationNotFound", request });
      else if (error instanceof ApiError && error.status === 409) dispatch({ type: "submissionFailed", request, noticeKey: operation === "create" ? "profiles.nameConflict" : "profiles.updateConflict" });
      else if (error instanceof ApiError && error.status === 400) dispatch({ type: "submissionFailed", request, noticeKey: "profiles.validationError" });
      else dispatch({ type: "submissionFailed", request, noticeKey: operation === "create" ? "profiles.createError" : "profiles.updateError" });
    }
  };

  const transitionProfile = async (profile: AssistantProfile, target: AssistantProfileStatus): Promise<void> => {
    const workspace = state.selectedWorkspace, companyId = state.selectedCompanyId; if (!workspace || !companyId) return;
    mutationAbort.current?.abort(); const controller = new AbortController(); mutationAbort.current = controller;
    const request = nextMutation("transition", state.profileGeneration, workspace.id, companyId, profile.id);
    dispatch({ type: "transitionStarted", request, target });
    try {
      dispatch({ type: "profileTransitioned", request, profile: await atlasApi.transitionAssistantProfile(csrf, workspace.id, companyId, profile.id, target, controller.signal) });
    } catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      if (error instanceof ApiError && error.status === 404) dispatch({ type: "profileMutationNotFound", request });
      else dispatch({ type: "transitionFailed", request, noticeKey: error instanceof ApiError && error.status === 409 ? "profiles.transitionConflict" : "profiles.transitionError" });
    }
  };

  const selectedProfile = useMemo(() => state.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null, [state.profiles, state.selectedProfileId]);
  const selectedCompany = useMemo(() => state.companies.find((company) => company.id === state.selectedCompanyId) ?? null, [state.companies, state.selectedCompanyId]);
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

  useEffect(() => {
    if (window.location.pathname === "/") navigate("/dashboard", { replace: true });
  }, [navigate]);

  const companySelector = <AuthenticatedCompanySelector companies={state.companies} selectedCompanyId={state.selectedCompanyId} workspaceSelected={canCreateCompany(state)} loading={state.companiesLoading} error={state.companyError} creating={state.companyCreating} onCreate={createCompany} onCompanySelected={(id) => navigate(`/companies/${id}`)} onRetry={() => { if (state.selectedWorkspace) void loadCompanies(state.selectedWorkspace, state.workspaceGeneration); }}/>;
  const companySubnav = requestedCompanyId && selectedCompany ? <CompanySubnav route={route} companyId={requestedCompanyId} onNavigate={navigate} /> : null;
  const assistantPanel = <AssistantProfilesPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} workspaceRole={state.selectedWorkspace?.role ?? null} capabilities={state.selectedWorkspace?.capabilities ?? []} companyId={state.selectedCompanyId} companyName={selectedCompany?.name ?? null} companySelected={state.selectedCompanyId !== null} profiles={state.profiles} selectedProfile={selectedProfile} transientArchivedProfile={state.transientArchivedProfile} loading={state.profilesLoading} error={state.profileError} formMode={state.formMode} submitting={state.submitting} transitionTarget={state.transitionTarget} onSelectProfile={(id) => void selectProfile(id)} onOpenCreate={() => dispatch({ type: "formOpened", mode: "create" })} onOpenEdit={() => dispatch({ type: "formOpened", mode: "edit" })} onCloseForm={() => dispatch({ type: "formClosed" })} onSubmitForm={(input) => void submitProfile(input)} onTransition={(profile, target) => void transitionProfile(profile, target)} onRetry={reloadProfiles}/>;
  const knowledgePanel = <CompanyKnowledgePanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} capabilities={state.selectedWorkspace?.capabilities ?? []} onPublicationCompleted={refreshSelectedCompany}/>;
  const whatsappPanel = <WhatsAppOnboardingPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} companyStatus={selectedCompany?.status ?? null} profiles={state.profiles} capabilities={state.selectedWorkspace?.capabilities ?? []}/>;
  const webChatPanel = <WebChatConnectionsPanel csrf={csrf} workspaceId={state.selectedWorkspace?.id ?? null} companyId={state.selectedCompanyId} companyStatus={selectedCompany?.status ?? null} profiles={state.profiles} capabilities={state.selectedWorkspace?.capabilities ?? []}/>;

  const routeContent = (): React.JSX.Element => {
    if (route.name === "dashboard") return <DashboardPage model={buildDashboardViewModel(state.selectedWorkspace, state.companies, selectedCompany)} onNavigate={navigate} />;
    if (route.name === "companies") return <><PageHeader title={t("shell.companiesTitle")} description={t("shell.companiesDescription")} />{companySelector}</>;
    if (route.name === "conversations") return <><PageHeader title={t("shell.conversationsTitle")} description={t("shell.conversationsDescription")} /><EmptyState title={t("shell.conversationsTitle")} description={t("shell.conversationsDescription")} /></>;
    if (route.name === "analytics") return <><PageHeader title={t("shell.analyticsTitle")} description={t("shell.analyticsDescription")} /><EmptyState title={t("shell.analyticsTitle")} description={t("shell.analyticsDescription")} /></>;
    if (route.name === "settings") return <><PageHeader title={t("shell.settingsTitle")} description={t("shell.settingsDescription")} /><WorkspaceMembershipPortal csrf={csrf} workspaces={state.workspaces} selectedWorkspace={state.selectedWorkspace} pendingWorkspaceId={state.pendingWorkspaceId} loading={state.workspacesLoading} error={state.workspaceError} onSelectWorkspace={(id) => void selectWorkspace(id, true)} onWorkspacesChanged={() => void loadWorkspaces()} onActiveWorkspaceLeft={() => { abortTenant(); dispatch({ type: "workspaceCleared" }); }}/></>;
    if (route.name === "company-overview") return <><PageHeader title={t("shell.companyOverviewTitle")} description={t("shell.companyOverviewDescription")} {...(selectedCompany ? { trail: selectedCompany.name } : {})} />{companySubnav}<EmptyState title={t("shell.companyOverviewTitle")} description={t("shell.companyOverviewDescription")} /></>;
    if (route.name === "company-assistant") return <><PageHeader title={t("shell.assistantTitle")} description={t("shell.assistantDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{assistantPanel}</>;
    if (route.name === "company-knowledge") return <><PageHeader title={t("shell.knowledgeTitle")} description={t("shell.knowledgeDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{knowledgePanel}</>;
    if (route.name === "company-channels") return <><PageHeader title={t("shell.channelsTitle")} description={t("shell.channelsDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{whatsappPanel}{webChatPanel}</>;
    if (route.name === "company-whatsapp") return <><PageHeader title={t("shell.whatsappTitle")} description={t("shell.whatsappDescription")} trail={selectedCompany?.name ?? ""} />{companySubnav}{whatsappPanel}</>;
    return <></>;
  };

  return <AppShell route={route} workspace={state.selectedWorkspace} workspaces={state.workspaces} companies={state.companies} selectedCompany={selectedCompany} email={email} onNavigate={navigate} onSelectWorkspace={(id) => void selectWorkspace(id, true)} onSelectCompany={(id) => navigate(`/companies/${id}`)} onPassword={onPassword} onLogout={onLogout}>
    {state.notice && <div className={`portal-notice inline-message inline-message--${state.notice.type}`} role={state.notice.type === "error" ? "alert" : "status"}>{t(state.notice.key as Parameters<typeof t>[0])}</div>}
    <RouteLoadingBoundary loading={state.workspacesLoading || state.pendingWorkspaceId !== null || routeCompanyState === "loading"}><RouteErrorBoundary active={route.name === "not-found" || routeCompanyState === "error"} onBack={() => navigate("/companies", { replace: true })}>{routeContent()}</RouteErrorBoundary></RouteLoadingBoundary>
  </AppShell>;
}
