import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { authenticatedPortalReducer, initialAuthenticatedPortalState, initialWorkspace, isCurrentIntent,
  type AuthenticatedPortalState, type ProfileMutationContext, type ProfileMutationOperation, type RequestContext } from "./authenticatedPortalState";
import type { AssistantProfile, AssistantProfileStatus, CompanyInput, CreateAssistantProfileInput, UpdateAssistantProfileInput, WorkspaceSummary } from "../types/api";

interface Props { csrf: string; children: React.ReactNode }

export interface AuthenticatedPortalContextValue {
  state: AuthenticatedPortalState;
  workspaces: WorkspaceSummary[];
  selectedWorkspace: WorkspaceSummary | null;
  companies: AuthenticatedPortalState["companies"];
  selectedCompany: AuthenticatedPortalState["companies"][number] | null;
  needsWorkspace: boolean;
  needsWorkspaceSelection: boolean;
  needsCompany: boolean;
  hasSelectedCompany: boolean;
  isLoading: boolean;
  selectWorkspace: (workspaceId: string) => Promise<boolean>;
  selectCompany: (companyId: number) => Promise<boolean>;
  createWorkspace: (name: string, timezone: string, defaultLocale: "en" | "es") => Promise<boolean>;
  createCompany: (input: CompanyInput) => Promise<boolean>;
  createOnboardingCompany: (name: string) => Promise<number | null>;
  refresh: () => Promise<void>;
  refreshCompanies: () => void;
  refreshSelectedCompany: () => Promise<void>;
  clearWorkspace: () => void;
  loadProfiles: (workspaceId: string, companyId: number, generation: number) => Promise<void>;
  selectProfile: (profileId: string) => Promise<void>;
  reloadProfiles: () => void;
  submitProfile: (input: CreateAssistantProfileInput | UpdateAssistantProfileInput) => Promise<void>;
  transitionProfile: (profile: AssistantProfile, target: AssistantProfileStatus) => Promise<void>;
  clearNotice: () => void;
  openProfileForm: (mode: "create" | "edit") => void;
  closeProfileForm: () => void;
}

const AuthenticatedPortalContext = createContext<AuthenticatedPortalContextValue | null>(null);

function aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

export function AuthenticatedPortalProvider({ csrf, children }: Props): React.JSX.Element {
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
  const stateRef = useRef(state);
  stateRef.current = state;

  const nextRequest = (generation: number, workspaceId?: string, companyId?: number, profileId?: string): RequestContext => ({ requestId: ++sequence.current, generation, ...(workspaceId === undefined ? {} : { workspaceId }), ...(companyId === undefined ? {} : { companyId }), ...(profileId === undefined ? {} : { profileId }) });
  const nextMutation = (operation: ProfileMutationOperation, generation: number, workspaceId: string, companyId: number, profileId?: string): ProfileMutationContext => ({ ...nextRequest(generation, workspaceId, companyId, profileId), operation });
  const abortProfiles = (): void => { profilesAbort.current?.abort(); profileAbort.current?.abort(); mutationAbort.current?.abort(); };
  const abortTenant = (): void => { workspaceAbort.current?.abort(); companiesAbort.current?.abort(); companyCreateAbort.current?.abort(); abortProfiles(); workspaceSelectionIntent.current = ++sequence.current; companySelectionIntent.current = ++sequence.current; };

  const refresh = useCallback(async (): Promise<void> => {
    try { dispatch({ type: "workspacesLoaded", workspaces: await atlasApi.listWorkspaces() }); }
    catch { dispatch({ type: "workspacesFailed" }); }
  }, []);

  useEffect(() => { void refresh(); return () => abortTenant(); }, [refresh]);

  const loadCompanies = async (workspace: WorkspaceSummary, generation: number): Promise<void> => {
    companiesAbort.current?.abort(); const controller = new AbortController(); companiesAbort.current = controller;
    const request = nextRequest(generation, workspace.id); dispatch({ type: "companiesLoadStarted", request });
    try { dispatch({ type: "companiesLoaded", request, companies: await atlasApi.listWorkspaceCompanies(workspace.id, controller.signal) }); }
    catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return; } dispatch(error instanceof ApiError && error.status === 404 ? { type: "companiesNotFound", request } : { type: "companiesLoadFailed", request }); }
  };
  const refreshCompanies = (): void => {
    const current = stateRef.current;
    if (current.selectedWorkspace) void loadCompanies(current.selectedWorkspace, current.workspaceGeneration);
  };

  const selectWorkspace = async (workspaceId: string): Promise<boolean> => {
    abortTenant(); const request = nextRequest(stateRef.current.workspaceGeneration + 1, workspaceId); workspaceSelectionIntent.current = request.requestId;
    const controller = new AbortController(); workspaceAbort.current = controller; dispatch({ type: "workspaceSelectionRequested", workspaceId, request });
    try { const workspace = await atlasApi.selectWorkspace(csrf, workspaceId, controller.signal); if (!isCurrentIntent(workspaceSelectionIntent.current, request.requestId)) return false; dispatch({ type: "workspaceSelectionSucceeded", request, workspace }); await loadCompanies(workspace, request.generation); return isCurrentIntent(workspaceSelectionIntent.current, request.requestId); }
    catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return false; } dispatch({ type: "workspaceSelectionNotFound", request }); return false; }
  };

  useEffect(() => {
    if (state.workspacesLoading || state.workspaceError || state.initialWorkspaceResolved) return;
    let current = true;
    void (async () => {
      let persisted: WorkspaceSummary | null = null;
      try { persisted = await atlasApi.selectedWorkspace(); } catch { /* The single-workspace fallback remains safe. */ }
      const workspace = initialWorkspace(state.workspaces, persisted);
      if (workspace) await selectWorkspace(workspace.id);
      if (current) dispatch({ type: "initialWorkspaceResolved" });
    })();
    return () => { current = false; };
  }, [state.workspacesLoading, state.workspaceError, state.initialWorkspaceResolved, state.workspaces]);

  const loadProfiles = async (workspaceId: string, companyId: number, generation: number): Promise<void> => {
    profilesAbort.current?.abort(); const controller = new AbortController(); profilesAbort.current = controller; const request = nextRequest(generation, workspaceId, companyId); dispatch({ type: "profilesLoadStarted", request });
    try { dispatch({ type: "profilesLoaded", request, profiles: await atlasApi.listAssistantProfiles(workspaceId, companyId, controller.signal) }); }
    catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return; } dispatch(error instanceof ApiError && error.status === 404 ? { type: "profilesNotFound", request } : { type: "profilesLoadFailed", request }); }
  };

  const selectCompany = async (companyId: number): Promise<boolean> => {
    const workspace = stateRef.current.selectedWorkspace; if (!workspace) return false; abortProfiles(); dispatch({ type: "companySelected", companyId }); const intentId = ++sequence.current; companySelectionIntent.current = intentId; const workspaceIntentId = workspaceSelectionIntent.current; const controller = new AbortController(); profileAbort.current = controller;
    try { await atlasApi.getWorkspaceCompany(workspace.id, companyId, controller.signal); if (!isCurrentIntent(companySelectionIntent.current, intentId) || !isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false; await loadProfiles(workspace.id, companyId, stateRef.current.profileGeneration + 1); return true; }
    catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return false; } if (!isCurrentIntent(companySelectionIntent.current, intentId) || !isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false; dispatch(error instanceof ApiError && error.status === 404 ? { type: "companyNotFound" } : { type: "noticeSet", noticeKey: "portal.companyLoadError" }); return false; }
  };

  const createWorkspace = async (name: string, timezone: string, defaultLocale: "en" | "es"): Promise<boolean> => {
    try {
      const created = await atlasApi.createWorkspace(csrf, name, timezone, defaultLocale);
      await refresh();
      return selectWorkspace(created.workspace.id);
    } catch { return false; }
  };

  const createCompany = async (input: CompanyInput): Promise<boolean> => {
    const workspace = stateRef.current.selectedWorkspace; if (!workspace) return false; companyCreateAbort.current?.abort(); const controller = new AbortController(); companyCreateAbort.current = controller; const request = nextRequest(stateRef.current.workspaceGeneration, workspace.id); const workspaceIntentId = workspaceSelectionIntent.current; dispatch({ type: "companyCreateStarted", request });
    try { const company = await atlasApi.createOnboardingCompany(csrf, workspace.id, { name: input.name, ...(input.website === undefined ? {} : { website: input.website }) }, controller.signal); if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false; dispatch({ type: "companyCreated", request, company }); await loadCompanies(workspace, request.generation); return true; }
    catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return false; } if (!isCurrentIntent(workspaceSelectionIntent.current, workspaceIntentId)) return false; if (error instanceof ApiError && error.status === 404) dispatch({ type: "companyCreateNotFound", request }); else if (error instanceof ApiError && error.code === "commercial_limit_reached") dispatch({ type: "companyCreateFailed", request, noticeKey: "companies.commercialLimitReached" }); else dispatch({ type: "companyCreateFailed", request }); return false; }
  };
  const createOnboardingCompany = async (name: string): Promise<number | null> => {
    const workspace = stateRef.current.selectedWorkspace;
    if (!workspace) return null;
    try {
      const created = await atlasApi.createOnboardingCompany(csrf, workspace.id, { name });
      await loadCompanies(workspace, stateRef.current.workspaceGeneration);
      return await selectCompany(created.id) ? created.id : null;
    } catch { return null; }
  };

  const selectProfile = async (profileId: string): Promise<void> => { const current = stateRef.current, workspace = current.selectedWorkspace, companyId = current.selectedCompanyId; if (!workspace || !companyId) return; profileAbort.current?.abort(); const controller = new AbortController(); profileAbort.current = controller; dispatch({ type: "profileSelected", profileId }); const request = nextRequest(current.profileGeneration, workspace.id, companyId, profileId); dispatch({ type: "profileLoadStarted", request }); try { dispatch({ type: "profileLoaded", request, profile: await atlasApi.getAssistantProfile(workspace.id, companyId, profileId, controller.signal) }); } catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return; } dispatch(error instanceof ApiError && error.status === 404 ? { type: "profileNotFound", request } : { type: "profileLoadFailed", request }); } };
  const reloadProfiles = (): void => { const current = stateRef.current; if (current.selectedWorkspace && current.selectedCompanyId) void loadProfiles(current.selectedWorkspace.id, current.selectedCompanyId, current.profileGeneration); };
  useEffect(() => { if (state.profileReloadRequested) reloadProfiles(); }, [state.profileReloadRequested]);
  const refreshSelectedCompany = async (): Promise<void> => { const current = stateRef.current, workspace = current.selectedWorkspace, companyId = current.selectedCompanyId; if (!workspace || !companyId) return; try { dispatch({ type: "companyRefreshed", workspaceId: workspace.id, company: await atlasApi.getWorkspaceCompany(workspace.id, companyId) }); } catch { /* Keep the known company after a successful publication. */ } };
  const submitProfile = async (input: CreateAssistantProfileInput | UpdateAssistantProfileInput): Promise<void> => { const current = stateRef.current, workspace = current.selectedWorkspace, companyId = current.selectedCompanyId; if (!workspace || !companyId) return; mutationAbort.current?.abort(); const controller = new AbortController(); mutationAbort.current = controller; const operation: ProfileMutationOperation = current.formMode === "create" ? "create" : "update"; const request = nextMutation(operation, current.profileGeneration, workspace.id, companyId, operation === "update" ? current.selectedProfileId ?? undefined : undefined); dispatch({ type: "submissionStarted", request }); try { if (current.formMode === "create") dispatch({ type: "profileCreated", request, profile: await atlasApi.createAssistantProfile(csrf, workspace.id, companyId, input as CreateAssistantProfileInput, controller.signal) }); else if (current.selectedProfileId) dispatch({ type: "profileUpdated", request, profile: await atlasApi.updateAssistantProfile(csrf, workspace.id, companyId, current.selectedProfileId, input, controller.signal) }); } catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return; } if (error instanceof ApiError && error.status === 404) dispatch(operation === "create" ? { type: "profileCreateNotFound", request } : { type: "profileMutationNotFound", request }); else if (error instanceof ApiError && error.status === 409) dispatch({ type: "submissionFailed", request, noticeKey: operation === "create" ? "profiles.nameConflict" : "profiles.updateConflict" }); else if (error instanceof ApiError && error.status === 400) dispatch({ type: "submissionFailed", request, noticeKey: "profiles.validationError" }); else dispatch({ type: "submissionFailed", request, noticeKey: operation === "create" ? "profiles.createError" : "profiles.updateError" }); } };
  const transitionProfile = async (profile: AssistantProfile, target: AssistantProfileStatus): Promise<void> => { const current = stateRef.current, workspace = current.selectedWorkspace, companyId = current.selectedCompanyId; if (!workspace || !companyId) return; mutationAbort.current?.abort(); const controller = new AbortController(); mutationAbort.current = controller; const request = nextMutation("transition", current.profileGeneration, workspace.id, companyId, profile.id); dispatch({ type: "transitionStarted", request, target }); try { dispatch({ type: "profileTransitioned", request, profile: await atlasApi.transitionAssistantProfile(csrf, workspace.id, companyId, profile.id, target, controller.signal) }); } catch (error: unknown) { if (aborted(error)) { dispatch({ type: "requestAborted" }); return; } dispatch(error instanceof ApiError && error.status === 404 ? { type: "profileMutationNotFound", request } : { type: "transitionFailed", request, noticeKey: error instanceof ApiError && error.status === 409 ? "profiles.transitionConflict" : "profiles.transitionError" }); } };

  const clearNotice = useCallback((): void => dispatch({ type: "noticeCleared" }), []);
  const selectedCompany = state.companies.find((company) => company.id === state.selectedCompanyId) ?? null;
  const value = useMemo<AuthenticatedPortalContextValue>(() => ({ state, workspaces: state.workspaces, selectedWorkspace: state.selectedWorkspace, companies: state.companies, selectedCompany, needsWorkspace: !state.workspacesLoading && !state.workspaceError && state.workspaces.length === 0, needsWorkspaceSelection: !state.workspacesLoading && !state.workspaceError && state.initialWorkspaceResolved && state.workspaces.length > 1 && !state.selectedWorkspace && !state.pendingWorkspaceId, needsCompany: !!state.selectedWorkspace && !state.selectedCompanyId, hasSelectedCompany: state.selectedCompanyId !== null, isLoading: state.workspacesLoading || !state.initialWorkspaceResolved || state.pendingWorkspaceId !== null || state.companiesLoading, selectWorkspace, selectCompany, createWorkspace, createCompany, createOnboardingCompany, refresh, refreshCompanies, refreshSelectedCompany, clearWorkspace: () => { abortTenant(); dispatch({ type: "workspaceCleared" }); }, loadProfiles, selectProfile, reloadProfiles, submitProfile, transitionProfile, clearNotice, openProfileForm: (mode) => dispatch({ type: "formOpened", mode }), closeProfileForm: () => dispatch({ type: "formClosed" }) }), [state, selectedCompany, refresh, clearNotice]);
  return <AuthenticatedPortalContext value={value}>{children}</AuthenticatedPortalContext>;
}

export function useAuthenticatedPortal(): AuthenticatedPortalContextValue {
  const context = useContext(AuthenticatedPortalContext);
  if (!context) throw new Error("useAuthenticatedPortal must be used within an AuthenticatedPortalProvider");
  return context;
}
