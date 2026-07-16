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
};
