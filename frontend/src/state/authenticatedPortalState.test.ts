import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authenticatedPortalReducer, canCreateCompany, initialAuthenticatedPortalState, markReadyDisabled,
  missingReadyFields, visibleTransitions, buildAssistantProfileInput, type AssistantProfileFormValues,
  initialWorkspace, isCurrentIntent, shouldApplyWorkspaceRefresh, type AuthenticatedPortalState,
  type ProfileMutationContext, type ProfileMutationOperation, type RequestContext,
} from "./authenticatedPortalState.ts";
import type { AssistantProfile, Company, WorkspaceSummary } from "../types/api.ts";
import { ApiError, atlasApi, setAuthenticationRecovery } from "../api/atlasApi.ts";

const workspaceA: WorkspaceSummary = { id: "wsp_a", name: "Workspace A", role: "owner" };
const workspaceB: WorkspaceSummary = { id: "wsp_b", name: "Workspace B", role: "owner" };
const companyA: Company = { id: 1, name: "Company A", website: "https://a.test", phone: "", email: "", status: "ready", createdAt: "2026-07-16T00:00:00.000Z" };
const companyB: Company = { ...companyA, id: 2, name: "Company B", website: "https://b.test", status: "processing" };
const profileA: AssistantProfile = {
  id: "asp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Sales", description: null, businessRole: "Sales advisor",
  objective: "Answer customer questions", audience: null, tone: "professional", assistantLanguage: "en",
  welcomeMessage: "Welcome", fallbackMessage: "I need more information.", status: "draft",
  createdAt: "2026-07-16T00:00:00.000Z", updatedAt: "2026-07-16T00:00:00.000Z", archivedAt: null,
};

function populated(): AuthenticatedPortalState {
  return { ...initialAuthenticatedPortalState, workspaces: [workspaceA, workspaceB], workspacesLoading: false,
    selectedWorkspace: workspaceA, companies: [companyA], selectedCompanyId: companyA.id,
    profiles: [profileA], selectedProfileId: profileA.id, transientArchivedProfile: null };
}

function request(state: AuthenticatedPortalState, requestId = 1): RequestContext {
  return { requestId, generation: state.profileGeneration, workspaceId: state.selectedWorkspace?.id,
    companyId: state.selectedCompanyId ?? undefined };
}

function mutation(state: AuthenticatedPortalState, operation: ProfileMutationOperation,
  requestId = 1, profileId?: string): ProfileMutationContext {
  return { ...request(state, requestId), ...(profileId === undefined ? {} : { profileId }), operation };
}

test("selecting another Workspace clears the previous Company and Profile subtree", () => {
  const request = { requestId: 1, generation: 1, workspaceId: workspaceB.id };
  const state = authenticatedPortalReducer(populated(), { type: "workspaceSelectionRequested", workspaceId: workspaceB.id, request });
  assert.equal(state.selectedWorkspace, null); assert.equal(state.pendingWorkspaceId, workspaceB.id);
  assert.equal(state.selectedCompanyId, null); assert.deepEqual(state.profiles, []); assert.equal(state.selectedProfileId, null);
});

test("an authenticated user with no Workspaces leaves loading with an empty list", () => {
  const state = authenticatedPortalReducer(initialAuthenticatedPortalState, { type: "workspacesLoaded", workspaces: [] });
  assert.equal(state.workspacesLoading, false); assert.equal(state.workspaceError, false); assert.deepEqual(state.workspaces, []);
});

test("a Workspace list failure leaves loading and exposes the error state", () => {
  const state = authenticatedPortalReducer(initialAuthenticatedPortalState, { type: "workspacesFailed" });
  assert.equal(state.workspacesLoading, false); assert.equal(state.workspaceError, true);
});

test("a successful Workspace create refresh can incorporate the server list without selecting it", () => {
  const state = authenticatedPortalReducer(initialAuthenticatedPortalState, { type: "workspacesLoaded", workspaces: [workspaceA] });
  assert.equal(state.workspacesLoading, false); assert.deepEqual(state.workspaces, [workspaceA]); assert.equal(state.selectedWorkspace, null);
});

test("a persisted valid Workspace is restored and a sole active Workspace is selected automatically", () => {
  assert.equal(initialWorkspace([workspaceA, workspaceB], workspaceB)?.id, workspaceB.id);
  assert.equal(initialWorkspace([workspaceA], null)?.id, workspaceA.id);
  assert.equal(initialWorkspace([workspaceA], { ...workspaceB })?.id, workspaceA.id);
  assert.equal(initialWorkspace([workspaceA, workspaceB], null), null);
});

test("Workspace create uses the relative proxy with same-origin credentials and CSRF", async () => {
  const originalFetch = globalThis.fetch; let capturedInput: string | URL | Request = ""; let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedInput = input; capturedInit = init;
    return new Response(JSON.stringify({ workspace: { id: workspaceA.id, name: workspaceA.name } }),
      { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    assert.deepEqual(await atlasApi.createWorkspace("csrf-test", workspaceA.name),
      { workspace: { id: workspaceA.id, name: workspaceA.name } });
    assert.equal(capturedInput, "/api/workspaces"); assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.credentials, "same-origin");
    assert.equal((capturedInit?.headers as Record<string, string>)["x-csrf-token"], "csrf-test");
    assert.equal(capturedInit?.body, JSON.stringify({ name: workspaceA.name }));
  } finally { globalThis.fetch = originalFetch; }
});

test("a selected Workspace with zero Companies makes Company creation available", () => {
  const state = { ...initialAuthenticatedPortalState, selectedWorkspace: workspaceA, companies: [] };
  assert.equal(canCreateCompany(state), true); assert.equal(canCreateCompany(initialAuthenticatedPortalState), false);
});

test("current Company creation accepts the server DTO without auto-selecting it", () => {
  const request = { requestId: 80, generation: 0, workspaceId: workspaceA.id };
  let state = { ...initialAuthenticatedPortalState, selectedWorkspace: workspaceA, workspacesLoading: false };
  state = authenticatedPortalReducer(state, { type: "companyCreateStarted", request });
  assert.equal(state.companyCreating, true);
  state = authenticatedPortalReducer(state, { type: "companyCreated", request, company: companyB });
  assert.deepEqual(state.companies, [companyB]); assert.equal(state.selectedCompanyId, null);
  assert.equal(state.companyCreating, false); assert.equal(state.notice?.key, "companies.createSuccess");
});

test("Company creation sends only the allowed payload with CSRF and same-origin credentials", async () => {
  const originalFetch = globalThis.fetch; let capturedInput: string | URL | Request = ""; let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedInput = input; capturedInit = init;
    return new Response(JSON.stringify(companyB), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    assert.deepEqual(await atlasApi.createWorkspaceCompany("csrf-company", workspaceA.id,
      { name: companyB.name, website: companyB.website }), companyB);
    assert.equal(capturedInput, `/api/workspaces/${workspaceA.id}/companies`);
    assert.equal(capturedInit?.method, "POST"); assert.equal(capturedInit?.credentials, "same-origin");
    assert.equal((capturedInit?.headers as Record<string, string>)["x-csrf-token"], "csrf-company");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), { name: companyB.name, website: companyB.website });
  } finally { globalThis.fetch = originalFetch; }
});

test("stale Company create success and failure are no-ops after a Workspace switch", () => {
  const createRequest = { requestId: 81, generation: 0, workspaceId: workspaceA.id };
  let state = { ...initialAuthenticatedPortalState, selectedWorkspace: workspaceA, workspacesLoading: false };
  state = authenticatedPortalReducer(state, { type: "companyCreateStarted", request: createRequest });
  const workspaceRequest = { requestId: 82, generation: 1, workspaceId: workspaceB.id };
  state = authenticatedPortalReducer(state, { type: "workspaceSelectionRequested", workspaceId: workspaceB.id, request: workspaceRequest });
  const success = authenticatedPortalReducer(state, { type: "companyCreated", request: createRequest, company: companyB });
  const failure = authenticatedPortalReducer(state, { type: "companyCreateFailed", request: createRequest });
  const notFound = authenticatedPortalReducer(state, { type: "companyCreateNotFound", request: createRequest });
  assert.equal(success, state); assert.equal(failure, state); assert.equal(notFound, state); assert.equal(failure.notice, null);
});

test("current Company create failure ends pending and no Workspace rejects creation", () => {
  const request = { requestId: 83, generation: 0, workspaceId: workspaceA.id };
  assert.equal(authenticatedPortalReducer(initialAuthenticatedPortalState, { type: "companyCreateStarted", request }),
    initialAuthenticatedPortalState);
  let state = { ...initialAuthenticatedPortalState, selectedWorkspace: workspaceA, workspacesLoading: false };
  state = authenticatedPortalReducer(state, { type: "companyCreateStarted", request });
  state = authenticatedPortalReducer(state, { type: "companyCreateFailed", request });
  assert.equal(state.companyCreating, false); assert.equal(state.notice?.key, "companies.operationError");
});

test("selecting another Company clears Profile and transient archive state", () => {
  const state = authenticatedPortalReducer({ ...populated(), transientArchivedProfile: { ...profileA, status: "archived", archivedAt: profileA.updatedAt } }, { type: "companySelected", companyId: 2 });
  assert.equal(state.selectedWorkspace?.id, workspaceA.id); assert.equal(state.selectedCompanyId, 2);
  assert.deepEqual(state.profiles, []); assert.equal(state.transientArchivedProfile, null);
});

test("Workspace selection 404 keeps the Workspace choices", () => {
  const request = { requestId: 1, generation: 1, workspaceId: workspaceB.id };
  let state = authenticatedPortalReducer(populated(), { type: "workspaceSelectionRequested", workspaceId: workspaceB.id, request });
  state = authenticatedPortalReducer(state, { type: "workspaceSelectionNotFound", request });
  assert.deepEqual(state.workspaces, [workspaceA, workspaceB]); assert.equal(state.selectedWorkspace, null);
  assert.equal(state.selectedCompanyId, null);
});

test("Company list 404 clears active Workspace but keeps Workspace choices", () => {
  let state = populated(); const context = { requestId: 1, generation: state.workspaceGeneration, workspaceId: workspaceA.id };
  state = authenticatedPortalReducer(state, { type: "companiesLoadStarted", request: context });
  state = authenticatedPortalReducer(state, { type: "companiesNotFound", request: context });
  assert.equal(state.selectedWorkspace, null); assert.deepEqual(state.workspaces, [workspaceA, workspaceB]); assert.deepEqual(state.companies, []);
});

test("Profile list 404 retains Workspace and Companies but clears Company selection", () => {
  let state = populated(); const context = request(state);
  state = authenticatedPortalReducer(state, { type: "profilesLoadStarted", request: context });
  state = authenticatedPortalReducer(state, { type: "profilesNotFound", request: context });
  assert.equal(state.selectedWorkspace?.id, workspaceA.id); assert.deepEqual(state.companies, [companyA]);
  assert.equal(state.selectedCompanyId, null); assert.deepEqual(state.profiles, []);
});

test("Profile get 404 keeps Workspace and Company and requests a list reload", () => {
  let state = populated(); const context = { ...request(state), profileId: profileA.id };
  state = authenticatedPortalReducer(state, { type: "profileLoadStarted", request: context });
  state = authenticatedPortalReducer(state, { type: "profileNotFound", request: context });
  assert.equal(state.selectedWorkspace?.id, workspaceA.id); assert.equal(state.selectedCompanyId, companyA.id);
  assert.equal(state.selectedProfileId, null); assert.equal(state.profileReloadRequested, true);
});

test("create 404 preserves context while update and transition 404 clear the Profile", () => {
  let create = populated(); const createRequest = mutation(create, "create");
  create = authenticatedPortalReducer(create, { type: "submissionStarted", request: createRequest });
  create = authenticatedPortalReducer(create, { type: "profileCreateNotFound", request: createRequest });
  assert.equal(create.selectedProfileId, profileA.id); assert.equal(create.profileReloadRequested, true);
  let update = populated(); const updateRequest = mutation(update, "update", 2, profileA.id);
  update = authenticatedPortalReducer(update, { type: "submissionStarted", request: updateRequest });
  update = authenticatedPortalReducer(update, { type: "profileMutationNotFound", request: updateRequest });
  assert.equal(update.selectedWorkspace?.id, workspaceA.id); assert.equal(update.selectedCompanyId, companyA.id);
  assert.equal(update.selectedProfileId, null); assert.equal(update.profileReloadRequested, true);
});

test("stale Company and Profile results are ignored", () => {
  let state = populated();
  const companiesRequest = { requestId: 1, generation: state.workspaceGeneration, workspaceId: workspaceA.id };
  state = authenticatedPortalReducer(state, { type: "companiesLoadStarted", request: companiesRequest });
  const workspaceRequest = { requestId: 2, generation: state.workspaceGeneration + 1, workspaceId: workspaceB.id };
  state = authenticatedPortalReducer(state, { type: "workspaceSelectionRequested", workspaceId: workspaceB.id, request: workspaceRequest });
  assert.equal(authenticatedPortalReducer(state, { type: "companiesLoaded", request: companiesRequest, companies: [companyA] }), state);

  state = { ...populated() }; const profilesRequest = request(state);
  state = authenticatedPortalReducer(state, { type: "profilesLoadStarted", request: profilesRequest });
  state = authenticatedPortalReducer(state, { type: "companySelected", companyId: 2 });
  assert.equal(authenticatedPortalReducer(state, { type: "profilesLoaded", request: profilesRequest, profiles: [profileA] }), state);
});

test("a stale Workspace selection response cannot activate the previous intent", () => {
  const requestA = { requestId: 1, generation: 1, workspaceId: workspaceA.id };
  const requestB = { requestId: 2, generation: 2, workspaceId: workspaceB.id };
  let state = authenticatedPortalReducer(populated(), { type: "workspaceSelectionRequested", workspaceId: workspaceA.id, request: requestA });
  state = authenticatedPortalReducer(state, { type: "workspaceSelectionRequested", workspaceId: workspaceB.id, request: requestB });
  const stale = authenticatedPortalReducer(state, { type: "workspaceSelectionSucceeded", request: requestA, workspace: workspaceA });
  assert.equal(stale, state); assert.equal(stale.pendingWorkspaceId, workspaceB.id);
});

test("intent and Workspace refresh guards reject replaced async continuations", () => {
  assert.equal(isCurrentIntent(2, 1), false); assert.equal(isCurrentIntent(2, 2), true);
  assert.equal(shouldApplyWorkspaceRefresh(workspaceB.id, workspaceA.id, 2, 1, true), false);
  assert.equal(shouldApplyWorkspaceRefresh(workspaceB.id, workspaceB.id, 2, 1, true), false);
  assert.equal(shouldApplyWorkspaceRefresh(workspaceB.id, workspaceB.id, 2, 2, false), false);
  assert.equal(shouldApplyWorkspaceRefresh(workspaceB.id, workspaceB.id, 2, 2, true), true);
});

test("Workspace A continuation cannot start Companies after Workspace B replaces its intent", () => {
  const startedLoads: string[] = []; const requestA = 30; const requestB = 31;
  const activeIntent = requestB;
  if (isCurrentIntent(activeIntent, requestA)) startedLoads.push(workspaceA.id);
  if (isCurrentIntent(activeIntent, requestB)) startedLoads.push(workspaceB.id);
  assert.deepEqual(startedLoads, [workspaceB.id]);
});

test("Company A continuation cannot start Profiles after Company B replaces its intent", () => {
  const startedLoads: number[] = []; const requestA = 40; const requestB = 41;
  const activeIntent = requestB;
  if (isCurrentIntent(activeIntent, requestA)) startedLoads.push(companyA.id);
  if (isCurrentIntent(activeIntent, requestB)) startedLoads.push(2);
  assert.deepEqual(startedLoads, [2]);
});

test("a stale Company selection error cannot dispatch into the current intent", () => {
  const staleCompanyIntent = 50; const currentCompanyIntent = 51;
  const staleWorkspaceIntent = 60; const currentWorkspaceIntent = 61;
  assert.equal(isCurrentIntent(currentCompanyIntent, staleCompanyIntent), false);
  assert.equal(isCurrentIntent(currentWorkspaceIntent, staleWorkspaceIntent), false);
  assert.equal(isCurrentIntent(currentCompanyIntent, currentCompanyIntent)
    && isCurrentIntent(currentWorkspaceIntent, currentWorkspaceIntent), true);
});

test("a stale Profile detail error cannot show a notice in a new Company", () => {
  let state = populated();
  const profileRequest = { ...request(state, 70), profileId: profileA.id };
  state = authenticatedPortalReducer(state, { type: "profileLoadStarted", request: profileRequest });
  state = authenticatedPortalReducer(state, { type: "companySelected", companyId: 2 });
  const staleFailure = authenticatedPortalReducer(state, { type: "profileLoadFailed", request: profileRequest });
  assert.equal(staleFailure, state); assert.equal(staleFailure.notice, null);
});

test("an aborted request is a state no-op", () => {
  const state = populated(); assert.equal(authenticatedPortalReducer(state, { type: "requestAborted" }), state);
});

test("create and update success use server DTOs without optimistic state", () => {
  let created = populated(); const createRequest = mutation(created, "create");
  created = authenticatedPortalReducer(created, { type: "submissionStarted", request: createRequest });
  created = authenticatedPortalReducer(created, { type: "profileCreated", request: createRequest, profile: { ...profileA, id: "asp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } });
  assert.equal(created.profiles.length, 2); assert.equal(created.selectedProfileId, "asp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const updatedProfile = { ...profileA, name: "Updated" };
  let updated = populated(); const updateRequest = mutation(updated, "update", 2, profileA.id);
  updated = authenticatedPortalReducer(updated, { type: "submissionStarted", request: updateRequest });
  updated = authenticatedPortalReducer(updated, { type: "profileUpdated", request: updateRequest, profile: updatedProfile });
  assert.equal(updated.profiles[0]?.name, "Updated");
  let failed = populated(); const failedRequest = mutation(failed, "update", 3, profileA.id);
  failed = authenticatedPortalReducer(failed, { type: "submissionStarted", request: failedRequest });
  failed = authenticatedPortalReducer(failed, { type: "submissionFailed", request: failedRequest, noticeKey: "profiles.updateError" });
  assert.equal(failed.profiles[0]?.name, profileA.name);
});

test("stale create, update and transition successes cannot modify a new Company", () => {
  for (const operation of ["create", "update", "transition"] as const) {
    let state = populated(); const mutationRequest = mutation(state, operation, 10,
      operation === "create" ? undefined : profileA.id);
    state = operation === "transition"
      ? authenticatedPortalReducer(state, { type: "transitionStarted", request: mutationRequest, target: "archived" })
      : authenticatedPortalReducer(state, { type: "submissionStarted", request: mutationRequest });
    state = authenticatedPortalReducer(state, { type: "companySelected", companyId: 2 });
    const response = operation === "create"
      ? authenticatedPortalReducer(state, { type: "profileCreated", request: mutationRequest, profile: profileA })
      : operation === "update"
        ? authenticatedPortalReducer(state, { type: "profileUpdated", request: mutationRequest, profile: { ...profileA, name: "Stale" } })
        : authenticatedPortalReducer(state, { type: "profileTransitioned", request: mutationRequest,
          profile: { ...profileA, status: "archived", archivedAt: profileA.updatedAt } });
    assert.equal(response, state); assert.equal(response.selectedCompanyId, 2);
    assert.equal(response.transientArchivedProfile, null); assert.equal(response.notice, null);
  }
});

test("stale mutation errors and 404s are no-ops and never request reload", () => {
  let state = populated(); const mutationRequest = mutation(state, "update", 20, profileA.id);
  state = authenticatedPortalReducer(state, { type: "submissionStarted", request: mutationRequest });
  state = authenticatedPortalReducer(state, { type: "companySelected", companyId: 2 });
  const failed = authenticatedPortalReducer(state, { type: "submissionFailed", request: mutationRequest, noticeKey: "profiles.updateError" });
  const notFound = authenticatedPortalReducer(state, { type: "profileMutationNotFound", request: mutationRequest });
  assert.equal(failed, state); assert.equal(notFound, state); assert.equal(notFound.profileReloadRequested, false);
});

test("form payload contains only supported fields and normalizes nullable values", () => {
  const values: AssistantProfileFormValues = { name: " Sales ", assistantLanguage: "en", description: " ", businessRole: " Advisor ",
    objective: " Help ", audience: "", tone: "professional", welcomeMessage: " Welcome ", fallbackMessage: " Safe " };
  const input = buildAssistantProfileInput(values, "create");
  assert.deepEqual(input, { name: "Sales", assistantLanguage: "en", description: null, businessRole: "Advisor",
    objective: "Help", audience: null, tone: "professional", welcomeMessage: "Welcome", fallbackMessage: "Safe" });
  assert.equal("status" in input, false); assert.equal("id" in input, false); assert.equal("normalizedName" in input, false);
});

test("archive stores a transient Profile and restore reintroduces draft", () => {
  const archived = { ...profileA, status: "archived" as const, archivedAt: profileA.updatedAt };
  let state = populated(); const archiveRequest = mutation(state, "transition", 1, profileA.id);
  state = authenticatedPortalReducer(state, { type: "transitionStarted", request: archiveRequest, target: "archived" });
  state = authenticatedPortalReducer(state, { type: "profileTransitioned", request: archiveRequest, profile: archived });
  assert.deepEqual(state.profiles, []); assert.equal(state.transientArchivedProfile?.id, profileA.id);
  const restoreRequest = mutation(state, "transition", 2, profileA.id);
  state = authenticatedPortalReducer(state, { type: "transitionStarted", request: restoreRequest, target: "draft" });
  state = authenticatedPortalReducer(state, { type: "profileTransitioned", request: restoreRequest, profile: profileA });
  assert.equal(state.profiles[0]?.status, "draft"); assert.equal(state.transientArchivedProfile, null);
});

test("lifecycle presentation exposes only plausible transitions", () => {
  assert.deepEqual(visibleTransitions("draft"), ["ready", "archived"]);
  assert.deepEqual(visibleTransitions("ready"), ["draft", "disabled", "archived"]);
  assert.deepEqual(visibleTransitions("disabled"), ["ready", "draft", "archived"]);
  assert.deepEqual(visibleTransitions("archived"), ["draft"]);
});

test("Ready guidance is advisory and excludes description and audience", () => {
  assert.deepEqual(missingReadyFields(profileA), []);
  const incomplete = { ...profileA, businessRole: null, objective: null, welcomeMessage: null };
  assert.deepEqual(missingReadyFields(incomplete), ["businessRole", "objective", "welcomeMessage"]);
  assert.equal(markReadyDisabled(incomplete, false), false);
  assert.equal(markReadyDisabled(incomplete, true), true);
  assert.equal(markReadyDisabled({ ...incomplete, status: "archived" }, false), true);
});

test("a transition conflict preserves Profile and status", () => {
  let state = populated(); const transitionRequest = mutation(state, "transition", 1, profileA.id);
  state = authenticatedPortalReducer(state, { type: "transitionStarted", request: transitionRequest, target: "ready" });
  state = authenticatedPortalReducer(state, { type: "transitionFailed", request: transitionRequest, noticeKey: "profiles.transitionConflict" });
  assert.equal(state.selectedProfileId, profileA.id); assert.equal(state.profiles[0]?.status, "draft");
});

test("logout clears all authenticated Portal context", () => {
  const state = authenticatedPortalReducer(populated(), { type: "logout" });
  assert.equal(state.selectedWorkspace, null); assert.deepEqual(state.companies, []); assert.deepEqual(state.profiles, []);
});

test("operational 401 retries a GET once after successful bootstrap recovery",async()=>{
  const originalFetch=globalThis.fetch;let calls=0,recoveries=0;
  globalThis.fetch=async()=>{calls+=1;return calls===1?new Response(JSON.stringify({error:"expired"}),{status:401,headers:{"content-type":"application/json"}}):new Response("[]",{status:200,headers:{"content-type":"application/json"}});};
  setAuthenticationRecovery(async method=>{recoveries+=1;assert.equal(method,"GET");return true;});
  try{assert.deepEqual(await atlasApi.listWorkspaces(),[]);assert.equal(calls,2);assert.equal(recoveries,1);}finally{setAuthenticationRecovery(null);globalThis.fetch=originalFetch;}
});

test("operational 401 rehydrates but never retries a non-idempotent mutation",async()=>{
  const originalFetch=globalThis.fetch;let calls=0,recoveries=0;
  globalThis.fetch=async()=>{calls+=1;return new Response(JSON.stringify({error:"expired"}),{status:401,headers:{"content-type":"application/json"}});};
  setAuthenticationRecovery(async method=>{recoveries+=1;assert.equal(method,"POST");return true;});
  try{await assert.rejects(()=>atlasApi.createWorkspace("csrf","Workspace"),(error:unknown)=>error instanceof ApiError&&error.status===401);assert.equal(calls,1);assert.equal(recoveries,1);}finally{setAuthenticationRecovery(null);globalThis.fetch=originalFetch;}
});

test("bootstrap uses an empty POST body, same-origin credentials and AbortSignal",async()=>{
  const originalFetch=globalThis.fetch;let captured:RequestInit|undefined;
  globalThis.fetch=async(_input,init)=>{captured=init;return new Response(JSON.stringify({status:"authenticated",identity:{userId:"usr",email:"a@example.com",locale:"en",status:"active",idleExpiresAt:"2026-07-17T00:00:00Z",absoluteExpiresAt:"2026-07-17T01:00:00Z"},csrfToken:"csrf",csrfGeneration:2}),{status:200,headers:{"content-type":"application/json"}});};
  const controller=new AbortController();try{const result=await atlasApi.bootstrapSession(controller.signal);assert.equal(result.csrfGeneration,2);assert.equal(captured?.method,"POST");assert.equal(captured?.body,"{}");assert.equal(captured?.credentials,"same-origin");assert.equal(captured?.signal,controller.signal);}finally{globalThis.fetch=originalFetch;}
});

test("Assistant Preview sends only the message with CSRF and never replays the POST",async()=>{
  const calls:Array<{url:string;init:RequestInit}> = [];
  setAuthenticationRecovery(async()=>true);
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(input),init:init??{}});return new Response(JSON.stringify({error:"expired"}),{status:401,headers:{"content-type":"application/json"}});}) as typeof fetch;
  await assert.rejects(()=>atlasApi.previewAssistantProfile("csrf","wsp_one",7,"asp_00000000000000000000000000000000","Hello"),ApiError);
  assert.equal(calls.length,1);
  assert.equal(calls[0]?.url,"/api/workspaces/wsp_one/companies/7/assistant-profiles/asp_00000000000000000000000000000000/preview");
  assert.equal(calls[0]?.init.method,"POST");
  assert.equal(calls[0]?.init.body,JSON.stringify({message:"Hello"}));
  assert.equal((calls[0]?.init.headers as Record<string,string>)["x-csrf-token"],"csrf");
  setAuthenticationRecovery(null);
});
