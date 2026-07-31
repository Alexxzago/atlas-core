export const assistantReadinessPolicyVersion = "assistant-readiness-v1";
export const defaultAssistantIdentifier = "default";

export type AssistantReadinessStatus = "ready" | "blocked";
export type AssistantReadinessBlocker = "published_knowledge_missing" | "default_assistant_missing" | "default_assistant_ambiguous" | "default_assistant_not_found" | "default_assistant_not_executable" | "default_assistant_wrong_tenant" | "whatsapp_connection_missing" | "whatsapp_connection_inconsistent" | "whatsapp_credentials_missing" | "whatsapp_validation_missing";

export interface AssistantReadinessAssessment {
  readonly id: string;
  readonly assistantIdentifier: typeof defaultAssistantIdentifier;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly status: AssistantReadinessStatus;
  readonly blockers: readonly AssistantReadinessBlocker[];
  readonly knowledgeVersionId: string | null;
  readonly assistantProfileId: string | null;
  readonly whatsAppConnectionId: string | null;
  readonly policyVersion: typeof assistantReadinessPolicyVersion;
  readonly configurationDigest: string;
  readonly evaluatedAt: string;
}
