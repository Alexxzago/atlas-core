import type { AssistantPreviewResponse, AssistantProfile, AssistantProfileStatus, AssistantReadinessAssessment, ConversationControlResponse, ConversationDetail, ConversationInboxItem, DefaultAssistantAssignment, ChatResponse, Company, CompanyInput, CompanyKnowledge, CompanyUpdate, CreatedWorkspace, CreateAssistantProfileInput, CreateWhatsAppConnectionInput, UpdateWhatsAppConnectionInput, KnowledgeIngestionResponse, KnowledgePublication, KnowledgeRevision, KnowledgeSource, OnboardingCompanyResponse, OnboardingResponse, OperationalAssistantExecutionResponse, OperatorConversationMessageResult, PlatformOverview, PlatformWorkspacesPage, RegistrationInput, SessionBootstrapResponse, UpdateAssistantProfileInput, VerificationResponse, WebChatConnection, WebChatConnectionStatus, WhatsAppConnection, WhatsAppConnectionOperationalStatus, WorkspaceSummary } from "../types/api";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
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
    if(response.status===401&&!recoveryAttempted&&authenticationRecovery&&path!=="/identity/session/bootstrap"){
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
    throw new ApiError(response.status, message, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

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
    return { id: text(workspace.id, "Workspace list"), name: text(workspace.name, "Workspace list"), role: text(workspace.role, "Workspace list"), capabilities: workspace.capabilities as WorkspaceSummary["capabilities"] };
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
  createWorkspaceCompany:(csrf:string,workspaceId:string,input:CompanyInput,signal?:AbortSignal):Promise<Company>=>request(`/workspaces/${segment(workspaceId)}/companies`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null}),
  createOnboardingCompany:(csrf:string,workspaceId:string,name:string):Promise<OnboardingCompanyResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/onboarding`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({name})}),
  getWorkspaceCompany:async(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<Company>=>companyResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}`,{signal:signal??null})),
  listAssistantProfiles:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<AssistantProfile[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles`,{signal:signal??null}),
  getAssistantProfile:(workspaceId:string,companyId:number,profileId:string,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}`,{signal:signal??null}),
  createAssistantProfile:(csrf:string,workspaceId:string,companyId:number,input:CreateAssistantProfileInput,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null}),
  updateAssistantProfile:(csrf:string,workspaceId:string,companyId:number,profileId:string,input:UpdateAssistantProfileInput,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}`,{method:"PATCH",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null}),
  transitionAssistantProfile:(csrf:string,workspaceId:string,companyId:number,profileId:string,targetStatus:AssistantProfileStatus,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/transitions`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({targetStatus}),signal:signal??null}),
  previewAssistantProfile:(csrf:string,workspaceId:string,companyId:number,profileId:string,message:string,signal?:AbortSignal):Promise<AssistantPreviewResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/preview`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({message}),signal:signal??null}),
  executeAssistantProfile:async(csrf:string,workspaceId:string,companyId:number,profileId:string,message:string,signal?:AbortSignal):Promise<OperationalAssistantExecutionResponse>=>operationalExecutionResponse(await request<unknown>(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/executions`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({assistantProfileId:profileId,message}),signal:signal??null})),
  getAssistantReadiness:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<AssistantReadinessAssessment>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/readiness`,{signal:signal??null}),
  refreshAssistantReadiness:(csrf:string,workspaceId:string,companyId:number):Promise<AssistantReadinessAssessment>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/readiness/refresh`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  getDefaultAssistant:(workspaceId:string,companyId:number):Promise<DefaultAssistantAssignment>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/default`),
  setDefaultAssistant:(csrf:string,workspaceId:string,companyId:number,assistantProfileId:string,expectedVersion?:number):Promise<DefaultAssistantAssignment>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant/default`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify({assistantProfileId,...(expectedVersion===undefined?{}:{expectedVersion})})}),
  listWebChatConnections:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<WebChatConnection[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/web-chat-connections`,{signal:signal??null}),
  createWebChatConnection:(csrf:string,workspaceId:string,companyId:number,assistantProfileId:string):Promise<WebChatConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/web-chat-connections`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({assistantProfileId})}),
  updateWebChatConnectionStatus:(csrf:string,workspaceId:string,companyId:number,connectionId:string,status:WebChatConnectionStatus):Promise<WebChatConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/web-chat-connections/${segment(connectionId)}`,{method:"PATCH",headers:{"x-csrf-token":csrf},body:JSON.stringify({status})}),
  listWhatsAppConnections:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<WhatsAppConnection[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections`,{signal:signal??null}),
  createWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,input:CreateWhatsAppConnectionInput):Promise<WhatsAppConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input)}),
  updateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string,input:UpdateWhatsAppConnectionInput):Promise<WhatsAppConnection>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}`,{method:"PATCH",headers:{"x-csrf-token":csrf},body:JSON.stringify(input)}),
  getWhatsAppConnectionStatus:(workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/status`),
  configureWhatsAppCredentials:(csrf:string,workspaceId:string,companyId:number,connectionId:string,accessToken:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/credentials`,{method:"PUT",headers:{"x-csrf-token":csrf},body:JSON.stringify({accessToken})}),
  validateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/validation`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  activateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/activation`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  deactivateWhatsAppConnection:(csrf:string,workspaceId:string,companyId:number,connectionId:string):Promise<WhatsAppConnectionOperationalStatus>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/whatsapp-connections/${segment(connectionId)}/deactivation`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  listConversations:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<ConversationInboxItem[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations`,{signal:signal??null}),
  getConversation:(workspaceId:string,companyId:number,conversationId:string,signal?:AbortSignal):Promise<ConversationDetail>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}`,{signal:signal??null}),
  takeOverConversation:(csrf:string,workspaceId:string,companyId:number,conversationId:string,expectedVersion:number):Promise<ConversationControlResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/takeover`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedVersion})}),
  releaseConversation:(csrf:string,workspaceId:string,companyId:number,conversationId:string,expectedVersion:number):Promise<ConversationControlResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/release`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedVersion})}),
  resolveConversation:(csrf:string,workspaceId:string,companyId:number,conversationId:string,expectedVersion:number):Promise<ConversationControlResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/resolve`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({expectedVersion})}),
  sendConversationMessage:(csrf:string,workspaceId:string,companyId:number,conversationId:string,content:string,idempotencyKey:string):Promise<OperatorConversationMessageResult>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/conversations/${segment(conversationId)}/messages`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({content,idempotencyKey})}),
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
