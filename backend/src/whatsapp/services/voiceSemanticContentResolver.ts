import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationMessage } from "../../conversation/domain/conversation.js";
import type { AsyncVoiceLookupPort, VoiceRepositoryPort } from "../application/voicePorts.js";

export class VoiceSemanticContentUnavailableError extends Error { public constructor() { super("Voice semantic content is unavailable."); } }

export async function resolveVoiceSemanticContent(repository: Pick<AsyncVoiceLookupPort, "findTranscriptByMessage"> | Pick<VoiceRepositoryPort, "findTranscriptByMessage">, context: WorkspaceContext, companyId: number, messageId: string, originalContent: string): Promise<string> {
  return (await repository.findTranscriptByMessage(context, companyId, messageId))?.normalizedTranscript ?? originalContent;
}

export async function resolveVoiceSemanticMessage(repository: Pick<AsyncVoiceLookupPort, "findTranscriptByMessage" | "isVoiceInboundMessage"> | Pick<VoiceRepositoryPort, "findTranscriptByMessage" | "isVoiceInboundMessage">, context: WorkspaceContext, companyId: number, message: ConversationMessage): Promise<ConversationMessage> {
  if (message.direction === "inbound" && await repository.isVoiceInboundMessage(context, companyId, message.id) && await repository.findTranscriptByMessage(context, companyId, message.id) === null) throw new VoiceSemanticContentUnavailableError();
  const content = message.direction === "inbound" ? await resolveVoiceSemanticContent(repository, context, companyId, message.id, message.content) : message.content;
  return content === message.content ? message : Object.freeze({ ...message, content });
}

export async function includeVoiceSemanticHistory(repository: Pick<AsyncVoiceLookupPort, "isAssistantMessageSemanticallyVisible"> | Pick<VoiceRepositoryPort, "isAssistantMessageSemanticallyVisible">, context: WorkspaceContext, companyId: number, message: ConversationMessage): Promise<boolean> {
  return message.direction === "inbound" || await repository.isAssistantMessageSemanticallyVisible(context, companyId, message.id);
}
