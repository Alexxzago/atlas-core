import { OperationalConversationTurnInProgressError, type OperationalConversationTurnService } from "../../assistant/services/operationalConversationTurnService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { PublicWebChatSessionService } from "./publicWebChatSessionService.js";

export class PublicWebChatConversationUnavailableError extends Error {}
export class PublicWebChatConversationValidationError extends Error {}
export class PublicWebChatConversationInProgressError extends Error {}
export class PublicWebChatConversationRuntimeError extends Error {}

export interface PublicWebChatConversationResult { readonly message: string; }

export class PublicWebChatConversationService {
  public constructor(private readonly sessions: PublicWebChatSessionService, private readonly turns: OperationalConversationTurnService) {}

  public async sendMessage(connectionPublicId: unknown, rawSessionToken: string | null, contentValue: unknown): Promise<PublicWebChatConversationResult> {
    const content = messageContent(contentValue);
    const session = this.sessions.resolveSessionForConnection(connectionPublicId, rawSessionToken);
    if (!session) throw new PublicWebChatConversationUnavailableError();
    const context: WorkspaceContext = { workspaceId: session.workspaceId, workspaceKey: "public" };
    try {
      const result = await this.turns.execute(context, session.companyId, session.conversationId, {
        assistantProfileId: session.assistantProfileId,
        inboundParticipantId: session.visitorParticipantId,
        outboundParticipantId: session.responderParticipantId,
        content,
      });
      return Object.freeze({ message: result.outbound.content });
    } catch (error: unknown) {
      if (error instanceof OperationalConversationTurnInProgressError) throw new PublicWebChatConversationInProgressError();
      throw new PublicWebChatConversationRuntimeError();
    }
  }
}

function messageContent(value: unknown): string {
  if (typeof value !== "string") throw new PublicWebChatConversationValidationError();
  const content = value.normalize("NFKC").trim();
  if (!content || Array.from(content).length > 4_000) throw new PublicWebChatConversationValidationError();
  return content;
}
