import type { ChatResponse, Company, CompanyInput, CompanyKnowledge, CompanyUpdate, OnboardingResponse } from "../types/api";

export class ApiError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Use the HTTP status text when the response is not JSON.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
  requestCredentialEnrollment:(email:string):Promise<void>=>request("/identity/credential-enrollment/request",{method:"POST",body:JSON.stringify({email})}),
  completeCredentialEnrollment:(proof:string,password:string,confirmation:string):Promise<void>=>request("/identity/credential-enrollment/complete",{method:"POST",body:JSON.stringify({proof,password,confirmation})}),
  login:(email:string,password:string):Promise<{status:string;csrfToken:string}>=>request("/identity/login",{method:"POST",body:JSON.stringify({email,password})}),
  currentIdentity:():Promise<{userId:string;email:string;locale:string;status:string;workspaceAccess:"none";idleExpiresAt:string;absoluteExpiresAt:string}>=>request("/identity/me"),
  replacePassword:(csrf:string,currentPassword:string,newPassword:string,confirmation:string):Promise<void>=>request("/identity/password/replace",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({currentPassword,newPassword,confirmation})}),
  logout:(csrf:string):Promise<void>=>request("/identity/logout",{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  listWorkspaces:():Promise<Array<{id:string;name:string;role:string}>>=>request("/workspaces"),
  selectedWorkspace:():Promise<{id:string;name:string;role:string}|null>=>request("/workspaces/selected"),
  createWorkspace:(csrf:string,name:string):Promise<{workspace:{id:string;name:string}}>=>(request("/workspaces",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({name})})),
  selectWorkspace:(csrf:string,id:string):Promise<{id:string;name:string;role:string}>=>request(`/workspaces/${id}/select`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  listMemberships:(id:string):Promise<Array<{id:string;userId:string;role:string;status:string}>>=>request(`/workspaces/${id}/memberships`),
  listInvitations:(id:string):Promise<Array<{id:string;recipient:string;role:string;status:string;expiresAt:string}>>=>request(`/workspaces/${id}/invitations`),
  inviteMember:(csrf:string,id:string,email:string,role:string):Promise<void>=>request(`/workspaces/${id}/invitations`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({email,role})}),
  acceptInvitation:(csrf:string,proof:string):Promise<void>=>request("/workspaces/invitations/accept",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({proof})}),
  rejectInvitation:(csrf:string,proof:string):Promise<void>=>request("/workspaces/invitations/reject",{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({proof})}),
  leaveWorkspace:(csrf:string,id:string):Promise<void>=>request(`/workspaces/${id}/leave`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  revokeInvitation:(csrf:string,workspaceId:string,invitationId:string):Promise<void>=>request(`/workspaces/${workspaceId}/invitations/${invitationId}/revoke`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  changeMembershipRole:(csrf:string,workspaceId:string,membershipId:string,role:string):Promise<void>=>request(`/workspaces/${workspaceId}/memberships/${membershipId}/role`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({role})}),
  changeMembershipStatus:(csrf:string,workspaceId:string,membershipId:string,action:"suspend"|"reactivate"|"remove"):Promise<void>=>request(`/workspaces/${workspaceId}/memberships/${membershipId}/${action}`,{method:"POST",headers:{"x-csrf-token":csrf},body:"{}"}),
  transferOwnership:(csrf:string,workspaceId:string,targetMembershipId:string,actorRole:string):Promise<void>=>request(`/workspaces/${workspaceId}/transfer-ownership`,{method:"POST",headers:{"x-csrf-token":csrf},body:JSON.stringify({targetMembershipId,actorRole})}),
};
