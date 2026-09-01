import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ProactiveAction, ProactiveActionLease, ProactiveActionPolicy, ProactiveActionState } from "../domain/proactiveAction.js";

export interface ProactiveActionRepositoryPort {
  findPolicy(context: WorkspaceContext, companyId: number): ProactiveActionPolicy | null;
  applyPolicy(context: WorkspaceContext, companyId: number, input: { readonly actorId: string; readonly operationId: string; readonly expectedVersion: number; readonly enabled: boolean; readonly occurredAt: string }): import("../../repositories/proactiveActionRepository.js").ProactivePolicyMutationResult;
  createAction(context: WorkspaceContext, companyId: number, input: { readonly id: string; readonly actorId: string; readonly operationId: string; readonly conversationId: string; readonly whatsAppConnectionId: string; readonly assistantProfileId: string; readonly assistantParticipantId: string; readonly runAt: string; readonly expectedAuthorityGeneration: number; readonly occurredAt: string }): import("../../repositories/proactiveActionRepository.js").ProactiveActionCreateResult;
  requestCancel(context: WorkspaceContext, companyId: number, actionId: string, input: { readonly actorId: string; readonly operationId: string; readonly expectedVersion: number; readonly occurredAt: string }): import("../../repositories/proactiveActionRepository.js").ProactiveActionCancelResult;
  resolveCreationScope(context: WorkspaceContext, companyId: number, conversationId: string): { readonly whatsAppConnectionId: string; readonly assistantProfileId: string; readonly assistantParticipantId: string; readonly authorityGeneration: number } | null;
  findAction(context: WorkspaceContext, companyId: number, actionId: string): ProactiveAction | null;
  listActions(context: WorkspaceContext, companyId: number, limit: number): readonly ProactiveAction[];
  latestCustomerInboundAt(context: WorkspaceContext, companyId: number, conversationId: string, whatsAppConnectionId: string): string | null;
  promoteDue(now: string, limit: number): readonly ProactiveAction[];
  claimDue(owner: string, now: string, expiresAt: string, limit: number): readonly ProactiveActionLease[];
  validateClaim(lease: ProactiveActionLease, now: string): "valid" | "suppressed" | "stale";
  scheduleRetry(lease: ProactiveActionLease, now: string, safeReasonCode: string): ProactiveAction | null;
  suppressClaim(lease: ProactiveActionLease, now: string, safeReasonCode: string): ProactiveAction | null;
  renewClaim(lease: ProactiveActionLease, now: string, expiresAt: string): boolean;
  failClaim(lease: ProactiveActionLease, now: string, safeReasonCode: string): ProactiveAction | null;
  selectCompletedExecution(context: WorkspaceContext, companyId: number, input: { readonly actionId: string; readonly executionRecordId: string; readonly leaseToken: string; readonly now: string }): ProactiveAction | null;
  findSelectedExecution(context: WorkspaceContext, companyId: number, actionId: string): { readonly action: ProactiveAction; readonly executionRecordId: string; readonly result: string } | null;
  materializeCompleted(now: string, limit: number): readonly ProactiveAction[];
  findVisibleAssistantMessages(context: WorkspaceContext, companyId: number, limit: number): readonly import("../../conversation/domain/conversation.js").ConversationMessage[];
  recoverableSemanticScopes(limit: number): readonly { readonly workspaceId: number; readonly companyId: number }[];
}
