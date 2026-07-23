import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { Conversation, ConversationId, ConversationMessage, ConversationMessageId, ConversationParticipant, ConversationParticipantId } from "../domain/conversation.js";

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
  findParticipant(context: WorkspaceContext, companyId: number, participantId: ConversationParticipantId): ConversationParticipant | null;
}
