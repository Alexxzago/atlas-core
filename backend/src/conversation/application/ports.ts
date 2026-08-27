import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { UserId } from "../../identity/domain/user.js";
import type { Conversation, ConversationId, ConversationMessage, ConversationMessageId, ConversationParticipant, ConversationParticipantId } from "../domain/conversation.js";
import type { ConversationControl, ConversationDetailProjection, ConversationInboxProjection } from "../domain/conversationControl.js";
import type { ConversationControlAtomicCommand, ConversationControlAtomicResult } from "../domain/conversationAuthority.js";

export interface ConversationEventFeedEntry { readonly sequence: number; readonly eventId: string; readonly conversationId: ConversationId; readonly type: string; readonly controlVersion: number | null; readonly authorityGeneration: number | null; readonly relatedMessageId: string | null; readonly occurredAt: string; }

export type OperatorMessagePersistenceResult =
  | { readonly kind: "created" | "replayed"; readonly message: ConversationMessage; readonly deliveryId: string }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "idempotency_mismatch" };

export type AssistantResponseFinalizationResult =
  | { readonly kind: "finalized" | "replayed"; readonly message: ConversationMessage }
  | { readonly kind: "authority_lost" }
  | { readonly kind: "not_found" }
  | { readonly kind: "execution_not_owned" };

export interface ConversationRepositoryPort {
  hasCompany(context: WorkspaceContext, companyId: number): boolean;
  findConversation(context: WorkspaceContext, companyId: number, conversationId: ConversationId): Conversation | null;
  listConversations(context: WorkspaceContext, companyId: number): Conversation[];
  createConversation(context: WorkspaceContext, conversation: Conversation): Conversation | null;
  updateConversation(context: WorkspaceContext, companyId: number, conversation: Conversation, expectedState: "open"): boolean;
  createParticipant(context: WorkspaceContext, companyId: number, participant: ConversationParticipant): ConversationParticipant | null;
  listParticipants(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationParticipant[];
  createMessage(context: WorkspaceContext, companyId: number, message: ConversationMessage): ConversationMessage | null;
  listMessages(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationMessage[];
  findMessage(context: WorkspaceContext, companyId: number, messageId: ConversationMessageId): ConversationMessage | null;
  findMessageByIdempotencyKey(context: WorkspaceContext, companyId: number, conversationId: ConversationId, idempotencyKey: string): ConversationMessage | null;
  findParticipant(context: WorkspaceContext, companyId: number, participantId: ConversationParticipantId): ConversationParticipant | null;
  ensureConversationControl(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationControl | null;
  findConversationControl(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationControl | null;
  updateConversationControl(context: WorkspaceContext, companyId: number, control: ConversationControl, expectedVersion: number): ConversationControl | null;
  applyConversationControlOperation(context: WorkspaceContext, companyId: number, conversationId: ConversationId, command: ConversationControlAtomicCommand): ConversationControlAtomicResult;
  persistOperatorMessage(context: WorkspaceContext, companyId: number, conversationId: ConversationId, actorId: UserId, content: string, idempotencyKey: string, whatsAppConnectionId: string, occurredAt: string): OperatorMessagePersistenceResult;
  finalizeAssistantResponse(context: WorkspaceContext, companyId: number, conversationId: ConversationId, inboundMessageId: ConversationMessageId, outboundParticipantId: ConversationParticipantId, executionRecordId: string, authorityGeneration: number, content: string, idempotencyKey: string, occurredAt: string, whatsAppConnectionId: string | null): AssistantResponseFinalizationResult;
  updateConversationOperatorActivity(context: WorkspaceContext, companyId: number, conversationId: ConversationId, actorId: UserId, activityAt: string, updatedAt: string): ConversationControl | null;
  updateConversationResolution(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number, resolvedAt: string, resolvedBy: string, updatedAt: string): ConversationControl | null;
  clearConversationResolution(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number, updatedAt: string): ConversationControl | null;
  listConversationInbox(context: WorkspaceContext, companyId: number): ConversationInboxProjection[];
  findConversationDetail(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationDetailProjection | null;
  isConversationControlledBy(context: WorkspaceContext, companyId: number, conversationId: ConversationId, actorId: UserId): boolean;
  conversationEventTail(context: WorkspaceContext, companyId: number): number;
  listConversationEventsAfter(context: WorkspaceContext, companyId: number, afterSequence: number, limit: number): readonly ConversationEventFeedEntry[];
}
