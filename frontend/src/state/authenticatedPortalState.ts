import type { AssistantLanguage, AssistantProfile, AssistantProfileStatus, AssistantTone, Company, CreateAssistantProfileInput, UpdateAssistantProfileInput, WorkspaceSummary } from "../types/api";

export interface AssistantProfileFormValues {
  name: string; assistantLanguage: "" | AssistantLanguage; description: string; businessRole: string;
  objective: string; audience: string; tone: AssistantTone; welcomeMessage: string; fallbackMessage: string;
}

function nullableFormValue(value: string): string | null { const trimmed = value.trim(); return trimmed ? trimmed : null; }

export function buildAssistantProfileInput(values: AssistantProfileFormValues, mode: "create" | "edit"): CreateAssistantProfileInput | UpdateAssistantProfileInput {
  const input: CreateAssistantProfileInput = {
    name: values.name.trim(), assistantLanguage: values.assistantLanguage as AssistantLanguage,
    description: nullableFormValue(values.description), businessRole: nullableFormValue(values.businessRole),
    objective: nullableFormValue(values.objective), audience: nullableFormValue(values.audience), tone: values.tone,
    welcomeMessage: nullableFormValue(values.welcomeMessage),
  };
  if (values.fallbackMessage.trim()) input.fallbackMessage = values.fallbackMessage.trim();
  if (mode === "edit" && !input.fallbackMessage) input.fallbackMessage = "";
  return input;
}

export type FormMode = "closed" | "create" | "edit";
export type PortalNotice = { type: "success" | "error"; key: string } | null;

export interface RequestContext {
  requestId: number;
  generation: number;
  workspaceId?: string;
  companyId?: number;
  profileId?: string;
}

export type ProfileMutationOperation = "create" | "update" | "transition";
export interface ProfileMutationContext extends RequestContext { operation: ProfileMutationOperation }

export function isCurrentIntent(activeRequestId: number, candidateRequestId: number): boolean {
  return activeRequestId === candidateRequestId;
}

export function shouldApplyWorkspaceRefresh(activeWorkspaceId: string | null, requestWorkspaceId: string,
  activeRequestId: number, requestId: number, mounted: boolean): boolean {
  return mounted && activeWorkspaceId === requestWorkspaceId && activeRequestId === requestId;
}

export interface AuthenticatedPortalState {
  workspaces: WorkspaceSummary[];
  workspacesLoading: boolean;
  workspaceError: boolean;
  selectedWorkspace: WorkspaceSummary | null;
  pendingWorkspaceId: string | null;
  workspaceGeneration: number;
  activeWorkspaceRequest: RequestContext | null;
  companies: Company[];
  companiesLoading: boolean;
  companyError: boolean;
  companyCreating: boolean;
  selectedCompanyId: number | null;
  companyGeneration: number;
  profiles: AssistantProfile[];
  profilesLoading: boolean;
  profileError: boolean;
  selectedProfileId: string | null;
  transientArchivedProfile: AssistantProfile | null;
  profileGeneration: number;
  formMode: FormMode;
  submitting: boolean;
  transitionTarget: AssistantProfileStatus | null;
  notice: PortalNotice;
  profileReloadRequested: boolean;
  activeCompaniesRequest: RequestContext | null;
  activeCompanyCreateRequest: RequestContext | null;
  activeProfilesRequest: RequestContext | null;
  activeProfileRequest: RequestContext | null;
  activeMutationRequest: ProfileMutationContext | null;
}

export const initialAuthenticatedPortalState: AuthenticatedPortalState = {
  workspaces: [], workspacesLoading: true, workspaceError: false,
  selectedWorkspace: null, pendingWorkspaceId: null, workspaceGeneration: 0, activeWorkspaceRequest: null,
  companies: [], companiesLoading: false, companyError: false, companyCreating: false, selectedCompanyId: null, companyGeneration: 0,
  profiles: [], profilesLoading: false, profileError: false, selectedProfileId: null,
  transientArchivedProfile: null, profileGeneration: 0, formMode: "closed", submitting: false,
  transitionTarget: null, notice: null, profileReloadRequested: false,
  activeCompaniesRequest: null, activeCompanyCreateRequest: null, activeProfilesRequest: null, activeProfileRequest: null, activeMutationRequest: null,
};

type Action =
  | { type: "workspacesLoaded"; workspaces: WorkspaceSummary[] }
  | { type: "workspacesFailed" }
  | { type: "workspaceSelectionRequested"; workspaceId: string; request: RequestContext }
  | { type: "workspaceSelectionSucceeded"; request: RequestContext; workspace: WorkspaceSummary }
  | { type: "workspaceSelectionNotFound"; request: RequestContext }
  | { type: "workspaceCleared" }
  | { type: "companiesLoadStarted"; request: RequestContext }
  | { type: "companiesLoaded"; request: RequestContext; companies: Company[] }
  | { type: "companiesLoadFailed"; request: RequestContext }
  | { type: "companiesNotFound"; request: RequestContext }
  | { type: "companyCreateStarted"; request: RequestContext }
  | { type: "companyCreated"; request: RequestContext; company: Company }
  | { type: "companyCreateFailed"; request: RequestContext }
  | { type: "companyCreateNotFound"; request: RequestContext }
  | { type: "companySelected"; companyId: number }
  | { type: "companyNotFound" }
  | { type: "profilesLoadStarted"; request: RequestContext }
  | { type: "profilesLoaded"; request: RequestContext; profiles: AssistantProfile[] }
  | { type: "profilesLoadFailed"; request: RequestContext }
  | { type: "profilesNotFound"; request: RequestContext }
  | { type: "profileSelected"; profileId: string | null }
  | { type: "profileLoadStarted"; request: RequestContext }
  | { type: "profileLoaded"; request: RequestContext; profile: AssistantProfile }
  | { type: "profileLoadFailed"; request: RequestContext }
  | { type: "profileNotFound"; request: RequestContext }
  | { type: "formOpened"; mode: Exclude<FormMode, "closed"> }
  | { type: "formClosed" }
  | { type: "submissionStarted"; request: ProfileMutationContext }
  | { type: "submissionFailed"; request: ProfileMutationContext; noticeKey: string }
  | { type: "profileCreated"; request: ProfileMutationContext; profile: AssistantProfile }
  | { type: "profileUpdated"; request: ProfileMutationContext; profile: AssistantProfile }
  | { type: "profileCreateNotFound"; request: ProfileMutationContext }
  | { type: "profileMutationNotFound"; request: ProfileMutationContext }
  | { type: "transitionStarted"; request: ProfileMutationContext; target: AssistantProfileStatus }
  | { type: "transitionFailed"; request: ProfileMutationContext; noticeKey: string }
  | { type: "profileTransitioned"; request: ProfileMutationContext; profile: AssistantProfile }
  | { type: "profileReloadConsumed" }
  | { type: "noticeCleared" }
  | { type: "noticeSet"; noticeKey: string }
  | { type: "requestAborted" }
  | { type: "logout" };

function clearProfiles(state: AuthenticatedPortalState): AuthenticatedPortalState {
  return { ...state, profiles: [], profilesLoading: false, profileError: false, selectedProfileId: null,
    transientArchivedProfile: null, profileGeneration: state.profileGeneration + 1, formMode: "closed",
    submitting: false, transitionTarget: null, activeProfilesRequest: null, activeProfileRequest: null,
    activeMutationRequest: null,
    profileReloadRequested: false };
}

function clearCompanies(state: AuthenticatedPortalState): AuthenticatedPortalState {
  return clearProfiles({ ...state, companies: [], companiesLoading: false, companyError: false, companyCreating: false,
    selectedCompanyId: null, companyGeneration: state.companyGeneration + 1, activeCompaniesRequest: null,
    activeCompanyCreateRequest: null });
}

function matches(state: AuthenticatedPortalState, active: RequestContext | null, incoming: RequestContext): boolean {
  return !!active && active.requestId === incoming.requestId && active.generation === incoming.generation
    && active.workspaceId === incoming.workspaceId && active.companyId === incoming.companyId
    && active.profileId === incoming.profileId
    && (!incoming.workspaceId || state.selectedWorkspace?.id === incoming.workspaceId)
    && (!incoming.companyId || state.selectedCompanyId === incoming.companyId);
}

function workspaceMatches(state: AuthenticatedPortalState, request: RequestContext): boolean {
  const active = state.activeWorkspaceRequest;
  return !!active && active.requestId === request.requestId && active.generation === request.generation
    && active.workspaceId === request.workspaceId && state.pendingWorkspaceId === request.workspaceId;
}

export function matchesProfileMutation(state: AuthenticatedPortalState, request: ProfileMutationContext): boolean {
  const active = state.activeMutationRequest;
  return !!active && active.requestId === request.requestId && active.generation === request.generation
    && active.workspaceId === request.workspaceId && active.companyId === request.companyId
    && active.profileId === request.profileId && active.operation === request.operation
    && state.selectedWorkspace?.id === request.workspaceId && state.selectedCompanyId === request.companyId;
}

export function canCreateCompany(state: AuthenticatedPortalState): boolean {
  return state.selectedWorkspace !== null;
}

export function authenticatedPortalReducer(state: AuthenticatedPortalState, action: Action): AuthenticatedPortalState {
  switch (action.type) {
    case "workspacesLoaded": return { ...state, workspaces: action.workspaces, workspacesLoading: false, workspaceError: false };
    case "workspacesFailed": return { ...state, workspacesLoading: false, workspaceError: true };
    case "workspaceSelectionRequested": return clearCompanies({ ...state, selectedWorkspace: null,
      pendingWorkspaceId: action.workspaceId, workspaceGeneration: action.request.generation,
      activeWorkspaceRequest: action.request, notice: null });
    case "workspaceSelectionSucceeded": return workspaceMatches(state, action.request)
      ? { ...state, selectedWorkspace: action.workspace, pendingWorkspaceId: null, activeWorkspaceRequest: null } : state;
    case "workspaceSelectionNotFound": return workspaceMatches(state, action.request)
      ? clearCompanies({ ...state, selectedWorkspace: null, pendingWorkspaceId: null, activeWorkspaceRequest: null,
        notice: { type: "error", key: "portal.resourceUnavailable" } }) : state;
    case "workspaceCleared": return clearCompanies({ ...state, selectedWorkspace: null, pendingWorkspaceId: null,
      activeWorkspaceRequest: null, workspaceGeneration: state.workspaceGeneration + 1,
      notice: { type: "error", key: "portal.resourceUnavailable" } });
    case "companiesLoadStarted": return { ...state, companiesLoading: true, companyError: false, activeCompaniesRequest: action.request };
    case "companiesLoaded": return matches(state, state.activeCompaniesRequest, action.request)
      ? { ...state, companies: action.companies, companiesLoading: false, activeCompaniesRequest: null } : state;
    case "companiesLoadFailed": return matches(state, state.activeCompaniesRequest, action.request)
      ? { ...state, companiesLoading: false, companyError: true, activeCompaniesRequest: null } : state;
    case "companiesNotFound": return matches(state, state.activeCompaniesRequest, action.request)
      ? clearCompanies({ ...state, selectedWorkspace: null, pendingWorkspaceId: null,
        notice: { type: "error", key: "portal.resourceUnavailable" } }) : state;
    case "companyCreateStarted": return action.request.workspaceId === state.selectedWorkspace?.id
      && action.request.generation === state.workspaceGeneration
      ? { ...state, companyCreating: true, activeCompanyCreateRequest: action.request, notice: null } : state;
    case "companyCreated": return matches(state, state.activeCompanyCreateRequest, action.request)
      ? { ...state, companyCreating: false, activeCompanyCreateRequest: null,
        companies: [action.company, ...state.companies.filter((company) => company.id !== action.company.id)],
        notice: { type: "success", key: "companies.createSuccess" } } : state;
    case "companyCreateFailed": return matches(state, state.activeCompanyCreateRequest, action.request)
      ? { ...state, companyCreating: false, activeCompanyCreateRequest: null,
        notice: { type: "error", key: "companies.operationError" } } : state;
    case "companyCreateNotFound": return matches(state, state.activeCompanyCreateRequest, action.request)
      ? clearCompanies({ ...state, selectedWorkspace: null, pendingWorkspaceId: null,
        notice: { type: "error", key: "portal.resourceUnavailable" } }) : state;
    case "companySelected": return clearProfiles({ ...state, selectedCompanyId: action.companyId,
      companyGeneration: state.companyGeneration + 1, notice: null });
    case "companyNotFound": return clearProfiles({ ...state, selectedCompanyId: null,
      notice: { type: "error", key: "portal.resourceUnavailable" } });
    case "profilesLoadStarted": return { ...state, profilesLoading: true, profileError: false, profileReloadRequested: false,
      activeProfilesRequest: action.request };
    case "profilesLoaded": return matches(state, state.activeProfilesRequest, action.request)
      ? { ...state, profiles: action.profiles, profilesLoading: false, activeProfilesRequest: null } : state;
    case "profilesLoadFailed": return matches(state, state.activeProfilesRequest, action.request)
      ? { ...state, profilesLoading: false, profileError: true, activeProfilesRequest: null } : state;
    case "profilesNotFound": return matches(state, state.activeProfilesRequest, action.request)
      ? clearProfiles({ ...state, selectedCompanyId: null, notice: { type: "error", key: "portal.resourceUnavailable" } }) : state;
    case "profileSelected": return { ...state, selectedProfileId: action.profileId, transientArchivedProfile: null,
      formMode: "closed", profileError: false };
    case "profileLoadStarted": return { ...state, activeProfileRequest: action.request };
    case "profileLoaded": return matches(state, state.activeProfileRequest, action.request)
      ? { ...state, profiles: replaceProfile(state.profiles, action.profile), selectedProfileId: action.profile.id,
        activeProfileRequest: null } : state;
    case "profileLoadFailed": return matches(state, state.activeProfileRequest, action.request)
      ? { ...state, activeProfileRequest: null, notice: { type: "error", key: "profiles.loadError" } } : state;
    case "profileNotFound": return matches(state, state.activeProfileRequest, action.request)
      ? { ...state, selectedProfileId: null, transientArchivedProfile: null, activeProfileRequest: null,
        profileReloadRequested: true, notice: { type: "error", key: "portal.resourceUnavailable" } } : state;
    case "formOpened": return { ...state, formMode: action.mode };
    case "formClosed": return { ...state, formMode: "closed" };
    case "submissionStarted": return { ...state, submitting: true, activeMutationRequest: action.request, notice: null };
    case "submissionFailed": return matchesProfileMutation(state, action.request)
      ? { ...state, submitting: false, activeMutationRequest: null, notice: { type: "error", key: action.noticeKey } } : state;
    case "profileCreated": return matchesProfileMutation(state, action.request) ? { ...state, submitting: false,
      activeMutationRequest: null, formMode: "closed",
      profiles: [action.profile, ...state.profiles.filter((profile) => profile.id !== action.profile.id)],
      selectedProfileId: action.profile.id, notice: { type: "success", key: "profiles.createSuccess" } } : state;
    case "profileUpdated": return matchesProfileMutation(state, action.request) ? { ...state, submitting: false,
      activeMutationRequest: null, formMode: "closed",
      profiles: replaceProfile(state.profiles, action.profile), selectedProfileId: action.profile.id,
      notice: { type: "success", key: "profiles.updateSuccess" } } : state;
    case "profileCreateNotFound": return matchesProfileMutation(state, action.request)
      ? { ...state, submitting: false, activeMutationRequest: null, profileReloadRequested: true,
        notice: { type: "error", key: "portal.resourceUnavailable" } } : state;
    case "profileMutationNotFound": return matchesProfileMutation(state, action.request) ? { ...state,
      submitting: false, transitionTarget: null, activeMutationRequest: null,
      selectedProfileId: null, transientArchivedProfile: null, formMode: "closed", profileReloadRequested: true,
      notice: { type: "error", key: "portal.resourceUnavailable" } } : state;
    case "transitionStarted": return { ...state, transitionTarget: action.target,
      activeMutationRequest: action.request, notice: null };
    case "transitionFailed": return matchesProfileMutation(state, action.request)
      ? { ...state, transitionTarget: null, activeMutationRequest: null,
        notice: { type: "error", key: action.noticeKey } } : state;
    case "profileTransitioned": {
      if (!matchesProfileMutation(state, action.request)) return state;
      const archived = action.profile.status === "archived";
      return { ...state, transitionTarget: null, activeMutationRequest: null, formMode: "closed",
        profiles: archived ? state.profiles.filter((profile) => profile.id !== action.profile.id) : replaceProfile(state.profiles, action.profile),
        selectedProfileId: archived ? null : action.profile.id,
        transientArchivedProfile: archived ? action.profile : null,
        notice: { type: "success", key: archived ? "profiles.archiveSuccess" : "profiles.transitionSuccess" } };
    }
    case "profileReloadConsumed": return { ...state, profileReloadRequested: false };
    case "noticeCleared": return { ...state, notice: null };
    case "noticeSet": return { ...state, notice: { type: "error", key: action.noticeKey } };
    case "requestAborted": return state;
    case "logout": return { ...initialAuthenticatedPortalState, workspacesLoading: false };
  }
}

function replaceProfile(profiles: AssistantProfile[], updated: AssistantProfile): AssistantProfile[] {
  const exists = profiles.some((profile) => profile.id === updated.id);
  return exists ? profiles.map((profile) => profile.id === updated.id ? updated : profile) : [updated, ...profiles];
}

export const readyAdvisoryFields = ["name", "businessRole", "objective", "tone", "assistantLanguage", "welcomeMessage", "fallbackMessage"] as const;
export type ReadyAdvisoryField = typeof readyAdvisoryFields[number];

export function missingReadyFields(profile: AssistantProfile): ReadyAdvisoryField[] {
  return readyAdvisoryFields.filter((field) => {
    const value = profile[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function visibleTransitions(status: AssistantProfileStatus): AssistantProfileStatus[] {
  if (status === "draft") return ["ready", "archived"];
  if (status === "ready") return ["draft", "disabled", "archived"];
  if (status === "disabled") return ["ready", "draft", "archived"];
  return ["draft"];
}

export function markReadyDisabled(profile: AssistantProfile | null, transitionPending: boolean): boolean {
  return transitionPending || !profile || !visibleTransitions(profile.status).includes("ready");
}

export type { Action as AuthenticatedPortalAction };
