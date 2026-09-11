import type { AssistantCapabilityCatalog, AssistantToolCatalog, EmbeddedSignupAttemptResponse, EmbeddedSignupStatusResponse, AssistantPreviewResponse, AssistantProfile, AssistantProfileStatus, AssistantReadinessAssessment, CommercialControlAuditEvent, CompanyOperationalStatus, ConversationControlResponse, ConversationDetail, ConversationFeedResponse, ConversationInboxFilters, ConversationInboxItem, ConversationInboxPage, DefaultAssistantAssignment, ChatResponse, Company, CompanyInput, CompanyKnowledge, CompanyUpdate, CreatedWorkspace, CreateAssistantProfileInput, CreateWhatsAppConnectionInput, UpdateWhatsAppConnectionInput, UpdateWhatsAppVoicePolicyInput, KnowledgeIngestionResponse, KnowledgePublication, KnowledgeRevision, KnowledgeSource, OnboardingCompanyResponse, OnboardingResponse, OperationalAssistantExecutionResponse, OperatorConversationMessageResult, PlatformOverview, PlatformUserCommercialControls, PlatformUsersPage, PlatformWorkspaceCommercialControls, PlatformWorkspacesPage, RegistrationInput, SessionBootstrapResponse, UpdateAssistantProfileInput, VerificationResponse, VoiceMessageReadModel, WebChatConnection, WebChatConnectionStatus, WhatsAppConnection, WhatsAppConnectionOperationalStatus, WhatsAppVoicePolicy, WorkspaceCommercialStatus, WorkspaceSummary } from "../types/api";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public readonly retryAfterSeconds: number | null;

  public constructor(status: number, message: string, code: string | null = null, retryAfterSeconds: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type AuthenticationRecovery = (method: string) => Promise<boolean>;
let authenticationRecovery: AuthenticationRecovery | null = null;
const apiBaseUrl = (import.meta.env?.VITE_ATLAS_API_BASE_URL ?? "/api").replace(/\/$/, "");

type JsonRecord = Record<string, unknown>;

export function setAuthenticationRecovery(recovery: AuthenticationRecovery | null): void {
  authenticationRecovery = recovery;
}

async function request<T>(path: string, options?: RequestInit, recoveryAttempted = false): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const method=(options?.method??"GET").toUpperCase();
    const tenantNonDisclosure=response.status===404&&isTenantNonDisclosure(path,await response.clone().json().catch(()=>null));
    if((response.status===401||tenantNonDisclosure)&&!recoveryAttempted&&authenticationRecovery&&path!=="/identity/session/bootstrap"){
      const recovered=await authenticationRecovery(method);
      if(recovered&&(method==="GET"||method==="HEAD"))return request<T>(path,options,true);
    }
    let message = response.statusText;
    let code: string | null = null;
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
      else if (typeof body.error === "object" && body.error !== null) {
        const detail = body.error as { code?: unknown; message?: unknown };
        if (typeof detail.message === "string") message = detail.message;
        if (typeof detail.code === "string") code = detail.code;
      }
    } catch {
      // Use the HTTP status text when the response is not JSON.
    }
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter !== null && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : null;
    throw new ApiError(response.status, message, code, retryAfterSeconds);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function isTenantNonDisclosure(path:string,body:unknown):boolean{return /^\/workspaces\/[^/?]+(?:\/|$)/.test(path)&&!!body&&typeof body==="object"&&!Array.isArray(body)&&(body as {error?:unknown}).error==="Resource not found.";}

function segment(value: string | number): string { return encodeURIComponent(String(value)); }

function malformedList(label: string): ApiError { return new ApiError(502, `${label} response is temporarily unavailable.`); }
function record(value: unknown, label: string): JsonRecord { if (!value || typeof value !== "object" || Array.isArray(value)) throw malformedList(label); return value as JsonRecord; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0) throw malformedList(label); return value; }
function string(value: unknown, label: string): string { if (typeof value !== "string") throw malformedList(label); return value; }
function nullableText(value: unknown, label: string): string | null { if (value !== null && typeof value !== "string") throw malformedList(label); return value; }

function workspaceListResponse(value: unknown): WorkspaceSummary[] {
  if (!Array.isArray(value)) throw malformedList("Workspace list");
  return value.map((item) => {
    const workspace = record(item, "Workspace list");
    if (!Array.isArray(workspace.capabilities) || !workspace.capabilities.every((capability) => typeof capability === "string")) throw malformedList("Workspace list");
    const commercialStatus = workspace.commercialStatus;
    if (commercialStatus !== undefined && commercialStatus !== "active" && commercialStatus !== "suspended") throw malformedList("Workspace list");
    return { id: text(workspace.id, "Workspace list"), name: text(workspace.name, "Workspace list"), role: text(workspace.role, "Workspace list"), capabilities: workspace.capabilities as WorkspaceSummary["capabilities"], ...(commercialStatus === undefined ? {} : { commercialStatus: commercialStatus as WorkspaceCommercialStatus }) };
  });
}

function companyLifecycle(value: unknown): NonNullable<Company["lifecycle"]> {
  if (value === "draft" || value === "configured" || value === "operational" || value === "attention_required" || value === "suspended" || value === "archived") return value;
  throw malformedList("Company list");
}

function companyStatus(lifecycle: NonNullable<Company["lifecycle"]>): Company["status"] {
  if (lifecycle === "attention_required" || lifecycle === "suspended" || lifecycle === "archived") return "failed";
  return lifecycle === "operational" ? "ready" : "processing";
}

function coreCompanyResponse(value: unknown): Company {
  const company = record(value, "Company");
  if (!Number.isSafeInteger(company.id) || (company.id as number) < 1) throw malformedList("Company");
  const lifecycle = companyLifecycle(company.lifecycle);
  return { id: company.id as number, name: text(company.name, "Company"), website: nullableText(company.website, "Company"), phone: "", email: "", status: companyStatus(lifecycle), lifecycle, createdAt: text(company.createdAt, "Company") };
}

function legacyCompanyResponse(value: unknown): Company {
  const company = record(value, "Company");
  if (!Number.isSafeInteger(company.id) || (company.id as number) < 1 || (company.status !== "processing" && company.status !== "ready" && company.status !== "failed")) throw malformedList("Company");
  return { id: company.id as number, name: text(company.name, "Company"), website: nullableText(company.website, "Company"), phone: string(company.phone, "Company"), email: string(company.email, "Company"), status: company.status, createdAt: text(company.createdAt, "Company") };
}

function companyResponse(value: unknown): Company {
  const response = record(value, "Company");
  const company = "data" in response ? record(response.data, "Company") : response;
  return "lifecycle" in company ? coreCompanyResponse(company) : legacyCompanyResponse(company);
}

function companyListResponse(value: unknown): Company[] {
  if (Array.isArray(value)) return value.map(legacyCompanyResponse);
  const envelope = record(value, "Company list");
  if (!Array.isArray(envelope.data)) throw malformedList("Company list");
  return envelope.data.map(coreCompanyResponse);
}

function operationalExecutionResponse(value: unknown): OperationalAssistantExecutionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, "Assistant execution is temporarily unavailable.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || (record.status !== "answered" && record.status !== "safe_fallback") || typeof record.answer !== "string" || Array.from(record.answer).length > 2_000) throw new ApiError(502, "Assistant execution is temporarily unavailable.");
  return { status: record.status, answer: record.answer };
}

function assistantProfileResponse(value: unknown): AssistantProfile {
  const profile = record(value, "Assistant profile");
  const status = profile.status, tone = profile.tone, language = profile.assistantLanguage;
  if ((status !== "draft" && status !== "ready" && status !== "disabled" && status !== "archived") || (tone !== "professional" && tone !== "friendly" && tone !== "concise" && tone !== "empathetic") || (language !== "es" && language !== "en")) throw malformedList("Assistant profile");
  return { id: text(profile.id, "Assistant profile"), name: text(profile.name, "Assistant profile"), description: nullableText(profile.description, "Assistant profile"), businessRole: nullableText(profile.businessRole, "Assistant profile"), objective: nullableText(profile.objective, "Assistant profile"), audience: nullableText(profile.audience, "Assistant profile"), tone, assistantLanguage: language, welcomeMessage: nullableText(profile.welcomeMessage, "Assistant profile"), fallbackMessage: text(profile.fallbackMessage, "Assistant profile"), status, createdAt: text(profile.createdAt, "Assistant profile"), updatedAt: text(profile.updatedAt, "Assistant profile"), archivedAt: nullableText(profile.archivedAt, "Assistant profile") };
}

function assistantProfilesResponse(value: unknown): AssistantProfile[] { if (!Array.isArray(value)) throw malformedList("Assistant profile list"); return value.map(assistantProfileResponse); }
function assistantCapabilityCatalogResponse(value:unknown):AssistantCapabilityCatalog { const envelope=record(value,"Assistant capability catalog"); if(Object.keys(envelope).length!==1||!Array.isArray(envelope.capabilities))throw malformedList("Assistant capability catalog"); return {capabilities:envelope.capabilities.map(item=>{const capability=record(item,"Assistant capability catalog"),toolCount=capability.toolCount;if(Object.keys(capability).length!==7||typeof capability.id!=="string"||typeof capability.assigned!=="boolean"||(capability.availability!=="available"&&capability.availability!=="unavailable"&&capability.availability!=="degraded")||(capability.consequence!=="read_only"&&capability.consequence!=="consequential")||(capability.safeReason!==null&&typeof capability.safeReason!=="string")||(capability.safeNextAction!==null&&typeof capability.safeNextAction!=="string")||typeof toolCount!=="number"||!Number.isSafeInteger(toolCount)||toolCount<0)throw malformedList("Assistant capability catalog");return{id:capability.id,assigned:capability.assigned,availability:capability.availability,consequence:capability.consequence,safeReason:capability.safeReason,safeNextAction:capability.safeNextAction,toolCount};})}; }
function assistantToolCatalogResponse(value:unknown):AssistantToolCatalog { const envelope=record(value,"Assistant tool catalog"); if(Object.keys(envelope).length!==1||!Array.isArray(envelope.tools))throw malformedList("Assistant tool catalog"); return {tools:envelope.tools.map(item=>{const tool=record(item,"Assistant tool catalog");if(Object.keys(tool).length!==6||typeof tool.id!=="string"||tool.id.length===0||typeof tool.enabled!=="boolean"||(tool.availability!=="available"&&tool.availability!=="unavailable"&&tool.availability!=="degraded")||typeof tool.capabilityId!=="string"||tool.capabilityId.length===0||(tool.safeReason!==null&&typeof tool.safeReason!=="string")||(tool.safeNextAction!==null&&typeof tool.safeNextAction!=="string"))throw malformedList("Assistant tool catalog");return{id:tool.id,enabled:tool.enabled,availability:tool.availability,capabilityId:tool.capabilityId,safeReason:tool.safeReason,safeNextAction:tool.safeNextAction};})}; }
function defaultAssistantResponse(value: unknown): DefaultAssistantAssignment { const assignment = record(value, "Default assistant"), version = assignment.version; if (!Number.isSafeInteger(assignment.companyId) || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || (assignment.source !== "operator" && assignment.source !== "compatibility_bootstrap" && assignment.source !== null)) throw malformedList("Default assistant"); return { companyId: assignment.companyId as number, assistantProfileId: text(assignment.assistantProfileId, "Default assistant"), version, assignedAt: text(assignment.assignedAt, "Default assistant"), updatedAt: text(assignment.updatedAt, "Default assistant"), assignedByActorId: nullableText(assignment.assignedByActorId, "Default assistant"), source: assignment.source }; }
function safeCodes(value: unknown, label: string): string[] { if (!Array.isArray(value) || !value.every(item => typeof item === "string" && item.length > 0 && item.length <= 120 && /^[a-z0-9_]+$/u.test(item))) throw malformedList(label); return value as string[]; }
function timestamp(value: unknown, label: string): string { const result = text(value, label); if (!Number.isFinite(Date.parse(result))) throw malformedList(label); return result; }
function assistantReadinessResponse(value: unknown): AssistantReadinessAssessment { const assessment = record(value, "Assistant readiness"); if (Object.keys(assessment).length !== 10 || assessment.assistantIdentifier !== "default" || (assessment.status !== "ready" && assessment.status !== "blocked") || !Number.isSafeInteger(assessment.workspaceId) || !Number.isSafeInteger(assessment.companyId)) throw malformedList("Assistant readiness"); return { assistantIdentifier: "default", workspaceId: assessment.workspaceId as number, companyId: assessment.companyId as number, status: assessment.status, blockers: safeCodes(assessment.blockers, "Assistant readiness"), knowledgeVersionId: nullableText(assessment.knowledgeVersionId, "Assistant readiness"), assistantProfileId: nullableText(assessment.assistantProfileId, "Assistant readiness"), evaluatedAt: timestamp(assessment.evaluatedAt, "Assistant readiness"), policyVersion: text(assessment.policyVersion, "Assistant readiness"), configurationDigest: text(assessment.configurationDigest, "Assistant readiness") }; }
function companyOperationalStatusResponse(value: unknown): CompanyOperationalStatus { const status = record(value, "Operational status"); if (Object.keys(status).length !== 3) throw malformedList("Operational status"); const assistant = record(status.assistant, "Operational status"), voice = record(status.voice, "Operational status"); if (Object.keys(assistant).length !== 3 || (assistant.status !== "ready" && assistant.status !== "blocked" && assistant.status !== "unavailable") || (assistant.evaluatedAt !== null && !Number.isFinite(Date.parse(String(assistant.evaluatedAt)))) || voice.status !== "unavailable" || Object.keys(voice).length !== 1 || !Array.isArray(status.whatsApp)) throw malformedList("Operational status"); return { assistant: { status: assistant.status, evaluatedAt: assistant.evaluatedAt === null ? null : String(assistant.evaluatedAt), blockers: safeCodes(assistant.blockers, "Operational status") }, whatsApp: status.whatsApp.map(item => { const connection = record(item, "Operational status"); if (Object.keys(connection).length !== 4 || typeof connection.connectionId !== "string" || connection.connectionId.length === 0 || (connection.status !== "active" && connection.status !== "inactive") || (connection.validationState !== "not_validated" && connection.validationState !== "valid" && connection.validationState !== "invalid") || (connection.healthState !== "inactive" && connection.healthState !== "healthy" && connection.healthState !== "degraded")) throw malformedList("Operational status"); return { connectionId: connection.connectionId, status: connection.status, validationState: connection.validationState, healthState: connection.healthState }; }), voice: { status: "unavailable" } }; }

export const atlasApi = {
  listCompanies: (): Promise<Company[]> => request("/companies"),
  getCompany: (companyId: number): Promise<Company> => request(`/companies/${companyId}`),
  createCompany: (input: CompanyInput): Promise<Company> => request("/companies", { method: "POST", body: JSON.stringify(input) }),
  updateCompany: (companyId: number, input: CompanyUpdate): Promise<Company> => request(`/companies/${companyId}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteCompany: (companyId: number): Promise<void> => request(`/companies/${companyId}`, { method: "DELETE" }),
  onboardCompany: (companyId: number, url: string): Promise<OnboardingResponse> => request(`/companies/${companyId}/onboard`, { method: "POST", body: JSON.stringify({ url }) }),
  chat: (companyId: number, message: string): Promise<ChatResponse> => request("/chat", { method: "POST", body: JSON.stringify({ companyId, message }) }),
  getKnowledge: (companyId: number): Promise<CompanyKnowledge> => request(`/knowledge?companyId=${companyId}`),
  register: (input: RegistrationInput): Promise<{ status: "verification_requested" }> => request("/identity/register", { method: "POST", body: JSON.stringify(input) }),
  resendVerification: (email: string, locale: "en" | "es"): Promise<{ status: "verification_requested" }> => request("/identity/resend-verification", { method: "POST", body: JSON.stringify({ email, locale }) }),
  verifyEmail: async (proof: string): Promise<VerificationResponse> => {
    try { return await request(`/identity/verify-email?proof=${segment(proof)}`); }
    catch (error: unknown) { if (error instanceof ApiError && error.status === 400) return { status: "invalid_or_expired" }; throw error; }
  },
  requestPasswordReset:(email:string,locale:"en"|"es"):Promise<{status:"password_reset_requested"}>=>request("/identity/password-reset/request",{method:"POST",body:JSON.stringify({email,locale})}),
  completePasswordReset:(proof:string,password:string,confirmation:string):Promise<void>=>request("/identity/password-reset/complete",{method:"POST",body:JSON.stringify({proof,password,confirmation})}),
  requestCredentialEnrollment:(email:string):Promise<void>=>request("/identity/credential-enrollment/request",{method:"POST",body:JSON.stringify({email})}),
  completeCredentialEnrollment:(proof:string,password:string,confirmation:string):Promise<void>=>request("/identity/credential-enrollment/complete",{method:"POST",body:JSON.stringify({proof,password,confirmation})}),
  login:(email:string,password:string):Promise<{status:string;csrfToken:string;csrfGeneration:number}>=>request("/identity/login",{method:"POST",body:JSON.stringify({email,password})}),
  bootstrapSession:(signal?:AbortSignal):Promise<SessionBootstrapResponse>=>request("/identity/session/bootstrap",{method:"POST",body:"{}",signal:signal??null}),
  currentIdentity:():Promise<{userId:string;email:string;locale:string;status:string;isPlatformAdmin:boolean;workspaceAccess:"none";idleExpiresAt:string;absoluteExpiresAt:string}>=>request("/identity/me"),
  platformOverview:async():Promise<PlatformOverview>=>{const response=await request<{data:PlatformOverview}>("/admin/overview");return response.data;},
  platformWorkspaces:async(cursor?:string):Promise<PlatformWorkspacesPage>=>{const response=await request<{data:PlatformWorkspacesPage}>(`/admin/workspaces?limit=25${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);return response.data;},
  platformUsers:async(cursor?:string):Promise<PlatformUsersPage>=>{const response=await request<{data:PlatformUsersPage}>(`/admin/users?limit=25${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);return response.data;},
  platformWorkspaceCommercialControls:async(id:string):Promise<PlatformWorkspaceCommercialControls>=>{const response=await request<{data:PlatformWorkspaceCommercialControls}>(`/admin/workspaces/${segment(id)}/commercial-controls`);return response.data;},
  platformWorkspaceCommercialAudit:async(id:string):Promise<CommercialControlAuditEvent[]>=>{const response=await request<{data:CommercialControlAuditEvent[]}>(`/admin/workspaces/${segment(id)}/commercial-controls/audit`);return response.data;},
  updatePlatformWorkspaceCommercialLimits:async(csrf:string,id:string,input:{expectedVersion:number;maxCompanies:number|null;maxAssistantProfiles:number|null;maxActiveChannels:number|null}):Promise<PlatformWorkspaceCommercialControls>=>{const response=await request<{data:PlatformWorkspaceCommercialControls}>(`/admin/workspaces/${segment(id)}/commercial-controls/limits`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify(input)});return response.data;},
  setPlatformWorkspaceCommercialStatus:async(csrf:string,id:string,action:"suspend"|"reactivate",expectedVersion:number):Promise<PlatformWorkspaceCommercialControls>=>{const response=await request<{data:PlatformWorkspaceCommercialControls}>(`/admin/workspaces/${segment(id)}/commercial-controls/${action}`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedVersion})});return response.data;},
  platformUserCommercialControls:async(id:string):Promise<PlatformUserCommercialControls>=>{const response=await request<{data:PlatformUserCommercialControls}>(`/admin/users/${segment(id)}/commercial-controls`);return response.data;},
  platformUserCommercialAudit:async(id:string):Promise<CommercialControlAuditEvent[]>=>{const response=await request<{data:CommercialControlAuditEvent[]}>(`/admin/users/${segment(id)}/commercial-controls/audit`);return response.data;},
  updatePlatformUserOwnedWorkspaceAllowance:async(csrf:string,id:string,maxOwnedWorkspaces:number|null,expectedVersion:number):Promise<PlatformUserCommercialControls>=>{const response=await request<{data:PlatformUserCommercialControls}>(`/admin/users/${segment(id)}/commercial-controls`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify({maxOwnedWorkspaces,expectedVersion})});return response.data;},
  replacePassword:(csrf:string,currentPassword:string,newPassword:string,confirmation:string):Promise<void>=>request("/identity/password/replace",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({currentPassword,newPassword,confirmation})}),
  logout:(csrf:string):Promise<void>=>request("/identity/logout",{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"},true),
  listWorkspaces:async():Promise<WorkspaceSummary[]>=>workspaceListResponse(await request<unknown>("/workspaces")),
  selectedWorkspace:():Promise<WorkspaceSummary|null>=>request("/workspaces/selected"),
  createWorkspace:(csrf:string,name:string,timezone?:string,defaultLocale?:"en"|"es"):Promise<CreatedWorkspace>=>(request("/workspaces",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({name,...(timezone?{timezone}:{}),...(defaultLocale?{defaultLocale}:{})})})),
  selectWorkspace:(csrf:string,id:string,signal?:AbortSignal):Promise<WorkspaceSummary>=>request(`/workspaces/${segment(id)}/select`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}",signal:signal??null}),
  listMemberships:(id:string,signal?:AbortSignal):Promise<Array<{id:string;userId:string;role:string;status:string}>>=>request(`/workspaces/${id}/memberships`,{signal:signal??null}),
  listInvitations:(id:string,signal?:AbortSignal):Promise<Array<{id:string;recipient:string;role:string;status:string;expiresAt:string}>>=>request(`/workspaces/${id}/invitations`,{signal:signal??null}),
  inviteMember:(csrf:string,id:string,email:string,role:string):Promise<void>=>request(`/workspaces/${id}/invitations`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({email,role})}),
  acceptInvitation:(csrf:string,proof:string):Promise<void>=>request("/workspaces/invitations/accept",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({proof})}),
  rejectInvitation:(csrf:string,proof:string):Promise<void>=>request("/workspaces/invitations/reject",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({proof})}),
  leaveWorkspace:(csrf:string,id:string):Promise<void>=>request(`/workspaces/${id}/leave`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  revokeInvitation:(csrf:string,workspaceId:string,invitationId:string):Promise<void>=>request(`/workspaces/${workspaceId}/invitations/${invitationId}/revoke`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  changeMembershipRole:(csrf:string,workspaceId:string,membershipId:string,role:string):Promise<void>=>request(`/workspaces/${workspaceId}/memberships/${membershipId}/role`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({role})}),
  changeMembershipStatus:(csrf:string,workspaceId:string,membershipId:string,action:"suspend"|"reactivate"|"remove"):Promise<void>=>request(`/workspaces/${workspaceId}/memberships/${membershipId}/${action}`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  transferOwnership:(csrf:string,workspaceId:string,targetMembershipId:string,actorRole:string):Promise<void>=>request(`/workspaces/${workspaceId}/transfer-ownership`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({targetMembershipId,actorRole})}),
  listWorkspaceCompanies:async(workspaceId:string,signal?:AbortSignal):Promise<Company[]>=>companyListResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies`,{signal:signal??null})),
  createOnboardingCompany:async(csrf:string,workspaceId:string,input:{readonly name:string;readonly website?:string|null},signal?:AbortSignal):Promise<Company>=>companyResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/onboarding`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null})),
  getWorkspaceCompany:async(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<Company>=>companyResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}`,{signal:signal??null})),
  listAssistantProfiles:async(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<AssistantProfile[]>=>assistantProfilesResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles`,{signal:signal??null})),
  getAssistantProfile:async(workspaceId:string,companyId:number,profileId:string,signal?:AbortSignal):Promise<AssistantProfile>=>assistantProfileResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}`,{signal:signal??null})),
  createAssistantProfile:async(csrf:string,workspaceId:string,companyId:number,input:CreateAssistantProfileInput,signal?:AbortSignal):Promise<AssistantProfile>=>assistantProfileResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null})),
  updateAssistantProfile:async(csrf:string,workspaceId:string,companyId:number,profileId:string,input:UpdateAssistantProfileInput,signal?:AbortSignal):Promise<AssistantProfile>=>assistantProfileResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}`,{method:"PATCH",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null})),
  transitionAssistantProfile:async(csrf:string,workspaceId:string,companyId:number,profileId:string,targetStatus:AssistantProfileStatus,signal?:AbortSignal):Promise<AssistantProfile>=>assistantProfileResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/transitions`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({targetStatus}),signal:signal??null})),
  previewAssistantProfile:async(csrf:string,workspaceId:string,companyId:number,profileId:string,message:string,signal?:AbortSignal):Promise<AssistantPreviewResponse>=>operationalExecutionResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/preview`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({message}),signal:signal??null})),
  getAssistantCapabilityCatalog:async(workspaceId:string,companyId:number,profileId:string,signal?:AbortSignal):Promise<AssistantCapabilityCatalog>=>assistantCapabilityCatalogResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/capabilities/catalog`,{signal:signal??null})),
  getAssistantToolCatalog:async(workspaceId:string,companyId:number,profileId:string,signal?:AbortSignal):Promise<AssistantToolCatalog>=>assistantToolCatalogResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/tools/catalog`,{signal:signal??null})),
  replaceAssistantCapabilities:async(csrf:string,workspaceId:string,companyId:number,profileId:string,capabilities:string[]):Promise<string[]>=>{const response=record(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/capabilities`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify({capabilities})}),"Assistant capabilities");if(Object.keys(response).length!==1||!Array.isArray(response.capabilities)||!response.capabilities.every(value=>typeof value==="string"))throw malformedList("Assistant capabilities");return response.capabilities as string[];},
  executeAssistantProfile:async(csrf:string,workspaceId:string,companyId:number,profileId:string,message:string,signal?:AbortSignal):Promise<OperationalAssistantExecutionResponse>=>operationalExecutionResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/executions`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({assistantProfileId:profileId,message}),signal:signal??null})),
  getAssistantReadiness:async(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<AssistantReadinessAssessment>=>assistantReadinessResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/readiness`,{signal:signal??null})),
  refreshAssistantReadiness:async(csrf:string,workspaceId:string,companyId:number,signal?:AbortSignal):Promise<AssistantReadinessAssessment>=>assistantReadinessResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/readiness/refresh`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}",signal:signal??null})),
  getCompanyOperationalStatus:async(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<CompanyOperationalStatus>=>companyOperationalStatusResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/operational-status`,{signal:signal??null})),
  getDefaultAssistant:async(workspaceId:string,companyId:number):Promise<DefaultAssistantAssignment>=>defaultAssistantResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/default`)),
  setDefaultAssistant:async(csrf:string,workspaceId:string,companyId:number,assistantProfileId:string,expectedVersion?:number):Promise<DefaultAssistantAssignment>=>defaultAssistantResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/default`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify({assistantProfileId,...(expectedVersion===undefined?{}:{expectedVersion})})})),
  listWebChatConnections:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<WebChatConnection[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/web-chat-connections`,{signal:signal??null}),
  createWebChatConnection:(csrf:string,workspaceId:string,companyId:number,assistantProfileId:string):Promise<WebChatConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/web-chat-connections`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({assistantProfileId})}),
  updateWebChatConnectionStatus:(csrf:string,workspaceId:string,companyId:number,connectionId:string,status:WebChatConnectionStatus):Promise<WebChatConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/web-chat-connections/${segment(connectionId)}`,{method:"PATCH",headers:{"x-csrf-token":csrf},body:JSON.stringify({status})}),
  startEmbeddedSignup:(csrf:string,w:string,c:number,assistantProfileId:string):Promise<EmbeddedSignupAttemptResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/whatsapp/embedded-signup/attempts`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({assistantProfileId})}),
  getEmbeddedSignupStatus:(w:string,c:number,id:string):Promise<EmbeddedSignupStatusResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/whatsapp/embedded-signup/attempts/${segment(id)}`),
  completeEmbeddedSignup:(csrf:string,w:string,c:number,id:string,input:Record<string,unknown>):Promise<EmbeddedSignupStatusResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/whatsapp/embedded-signup/attempts/${segment(id)}/complete`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input)}),
  reconnectEmbeddedSignup:(csrf:string,w:string,c:number,whatsAppConnectionId:string):Promise<EmbeddedSignupAttemptResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/whatsapp/embedded-signup/reconnect`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({whatsAppConnectionId})}),
  listWhatsAppConnections:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<WhatsAppConnection[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections`,{signal:signal??null}),
  createWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,input:CreateWhatsAppConnectionInput):Promise<WhatsAppConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input)}),
  updateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string,input:UpdateWhatsAppConnectionInput):Promise<WhatsAppConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}`,{method:"PATCH",headers:{"x-csrf-token":csrf},body:JSON.stringify(input)}),
  getWhatsAppConnectionStatus:(workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/status`),
  configureWhatsAppCredentials:(csrf:string,workspaceId:string,companyId:number,connectionId:string,accessToken:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/credentials`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify({accessToken})}),
  validateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/validation`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  activateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/activation`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  deactivateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/deactivation`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  getWhatsAppVoicePolicy:(workspaceId:string,companyId:number,connectionId:string,signal?:AbortSignal):Promise<WhatsAppVoicePolicy>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/voice-policy`,{signal:signal??null}),
  updateWhatsAppVoicePolicy:(csrf:string,workspaceId:string,companyId:number,connectionId:string,input:UpdateWhatsAppVoicePolicyInput,signal?:AbortSignal):Promise<WhatsAppVoicePolicy>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/voice-policy`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null}),
   listConversations:(workspaceId:string,companyId:number,filters:ConversationInboxFilters={},cursor?:string,signal?:AbortSignal):Promise<ConversationInboxPage>=>{const query=new URLSearchParams();if(filters.controlState)query.set("controlState",filters.controlState);if(filters.state)query.set("state",filters.state);if(filters.channel)query.set("channel",filters.channel);if(filters.unreadOnly)query.set("unreadOnly","true");if(cursor)query.set("cursor",cursor);const suffix=query.size?`?${query}`:"";return request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations${suffix}`,{signal:signal??null});},
  getConversation:(workspaceId:string,companyId:number,conversationId:string,signal?:AbortSignal):Promise<ConversationDetail>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}`,{signal:signal??null}),
  getConversationFeed:(workspaceId:string,companyId:number,after?:string,limit?:number,signal?:AbortSignal):Promise<ConversationFeedResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/feed${after===undefined?"":`?after=${encodeURIComponent(after)}${limit===undefined?"":`&limit=${limit}`}`}`,{signal:signal??null}),
  getVoiceMessage:(workspaceId:string,companyId:number,conversationId:string,messageId:string,signal?:AbortSignal):Promise<VoiceMessageReadModel>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/messages/${segment(messageId)}/voice`,{signal:signal??null}),
  voicePlaybackUrl:(workspaceId:string,companyId:number,conversationId:string,messageId:string):string=>`${apiBaseUrl}/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/messages/${segment(messageId)}/voice/playback`,
  takeOverConversation:(csrf:string,workspaceId:string,companyId:number,conversationId:string,expectedVersion:number,operationId:string,signal?:AbortSignal):Promise<ConversationControlResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/takeover`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedVersion,operationId}),signal:signal??null}),
  releaseConversation:(csrf:string,workspaceId:string,companyId:number,conversationId:string,expectedVersion:number,operationId:string,signal?:AbortSignal):Promise<ConversationControlResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/release`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedVersion,operationId}),signal:signal??null}),
  resolveConversation:(csrf:string,workspaceId:string,companyId:number,conversationId:string,expectedVersion:number,operationId:string,signal?:AbortSignal):Promise<ConversationControlResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/resolve`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedVersion,operationId}),signal:signal??null}),
   sendConversationMessage:(csrf:string,workspaceId:string,companyId:number,conversationId:string,content:string,idempotencyKey:string):Promise<OperatorConversationMessageResult>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/messages`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({content,idempotencyKey})}),
   markConversationRead:(csrf:string,workspaceId:string,companyId:number,conversationId:string):Promise<void>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/read`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  listKnowledgeSources:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<KnowledgeSource[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/knowledge/sources`,{signal:signal??null}),
  getKnowledgeRevision:(workspaceId:string,companyId:number,sourceId:string,revisionId:string,signal?:AbortSignal):Promise<KnowledgeRevision>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/knowledge/sources/${segment(sourceId)}/revisions/${segment(revisionId)}`,{signal:signal??null}),
  getKnowledgePublication:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<KnowledgePublication>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/knowledge/publication`,{signal:signal??null}),
  createManualKnowledge:(csrf:string,w:string,c:number,name:string,text:string,signal?:AbortSignal):Promise<KnowledgeIngestionResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/sources/manual`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({name,text}),signal:signal??null}),
  createUrlKnowledge:(csrf:string,w:string,c:number,name:string,url:string,signal?:AbortSignal):Promise<KnowledgeIngestionResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/sources/url`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({name,url}),signal:signal??null}),
  createPdfKnowledge:(csrf:string,w:string,c:number,name:string,file:File,signal?:AbortSignal):Promise<KnowledgeIngestionResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/sources/pdf?name=${segment(name)}`,{method:"POST",headers:{"x-csrf-token":csrf,"content-type":"application/pdf"},body:file,signal:signal??null}),
  reviseManualKnowledge:(csrf:string,w:string,c:number,s:string,version:number,text:string,signal?:AbortSignal):Promise<KnowledgeIngestionResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/sources/${segment(s)}/revisions/manual`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedSourceVersion:version,text}),signal:signal??null}),
  reviseUrlKnowledge:(csrf:string,w:string,c:number,s:string,version:number,url:string,signal?:AbortSignal):Promise<KnowledgeIngestionResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/sources/${segment(s)}/revisions/url`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedSourceVersion:version,url}),signal:signal??null}),
  revisePdfKnowledge:(csrf:string,w:string,c:number,s:string,version:number,file:File,signal?:AbortSignal):Promise<KnowledgeIngestionResponse>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/sources/${segment(s)}/revisions/pdf?expectedSourceVersion=${segment(version)}`,{method:"POST",headers:{"x-csrf-token":csrf,"content-type":"application/pdf"},body:file,signal:signal??null}),
  archiveKnowledgeSource:(csrf:string,w:string,c:number,s:string,expectedSourceVersion:number,signal?:AbortSignal):Promise<KnowledgeSource>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/sources/${segment(s)}/archive`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedSourceVersion}),signal:signal??null}),
  publishKnowledge:(csrf:string,w:string,c:number,ids:string[],expectedKnowledgeVersionId:string|null,signal?:AbortSignal):Promise<KnowledgePublication>=>request(`/workspaces/${segment(w)}/companies/${segment(c)}/knowledge/publication`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({sourceRevisionIds:ids,expectedKnowledgeVersionId}),signal:signal??null}),
};
