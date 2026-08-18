import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationId, ConversationMessage, ConversationMessageId } from "../../conversation/domain/conversation.js";
import type { ConversationFactSourceKind, ConversationIntelligenceState, ConversationValue } from "../domain/conversationIntelligence.js";

export type ConversationStateOperation =
  | { readonly kind: "set_fact"; readonly key: string; readonly value: ConversationValue }
  | { readonly kind: "remove_fact"; readonly key: string }
  | { readonly kind: "mark_pending"; readonly key: string; readonly askedAt: boolean }
  | { readonly kind: "resolve_pending"; readonly key: string }
  | { readonly kind: "set_active_intent"; readonly value: ConversationValue }
  | { readonly kind: "replace_reference_group"; readonly groupKind: string; readonly options: readonly { readonly referenceId: string; readonly label: string; readonly safePayload: ConversationValue }[] }
  | { readonly kind: "stale_reference_group"; readonly groupKind: string };
export interface ConversationStateDerivationPort { derive(input: { readonly state: ConversationIntelligenceState | null; readonly message: ConversationMessage }): Promise<readonly ConversationStateOperation[]>; }
export interface ConversationIntelligenceRepositoryPort {
  find(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationIntelligenceState | null;
  isApplied(context: WorkspaceContext, companyId: number, conversationId: ConversationId, messageId: ConversationMessageId): boolean;
  compareAndSet(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number | null, value: { readonly state: ConversationIntelligenceState; readonly appliedMessageId: ConversationMessageId; readonly sourceKind: ConversationFactSourceKind; readonly at: string }): ConversationIntelligenceState | null;
}

export type ConversationIntelligenceApplyResult =
  | { readonly kind: "applied"; readonly state: ConversationIntelligenceState }
  | { readonly kind: "skipped"; readonly reason: "conflict" | "derivation_unavailable" | "invalid_derivation"; readonly state: ConversationIntelligenceState | null };

export interface ConversationToolMemoryCandidate {
  readonly traceId: string;
  readonly value: ConversationValue;
  readonly facts: readonly { readonly key: string; readonly value: ConversationValue }[];
  readonly referenceGroups: readonly { readonly groupKind: string; readonly options: readonly { readonly referenceId: string; readonly label: string; readonly safePayload: ConversationValue }[] }[];
}

export type ConversationToolMemoryAppendResult =
  | { readonly kind: "appended"; readonly version: number }
  | { readonly kind: "already_applied"; readonly version: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "rejected" };

/** Persists only completed tool output that is owned by this conversation's execution trace. */
export interface ConversationToolMemoryRepositoryPort {
  findVersion(context: WorkspaceContext, companyId: number, conversationId: ConversationId): Promise<number | null>;
  append(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number, candidates: readonly ConversationToolMemoryCandidate[], at: string): Promise<ConversationToolMemoryAppendResult>;
}
