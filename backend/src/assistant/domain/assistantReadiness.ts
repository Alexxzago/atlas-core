import type { AssistantProfile } from "./assistantProfile.js";
import { AssistantProfileExecutionPolicy } from "./assistantProfilePolicies.js";

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

export interface AssistantReadinessFacts {
  readonly id: string;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly knowledge: { readonly id: string; readonly snapshotDigest: string } | null;
  readonly readyProfileCount: number;
  readonly assignmentProfileId: string | null;
  readonly selectedProfile: AssistantProfile | null;
  readonly whatsApp: {
    readonly requestedConnectionId: string | null;
    readonly connection: { readonly id: string; readonly assistantProfileId: string; readonly updatedAt: string } | null;
    readonly hasCredentials: boolean;
    readonly validationState: "not_validated" | "valid" | "invalid" | null;
  };
  readonly evaluatedAt: string;
  readonly configurationDigest: string;
}

/**
 * Evaluates only supplied persisted facts. It performs no repository writes or provider calls.
 */
export function assessAssistantReadiness(facts: AssistantReadinessFacts): AssistantReadinessAssessment {
  const blockers: AssistantReadinessBlocker[] = [];
  if (!facts.knowledge) blockers.push("published_knowledge_missing");
  if (!facts.assignmentProfileId) blockers.push(facts.readyProfileCount > 1 ? "default_assistant_ambiguous" : "default_assistant_missing");
  if (facts.assignmentProfileId && !facts.selectedProfile) blockers.push("default_assistant_not_found");
  if (facts.selectedProfile) {
    try { new AssistantProfileExecutionPolicy().assert(facts.selectedProfile); }
    catch { blockers.push("default_assistant_not_executable"); }
  }
  const whatsApp = facts.whatsApp;
  if (whatsApp.requestedConnectionId) {
    if (!whatsApp.connection || !facts.selectedProfile || whatsApp.connection.assistantProfileId !== facts.selectedProfile.id) blockers.push("whatsapp_connection_inconsistent");
    if (!whatsApp.connection) blockers.push("whatsapp_connection_missing");
    else {
      if (!whatsApp.hasCredentials) blockers.push("whatsapp_credentials_missing");
      if (whatsApp.validationState !== "valid") blockers.push("whatsapp_validation_missing");
    }
  }
  const ordered = [...new Set(blockers)].sort() as AssistantReadinessBlocker[];
  return Object.freeze({
    id: facts.id,
    assistantIdentifier: defaultAssistantIdentifier,
    workspaceId: facts.workspaceId,
    companyId: facts.companyId,
    status: ordered.length === 0 ? "ready" : "blocked",
    blockers: Object.freeze(ordered),
    knowledgeVersionId: facts.knowledge?.id ?? null,
    assistantProfileId: facts.selectedProfile?.id ?? null,
    whatsAppConnectionId: whatsApp.connection?.id ?? whatsApp.requestedConnectionId,
    policyVersion: assistantReadinessPolicyVersion,
    configurationDigest: facts.configurationDigest,
    evaluatedAt: facts.evaluatedAt,
  });
}
