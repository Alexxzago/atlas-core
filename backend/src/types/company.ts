export type CompanyStatus = "processing" | "ready" | "failed";

export interface Company {
  id: number;
  workspaceId: number;
  name: string;
  website: string;
  phone: string;
  email: string;
  status: CompanyStatus;
  createdAt: string;
}

export interface CompanyCreateInput {
  name: string;
  website: string;
  phone?: string;
  email?: string;
  status?: CompanyStatus;
}

export interface CompanyPersistenceInput {
  name: string;
  website: string;
  phone: string;
  email: string;
  status: CompanyStatus;
}
