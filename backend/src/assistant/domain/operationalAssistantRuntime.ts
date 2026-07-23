import type { AssistantProfile, AssistantProfileId, AssistantLanguage, AssistantTone } from "./assistantProfile.js";
import type { CompanyKnowledgeVersion } from "../../knowledge/domain/knowledge.js";

export type AssistantExecutionRecordId = string & { readonly __brand: "AssistantExecutionRecordId" };
export type AssistantRuntimePurpose = "preview" | "operational_execution";
export type AssistantExecutionRecordState = "started" | "answered" | "safe_fallback" | "failed";

export interface AssistantProfileRuntimeSnapshot {
  readonly profileId: AssistantProfileId;
  readonly businessRole: string;
  readonly objective: string;
  readonly audience: string | null;
  readonly tone: AssistantTone;
  readonly assistantLanguage: AssistantLanguage;
  readonly fallbackMessage: string;
}

export interface PublishedKnowledgeSnapshotReference {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly snapshotDigest: string;
}

export interface AssistantExecutionRecord {
  readonly id: AssistantExecutionRecordId;
  readonly companyId: number;
  readonly profileId: AssistantProfileId;
  readonly profileSnapshot: AssistantProfileRuntimeSnapshot;
  readonly knowledgeSnapshot: PublishedKnowledgeSnapshotReference;
  readonly provider: string;
  readonly purpose: AssistantRuntimePurpose;
  readonly state: AssistantExecutionRecordState;
  readonly fallbackUsed: boolean;
  readonly result: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly errorCode: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMilliseconds: number | null;
}

export class OperationalAssistantRuntimeDomainError extends Error {}

export function createProfileRuntimeSnapshot(profile: AssistantProfile): AssistantProfileRuntimeSnapshot {
  if (!profile.businessRole || !profile.objective) throw new OperationalAssistantRuntimeDomainError("Assistant Profile is not executable.");
  return Object.freeze({
    profileId: profile.id,
    businessRole: profile.businessRole,
    objective: profile.objective,
    audience: profile.audience,
    tone: profile.tone,
    assistantLanguage: profile.assistantLanguage,
    fallbackMessage: profile.fallbackMessage,
  });
}

export function createPublishedKnowledgeSnapshotReference(version: CompanyKnowledgeVersion): PublishedKnowledgeSnapshotReference {
  return Object.freeze({ versionId: version.id, versionNumber: version.versionNumber, snapshotDigest: version.snapshotDigest });
}

export function assistantExecutionRecordId(value: string): AssistantExecutionRecordId {
  if (!/^aex_[0-9a-f]{32}$/.test(value)) throw new OperationalAssistantRuntimeDomainError("Assistant execution record ID is invalid.");
  return value as AssistantExecutionRecordId;
}
