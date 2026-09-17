import { OperationalConversationTurnInProgressError, type OperationalConversationTurnService } from "../../assistant/services/operationalConversationTurnService.js";
import type { ConversationService } from "../../conversation/services/conversationService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { PublicWebChatSessionService } from "./publicWebChatSessionService.js";
import { abuseScope } from "../../abuse/sharedRateLimitRepository.js";
import { publicWebChatCompanyLimit, publicWebChatSessionLimit, type RateLimitService } from "../../abuse/rateLimitService.js";
import type { ActivationService } from "../../activation/services/activationService.js";

export class PublicWebChatConversationUnavailableError extends Error {}
export class PublicWebChatConversationValidationError extends Error {}
export class PublicWebChatConversationInProgressError extends Error {}
export class PublicWebChatConversationRuntimeError extends Error {}

export interface PublicWebChatConversationResult { readonly message: string; }
export interface PublicWebChatHistoryResult { readonly messages: readonly { readonly direction: "inbound" | "outbound"; readonly content: string; readonly createdAt: string; }[]; }

export class PublicWebChatConversationService {
  public constructor(private readonly sessions: PublicWebChatSessionService, private readonly turns: OperationalConversationTurnService, private readonly conversations: ConversationService, private readonly limits?: RateLimitService, private readonly activation?: ActivationService) {}

  public history(connectionPublicId: unknown, rawSessionToken: string | null): PublicWebChatHistoryResult {
    const session = this.sessions.resolveSessionForConnection(connectionPublicId, rawSessionToken);
    if (!session) throw new PublicWebChatConversationUnavailableError();
    const context: WorkspaceContext = { workspaceId: session.workspaceId, workspaceKey: "public" };
    this.limits?.enforce(abuseScope("workspace", session.workspaceId, "company", session.companyId, "conversation", session.conversationId), "actor", publicWebChatSessionLimit);
    this.limits?.enforce(abuseScope("workspace", session.workspaceId, "company", session.companyId), "company", publicWebChatCompanyLimit);
    return Object.freeze({ messages: Object.freeze(this.conversations.listMessages(context, session.companyId, session.conversationId)
      .map(({ direction, content, createdAt }) => Object.freeze({ direction, content, createdAt }))) });
  }

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
      this.activation?.succeedForTurn(session,result.inbound.id,result.executionRecordId,result.response.outcome);
      return Object.freeze({ message: result.outbound.content });
    } catch (error: unknown) {
      if (error instanceof OperationalConversationTurnInProgressError) throw new PublicWebChatConversationInProgressError();
      this.activation?.failForSession(session);
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
