export type CompanyStatus = "processing" | "ready" | "failed";
export type CompanyLifecycle = "draft" | "configured" | "operational" | "attention_required" | "suspended" | "archived";

export interface Company {
  id: number;
  name: string;
  website: string | null;
  phone: string;
  email: string;
  status: CompanyStatus;
  lifecycle?: CompanyLifecycle;
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
  commercialStatus?: WorkspaceCommercialStatus;
}
export type Permission = "workspace:read"|"workspace:manage"|"company:read"|"company:manage"|"onboarding:run"|"chat:use"|"conversation:message:send"|"conversation:manage"|"assistant:preview"|"assistant:capability:manage"|"knowledge:read"|"knowledge:ingest"|"knowledge:publish"|"knowledge:archive"|"membership:list"|"membership:invite"|"membership:manage"|"administrator:manage"|"owner:manage"|"owner:transfer";

export type ConversationControlState = "automated" | "human_required" | "human_controlled";
export interface ConversationDelivery { state: "pending" | "leased" | "accepted" | "delivered" | "read" | "retryable" | "permanent_failure" | "uncertain"; updatedAt: string; safeErrorCategory: string | null; }
export interface ConversationInboxItem { conversationId: string; channel: "internal" | "web_chat" | "whatsapp"; state: "open" | "closed"; controlState: ConversationControlState; controlledByCurrentActor: boolean; attentionReason: string | null; takenAt: string | null; releasedAt: string | null; lastOperatorActivityAt: string | null; resolvedAt: string | null; controlVersion: number; updatedAt: string; contactLabel: string; participant: string | null; preview: string | null; deliveryCategory: "received" | "sent" | null; lastActivityAt: string; delivery: ConversationDelivery | null; unreadCount: number; }
export interface VoiceMessageReadModel { messageId:string; direction:"inbound"|"outbound"; modality:"audio"|"voice"; transcript:string|null; transcriptLanguageTag:string|null; transcriptionState:"pending"|"completed"|"failed"|"suppressed"|"unsupported"|null; deferredState:"processing"|"audio_ready"|"accepted"|"delivered"|"read"|"fallback"|"suppressed"|"uncertain"|"failed"|null; fallbackAvailable:boolean; playbackAvailable:boolean; }
export interface ConversationDetail extends ConversationInboxItem { messages: Array<{ messageId: string; senderRole: "customer" | "assistant" | "operator"; deliveryCategory: "received" | "sent"; content: string; createdAt: string; delivery: ConversationDelivery | null; voiceAvailable?: boolean }>; }
export interface ConversationInboxPage { items: ConversationInboxItem[]; nextCursor: string | null; }
export interface ConversationInboxFilters { controlState?: ConversationControlState | undefined; state?: "open" | "closed" | undefined; channel?: ConversationInboxItem["channel"] | undefined; unreadOnly?: boolean | undefined; }
export interface ConversationControlResponse { control: Pick<ConversationInboxItem, "controlState" | "controlledByCurrentActor" | "attentionReason" | "takenAt" | "releasedAt" | "lastOperatorActivityAt" | "resolvedAt" | "controlVersion" | "updatedAt">; outcome?: "resolved"; }
export interface ConversationFeedEvent { eventId: string; type: string; conversationId: string; occurredAt: string; controlVersion: number | null; authorityGeneration: number | null; relatedMessageId: string | null; }
export interface ConversationFeedResponse { events: ConversationFeedEvent[]; nextCursor: string; hasMore: boolean; resyncRequired: boolean; }
export interface OperatorConversationMessageResult { messageId: string; message: { messageId: string; content: string; createdAt: string }; delivery: { id: string; state: "pending" | "accepted" | "uncertain" }; }

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
  isPlatformAdmin: boolean;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}
export interface PlatformOverview { totalUsers:number; totalWorkspaces:number; totalCompanies:number; totalAssistantProfiles:number; webChatConnections:number; whatsAppConnections:{total:number;active:number;healthy:number;degraded:number}; }
export interface PlatformWorkspaceSummary { id:string; name:string; createdAt:string; memberCount:number; companyCount:number; assistantProfileCount:number; webChatConnectionCount:number; whatsApp:{total:number;active:number;healthy:number;degraded:number}; latestActivityAt:string|null; }
export interface PlatformWorkspacesPage { workspaces:PlatformWorkspaceSummary[]; nextCursor:string|null; }
export interface PlatformUserSummary { id:string; email:string; createdAt:string; emailVerified:boolean; activeWorkspaceMembershipCount:number; hasActiveWorkspaceMembership:boolean; }
export interface PlatformUsersPage { users:PlatformUserSummary[]; nextCursor:string|null; }
export type WorkspaceCommercialStatus = "active" | "suspended";
export interface PlatformWorkspaceCommercialUsage { companies:number; assistantProfiles:number; activeChannels:number; }
export interface PlatformWorkspaceCommercialControls { workspaceId:number; status:WorkspaceCommercialStatus; maxCompanies:number|null; maxAssistantProfiles:number|null; maxActiveChannels:number|null; usage:PlatformWorkspaceCommercialUsage; version:number; createdAt:string; updatedAt:string; suspendedAt:string|null; }
export interface PlatformUserCommercialUsage { ownedWorkspaces:number; }
export interface PlatformUserCommercialControls { userId:string; maxOwnedWorkspaces:number|null; usage:PlatformUserCommercialUsage; version:number; createdAt:string; updatedAt:string; }
export interface CommercialControlAuditEvent { id:string; actorUserId:string; subjectType:"user"|"workspace"; subjectId:string; eventType:string; oldValue:Record<string,unknown>; newValue:Record<string,unknown>; version:number; occurredAt:string; }

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

export type AssistantCapabilityAvailability = "available" | "unavailable" | "degraded";
export type AssistantCapabilityConsequence = "read_only" | "consequential";
export interface AssistantCapabilityCatalogItem { id:string; assigned:boolean; availability:AssistantCapabilityAvailability; consequence:AssistantCapabilityConsequence; safeReason:string|null; safeNextAction:string|null; toolCount:number; }
export interface AssistantCapabilityCatalog { capabilities:AssistantCapabilityCatalogItem[]; }
export type AssistantToolAvailability = "available" | "unavailable" | "degraded";
export interface AssistantToolCatalogItem { id:string; enabled:boolean; availability:AssistantToolAvailability; capabilityId:string; safeReason:string|null; safeNextAction:string|null; }
export interface AssistantToolCatalog { tools:AssistantToolCatalogItem[]; }
export type SchedulingReadiness = "not_configured" | "minimal" | "locally_configured";
export interface SchedulingLocation { id:string; name:string; address:string|null; timezone:string; active:boolean; created_at:string; updated_at:string; }
export interface SchedulingResource { id:string; location_id:string|null; name:string; timezone:string; capacity:number; active:boolean; created_at:string; updated_at:string; }
export interface SchedulingService { id:string; resource_id:string; name:string; duration_minutes:number; buffer_before_minutes:number; buffer_after_minutes:number; slot_granularity_minutes:number; minimum_lead_minutes:number; maximum_horizon_days:number; active:boolean; created_at:string; updated_at:string; }
export interface SchedulingWorkingWindow { id:string; resource_id:string; weekday:number; start_time:string; end_time:string; }
export interface SchedulingDateException { id:string; resource_id:string; local_date:string; kind:"open"|"closed"; start_time:string|null; end_time:string|null; }
export interface SchedulingConfiguration { aggregateVersion:number; locations:SchedulingLocation[]; resources:SchedulingResource[]; services:SchedulingService[]; weeklyWorkingWindows:SchedulingWorkingWindow[]; dateExceptions:SchedulingDateException[]; readiness:{state:SchedulingReadiness;hasLocations:boolean;hasResources:boolean;hasServices:boolean;hasWeeklyAvailability:boolean}; }

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
export type WhatsAppCredentialSource = "none" | "manual" | "meta_embedded";

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

export interface UpdateWhatsAppConnectionInput {
  assistantProfileId?: string;
  phoneNumberId?: string;
  whatsappBusinessAccountId?: string;
}

export interface WhatsAppConnectionOperationalStatus {
  connection: WhatsAppConnection;
  credentialsConfigured: boolean;
  credentialSource: WhatsAppCredentialSource;
  validationState: WhatsAppValidationState;
  validatedAt: string | null;
  validationFailureCode: string | null;
  healthState: WhatsAppHealthState;
  lastProviderActivityAt: string | null;
  lastWebhookActivityAt: string | null;
  healthFailureCode: string | null;
  updatedAt: string;
}

export type VoiceAudioResponseMode = "text_only" | "voice_with_text_fallback";

export interface WhatsAppVoicePolicy {
  voiceAiEnabled: boolean;
  audioResponseMode: VoiceAudioResponseMode;
  version: number;
}

export interface UpdateWhatsAppVoicePolicyInput {
  operationId: string;
  expectedVersion: number;
  voiceAiEnabled: boolean;
  audioResponseMode: VoiceAudioResponseMode;
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
export interface CompanyOperationalStatus {
  assistant: { status: "ready" | "blocked" | "unavailable"; evaluatedAt: string | null; blockers: string[] };
  whatsApp: Array<{ connectionId: string; status: "active" | "inactive"; validationState: "not_validated" | "valid" | "invalid"; healthState: "inactive" | "healthy" | "degraded" }>;
  voice: { status: "unavailable" };
}
export interface DefaultAssistantAssignment { companyId:number; assistantProfileId:string; version:number; assignedAt:string; updatedAt:string; assignedByActorId:string|null; source:string|null; }

export type EmbeddedSignupUiStatus="awaiting_meta"|"verifying"|"connected"|"needs_attention"|"reconnect_required"|"failed"|"expired";
export interface EmbeddedSignupPublicConfig{available:boolean;appId?:string;configId?:string;graphApiVersion?:string;}
export interface EmbeddedSignupAttemptResponse{attemptId?:string;state?:string;expiresAt?:string;status:EmbeddedSignupUiStatus|"starting";embeddedSignup:EmbeddedSignupPublicConfig;}
export interface EmbeddedSignupStatusResponse{attemptId:string;status:EmbeddedSignupUiStatus;expiresAt:string;safeFailureCode:string|null;retryable:boolean;reconnectRequired:boolean;whatsAppConnectionId?:string;kind?:string;}
