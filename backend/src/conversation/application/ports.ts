import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { Conversation, ConversationId, ConversationMessage, ConversationMessageId, ConversationParticipant, ConversationParticipantId } from "../domain/conversation.js";
import type { ConversationControl, ConversationDetailProjection, ConversationInboxProjection } from "../domain/conversationControl.js";

export interface ConversationRepositoryPort {
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
  updateConversationResolution(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number, resolvedAt: string, resolvedBy: string, updatedAt: string): ConversationControl | null;
  clearConversationResolution(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number, updatedAt: string): ConversationControl | null;
  listConversationInbox(context: WorkspaceContext, companyId: number): ConversationInboxProjection[];
  findConversationDetail(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationDetailProjection | null;
}
