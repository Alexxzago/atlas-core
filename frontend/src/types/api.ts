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

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: string;
}

export interface Identity {
  userId: string;
  email: string;
  locale: string;
  status: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface SessionBootstrapResponse {
  status: "authenticated";
  identity: Identity;
  csrfToken: string;
  csrfGeneration: number;
}

export type AssistantProfileStatus = "draft" | "ready" | "disabled" | "archived";
export type AssistantTone = "professional" | "friendly" | "concise" | "empathetic";
export type AssistantLanguage = "es" | "en";

export interface AssistantProfile {
  id: string;
  name: string;
  description: string | null;
  businessRole: string | null;
  objective: string | null;
  audience: string | null;
  tone: AssistantTone;
  assistantLanguage: AssistantLanguage;
  welcomeMessage: string | null;
  fallbackMessage: string;
  status: AssistantProfileStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreateAssistantProfileInput {
  name: string;
  assistantLanguage: AssistantLanguage;
  description?: string | null;
  businessRole?: string | null;
  objective?: string | null;
  audience?: string | null;
  tone?: AssistantTone;
  welcomeMessage?: string | null;
  fallbackMessage?: string;
}

export type UpdateAssistantProfileInput = Partial<CreateAssistantProfileInput>;

export interface TransitionAssistantProfileInput {
  targetStatus: AssistantProfileStatus;
}

export interface AssistantPreviewResponse {
  status: "answered" | "safe_fallback";
  answer: string;
}
