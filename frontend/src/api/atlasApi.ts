import type { AssistantPreviewResponse, AssistantProfile, AssistantProfileStatus, ChatResponse, Company, CompanyInput, CompanyKnowledge, CompanyUpdate, CreateAssistantProfileInput, OnboardingResponse, SessionBootstrapResponse, UpdateAssistantProfileInput, WorkspaceSummary } from "../types/api";

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

export function setAuthenticationRecovery(recovery: AuthenticationRecovery | null): void {
  authenticationRecovery = recovery;
}

async function request<T>(path: string, options?: RequestInit, recoveryAttempted = false): Promise<T> {
  const response = await fetch(`/api${path}`, {
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

export const atlasApi = {
  listCompanies: (): Promise<Company[]> => request("/companies"),
  getCompany: (companyId: number): Promise<Company> => request(`/companies/${companyId}`),
  createCompany: (input: CompanyInput): Promise<Company> => request("/companies", { method: "POST", body: JSON.stringify(input) }),
  updateCompany: (companyId: number, input: CompanyUpdate): Promise<Company> => request(`/companies/${companyId}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteCompany: (companyId: number): Promise<void> => request(`/companies/${companyId}`, { method: "DELETE" }),
  onboardCompany: (companyId: number, url: string): Promise<OnboardingResponse> => request(`/companies/${companyId}/onboard`, { method: "POST", body: JSON.stringify({ url }) }),
  chat: (companyId: number, message: string): Promise<ChatResponse> => request("/chat", { method: "POST", body: JSON.stringify({ companyId, message }) }),
  getKnowledge: (companyId: number): Promise<CompanyKnowledge> => request(`/knowledge?companyId=${companyId}`),
  requestCredentialEnrollment:(email:string):Promise<void>=>request("/identity/credential-enrollment/request",{method:"POST",body:JSON.stringify({email})}),
  completeCredentialEnrollment:(proof:string,password:string,confirmation:string):Promise<void>=>request("/identity/credential-enrollment/complete",{method:"POST",body:JSON.stringify({proof,password,confirmation})}),
  login:(email:string,password:string):Promise<{status:string;csrfToken:string;csrfGeneration:number}>=>request("/identity/login",{method:"POST",body:JSON.stringify({email,password})}),
  bootstrapSession:(signal?:AbortSignal):Promise<SessionBootstrapResponse>=>request("/identity/session/bootstrap",{method:"POST",body:"{}",signal:signal??null}),
  currentIdentity:():Promise<{userId:string;email:string;locale:string;status:string;workspaceAccess:"none";idleExpiresAt:string;absoluteExpiresAt:string}>=>request("/identity/me"),
  replacePassword:(csrf:string,currentPassword:string,newPassword:string,confirmation:string):Promise<void>=>request("/identity/password/replace",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({currentPassword,newPassword,confirmation})}),
  logout:(csrf:string):Promise<void>=>request("/identity/logout",{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"},true),
  listWorkspaces:():Promise<WorkspaceSummary[]>=>request("/workspaces"),
  selectedWorkspace:():Promise<WorkspaceSummary|null>=>request("/workspaces/selected"),
  createWorkspace:(csrf:string,name:string):Promise<{workspace:{id:string;name:string}}>=>(request("/workspaces",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({name})})),
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
  listWorkspaceCompanies:(workspaceId:string,signal?:AbortSignal):Promise<Company[]>=>request(`/workspaces/${segment(workspaceId)}/companies`,{signal:signal??null}),
  createWorkspaceCompany:(csrf:string,workspaceId:string,input:CompanyInput,signal?:AbortSignal):Promise<Company>=>request(`/workspaces/${segment(workspaceId)}/companies`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null}),
  getWorkspaceCompany:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<Company>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}`,{signal:signal??null}),
  listAssistantProfiles:(workspaceId:string,companyId:number,signal?:AbortSignal):Promise<AssistantProfile[]>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles`,{signal:signal??null}),
  getAssistantProfile:(workspaceId:string,companyId:number,profileId:string,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}`,{signal:signal??null}),
  createAssistantProfile:(csrf:string,workspaceId:string,companyId:number,input:CreateAssistantProfileInput,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null}),
  updateAssistantProfile:(csrf:string,workspaceId:string,companyId:number,profileId:string,input:UpdateAssistantProfileInput,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}`,{method:"PATCH",headers:{"x-csrf-token":csrf},body:JSON.stringify(input),signal:signal??null}),
  transitionAssistantProfile:(csrf:string,workspaceId:string,companyId:number,profileId:string,targetStatus:AssistantProfileStatus,signal?:AbortSignal):Promise<AssistantProfile>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/transitions`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({targetStatus}),signal:signal??null}),
  previewAssistantProfile:(csrf:string,workspaceId:string,companyId:number,profileId:string,message:string,signal?:AbortSignal):Promise<AssistantPreviewResponse>=>request(`/workspaces/${segment(workspaceId)}/companies/${segment(companyId)}/assistant-profiles/${segment(profileId)}/preview`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({message}),signal:signal??null}),
};
