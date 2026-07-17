import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import { authenticatedPortalReducer, canCreateCompany, initialAuthenticatedPortalState, isCurrentIntent,
  type ProfileMutationContext, type ProfileMutationOperation, type RequestContext } from "../state/authenticatedPortalState";
import type { AssistantProfile, AssistantProfileStatus, CompanyInput, CreateAssistantProfileInput, UpdateAssistantProfileInput, WorkspaceSummary } from "../types/api";
import { AssistantProfilesPanel } from "./AssistantProfilesPanel";
import { AuthenticatedCompanySelector } from "./AuthenticatedCompanySelector";
import { PortalHeader } from "./PortalHeader";
import { WorkspaceMembershipPortal } from "./WorkspaceMembershipPortal";

interface Props { csrf: string; email: string; onPassword: () => void; onLogout: () => void }

function aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

export function AuthenticatedCompanyPortal({ csrf, email, onPassword, onLogout }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(authenticatedPortalReducer, initialAuthenticatedPortalState);
  const sequence = useRef(0);
  const workspaceSelectionIntent = useRef(0);
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

  const selectWorkspace = async (workspaceId: string): Promise<void> => {
    abortTenant(); const request = nextRequest(state.workspaceGeneration + 1, workspaceId);
    workspaceSelectionIntent.current = request.requestId;
    const controller = new AbortController(); workspaceAbort.current = controller;
    dispatch({ type: "workspaceSelectionRequested", workspaceId, request });
    try {
      const workspace = await atlasApi.selectWorkspace(csrf, workspaceId, controller.signal);
      if (!isCurrentIntent(workspaceSelectionIntent.current, request.requestId)) return;
      dispatch({ type: "workspaceSelectionSucceeded", request, workspace });
      if (!isCurrentIntent(workspaceSelectionIntent.current, request.requestId)) return;
      await loadCompanies(workspace, request.generation);
    } catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      dispatch({ type: "workspaceSelectionNotFound", request });
    }
  };

  const loadProfiles = async (workspaceId: string, companyId: number, generation: number): Promise<void> => {
    profilesAbort.current?.abort(); const controller = new AbortController(); profilesAbort.current = controller;
    const request = nextRequest(generation, workspaceId, companyId); dispatch({ type: "profilesLoadStarted", request });
    try { dispatch({ type: "profilesLoaded", request, profiles: await atlasApi.listAssistantProfiles(workspaceId, companyId, controller.signal) }); }
    catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      dispatch(error instanceof ApiError && error.status === 404 ? { type: "profilesNotFound", request } : { type: "profilesLoadFailed", request });
    }
  };

  const selectCompany = async (companyId: number): Promise<void> => {
    const workspace = state.selectedWorkspace; if (!workspace) return;
    abortProfiles(); dispatch({ type: "companySelected", companyId });
    const intentId = ++sequence.current; companySelectionIntent.current = intentId;
    const workspaceIntentId = workspaceSelectionIntent.current;
    const controller = new AbortController(); profileAbort.current = controller;
    try {
      await atlasApi.getWorkspaceCompany(workspace.id, companyId, controller.signal);
      if (!isCurrentIntent(companySelectionIntent.current, intentId)) return;
      if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return;
      await loadProfiles(workspace.id, companyId, state.profileGeneration + 1);
    } catch (error: unknown) {
      if (aborted(error)) { dispatch({ type: "requestAborted" }); return; }
      if (!isCurrentIntent(companySelectionIntent.current, intentId)) return;
      if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return;
      if (error instanceof ApiError && error.status === 404) dispatch({ type: "companyNotFound" });
      else dispatch({ type: "noticeSet", noticeKey: "portal.companyLoadError" });
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

  return <div className="authenticated-portal">
    <PortalHeader />
    <div className="authenticated-account"><span>{email}</span><button className="button button--quiet" onClick={onPassword}>{t("portal.password")}</button><button className="button button--secondary" onClick={onLogout}>{t("portal.logout")}</button></div>
    {state.notice && <div className={`portal-notice inline-message inline-message--${state.notice.type}`} role={state.notice.type === "error" ? "alert" : "status"}>{t(state.notice.key as Parameters<typeof t>[0])}</div>}
    <main className="authenticated-main">
      <WorkspaceMembershipPortal csrf={csrf} workspaces={state.workspaces} selectedWorkspace={state.selectedWorkspace} pendingWorkspaceId={state.pendingWorkspaceId} loading={state.workspacesLoading} error={state.workspaceError} onSelectWorkspace={(id) => void selectWorkspace(id)} onWorkspacesChanged={() => void loadWorkspaces()} onActiveWorkspaceLeft={() => { abortTenant(); dispatch({ type: "workspaceCleared" }); }}/>
      <AuthenticatedCompanySelector companies={state.companies} selectedCompanyId={state.selectedCompanyId} workspaceSelected={canCreateCompany(state)} loading={state.companiesLoading} error={state.companyError} creating={state.companyCreating} onCreate={createCompany} onCompanySelected={(id) => void selectCompany(id)} onRetry={() => { if (state.selectedWorkspace) void loadCompanies(state.selectedWorkspace, state.workspaceGeneration); }}/>
      <AssistantProfilesPanel companySelected={state.selectedCompanyId !== null} profiles={state.profiles} selectedProfile={selectedProfile} transientArchivedProfile={state.transientArchivedProfile} loading={state.profilesLoading} error={state.profileError} formMode={state.formMode} submitting={state.submitting} transitionTarget={state.transitionTarget} onSelectProfile={(id) => void selectProfile(id)} onOpenCreate={() => dispatch({ type: "formOpened", mode: "create" })} onOpenEdit={() => dispatch({ type: "formOpened", mode: "edit" })} onCloseForm={() => dispatch({ type: "formClosed" })} onSubmitForm={(input) => void submitProfile(input)} onTransition={(profile, target) => void transitionProfile(profile, target)} onRetry={reloadProfiles}/>
    </main>
  </div>;
}
