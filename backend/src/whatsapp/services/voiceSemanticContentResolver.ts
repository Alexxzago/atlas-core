import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationMessage } from "../../conversation/domain/conversation.js";
import type { VoiceRepositoryPort } from "../application/voicePorts.js";

export class VoiceSemanticContentUnavailableError extends Error { public constructor() { super("Voice semantic content is unavailable."); } }

export function resolveVoiceSemanticContent(repository: Pick<VoiceRepositoryPort, "findTranscriptByMessage">, context: WorkspaceContext, companyId: number, messageId: string, originalContent: string): string {
  return repository.findTranscriptByMessage(context, companyId, messageId)?.normalizedTranscript ?? originalContent;
}

export function resolveVoiceSemanticMessage(repository: Pick<VoiceRepositoryPort, "findTranscriptByMessage" | "isVoiceInboundMessage">, context: WorkspaceContext, companyId: number, message: ConversationMessage): ConversationMessage {
  if (message.direction === "inbound" && repository.isVoiceInboundMessage(context, companyId, message.id) && repository.findTranscriptByMessage(context, companyId, message.id) === null) throw new VoiceSemanticContentUnavailableError();
  const content = message.direction === "inbound" ? resolveVoiceSemanticContent(repository, context, companyId, message.id, message.content) : message.content;
  return content === message.content ? message : Object.freeze({ ...message, content });
}

export function includeVoiceSemanticHistory(repository: Pick<VoiceRepositoryPort, "isAssistantMessageSemanticallyVisible">, context: WorkspaceContext, companyId: number, message: ConversationMessage): boolean {
  return message.direction === "inbound" || repository.isAssistantMessageSemanticallyVisible(context, companyId, message.id);
}
