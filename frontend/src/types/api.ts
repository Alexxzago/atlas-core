export type CompanyStatus = "processing" | "ready" | "failed";

export interface Company {
  id: number;
  name: string;
  website: string | null;
  phone: string;
  email: string;
  status: CompanyStatus;
  createdAt: string;
}

export interface CompanyInput {
  name: string;
  website?: string | null;
  phone?: string;
  email?: string;
}

export type CompanyUpdate = Partial<CompanyInput>;

export interface CompanyKnowledge {
  company: { name: string; website: string | null; phone: string; email: string };
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
  capabilities: Permission[];
}
export type Permission = "workspace:read"|"workspace:manage"|"company:read"|"company:manage"|"onboarding:run"|"chat:use"|"conversation:message:send"|"conversation:manage"|"assistant:preview"|"knowledge:read"|"knowledge:ingest"|"knowledge:publish"|"knowledge:archive"|"membership:list"|"membership:invite"|"membership:manage"|"administrator:manage"|"owner:manage"|"owner:transfer";

export type ConversationControlState = "automated" | "human_required" | "human_controlled";
export interface ConversationDelivery { state: "pending" | "leased" | "accepted" | "delivered" | "read" | "retryable" | "permanent_failure" | "uncertain"; updatedAt: string; safeErrorCategory: string | null; }
export interface ConversationInboxItem { conversationId: string; channel: "internal" | "web_chat" | "whatsapp"; state: "open" | "closed"; controlState: ConversationControlState; attentionReason: string | null; takenAt: string | null; releasedAt: string | null; lastOperatorActivityAt: string | null; resolvedAt: string | null; controlVersion: number; updatedAt: string; participant: string | null; preview: string | null; deliveryCategory: "received" | "sent" | null; lastActivityAt: string; delivery: ConversationDelivery | null; }
export interface ConversationDetail extends ConversationInboxItem { messages: Array<{ messageId: string; participant: string; deliveryCategory: "received" | "sent"; content: string; createdAt: string; delivery: ConversationDelivery | null }>; }
export interface ConversationControlResponse { control: Pick<ConversationInboxItem, "controlState" | "attentionReason" | "takenAt" | "releasedAt" | "lastOperatorActivityAt" | "resolvedAt" | "controlVersion" | "updatedAt">; outcome?: "resolved"; }
export interface OperatorConversationMessageResult { messageId: string; delivery: { id: string; state: "pending" | "accepted" | "uncertain" }; }

export type KnowledgeSourceKind="manual_text"|"public_url"|"pdf";
export interface KnowledgeRevision { id:string;sourceId:string;revisionNumber:number;status:"pending"|"ready"|"failed";mediaType:string;normalizedText:string|null;extractedKnowledge:{services:string[];hours:string;locations:string[];faq:Array<{question:string;answer:string}>}|null;failureCode:string|null;createdAt:string;completedAt:string|null; }
export interface KnowledgeSource { id:string;companyId:number;kind:KnowledgeSourceKind;name:string;locator:string|null;status:"active"|"archived";version:number;createdAt:string;updatedAt:string;archivedAt:string|null;latestRevision:KnowledgeRevision|null;includedRevisionId:string|null; }
export interface KnowledgeIngestionResponse { source:KnowledgeSource;revision:KnowledgeRevision; }
export interface KnowledgePublication { id:string;companyId:number;versionNumber:number;publicationVersion:number;knowledge:CompanyKnowledge;snapshotDigest:string;publishedByActorId:string;publishedAt:string;sourceRevisionIds:string[]; }

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
export interface CreatedWorkspace { workspace: { id: string; name: string; timezone: string | null; defaultLocale: Locale | null }; membership: { id: string; role: string; status: string }; }
export interface OnboardingCompanyResponse { data: { id: number }; }

export interface RegistrationInput { fullName: string; email: string; password: string; confirmation: string; locale: Locale; }
export type Locale = "en" | "es";
export interface VerificationResponse { status: "verified" | "invalid_or_expired"; nextStep?: "login"; }

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

export interface OperationalAssistantExecutionResponse {
  status: "answered" | "safe_fallback";
  answer: string;
}

export type WebChatConnectionStatus = "active" | "inactive";

export interface WebChatConnection {
  id: string;
  publicId: string;
  assistantProfileId: string;
  status: WebChatConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export type WhatsAppConnectionStatus = "active" | "inactive";
export type WhatsAppValidationState = "not_validated" | "valid" | "invalid";
export type WhatsAppHealthState = "inactive" | "healthy" | "degraded";

export interface WhatsAppConnection {
  id: string;
  assistantProfileId: string;
  phoneNumberId: string;
  whatsappBusinessAccountId: string;
  status: WhatsAppConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWhatsAppConnectionInput {
  assistantProfileId: string;
  phoneNumberId: string;
  whatsappBusinessAccountId: string;
}

export interface WhatsAppConnectionOperationalStatus {
  connection: WhatsAppConnection;
  credentialsConfigured: boolean;
  validationState: WhatsAppValidationState;
  validatedAt: string | null;
  validationFailureCode: string | null;
  healthState: WhatsAppHealthState;
  lastProviderActivityAt: string | null;
  lastWebhookActivityAt: string | null;
  healthFailureCode: string | null;
  updatedAt: string;
}

export type AssistantReadinessStatus = "ready" | "blocked";
export interface AssistantReadinessAssessment {
  assistantIdentifier: "default";
  workspaceId: number;
  companyId: number;
  status: AssistantReadinessStatus;
  blockers: string[];
  knowledgeVersionId: string | null;
  assistantProfileId: string | null;
  evaluatedAt: string;
  policyVersion: string;
  configurationDigest: string;
}
export interface DefaultAssistantAssignment { companyId:number; assistantProfileId:string; version:number; assignedAt:string; updatedAt:string; assignedByActorId:string|null; source:string|null; }
