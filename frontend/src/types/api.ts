export type CompanyStatus = "processing" | "ready" | "failed";

export interface Company {
  id: number;
  name: string;
  website: string;
  phone: string;
  email: string;
  status: CompanyStatus;
  createdAt: string;
}

export interface CompanyInput {
  name: string;
  website: string;
  phone?: string;
  email?: string;
}

export type CompanyUpdate = Partial<CompanyInput>;

export interface CompanyKnowledge {
  company: { name: string; website: string; phone: string; email: string };
  business: { services: string[]; hours: string; locations: string[] };
  faq: Array<{ question: string; answer: string }>;
}

export interface OnboardingResponse {
  companyId: number;
  status: "ready";
  knowledge: CompanyKnowledge;
}

export type ChatStatus = "answered" | "company_not_found" | "company_not_ready" | "knowledge_not_found" | "unavailable";

export interface ChatResponse {
  answer: string;
  status: ChatStatus;
}
