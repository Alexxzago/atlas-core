import { OperationalConversationTurnInProgressError, type OperationalConversationTurnService } from "../../assistant/services/operationalConversationTurnService.js";
import type { ConversationService } from "../../conversation/services/conversationService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { PublicWebChatSessionService } from "./publicWebChatSessionService.js";
import { abuseScope } from "../../abuse/sharedRateLimitRepository.js";
import { publicWebChatCompanyLimit, publicWebChatSessionLimit, type RateLimitService } from "../../abuse/rateLimitService.js";
import type { ActivationService } from "../../activation/services/activationService.js";
import { createHash } from "node:crypto";
import type { PublicWebChatTurnRepositoryPort } from "../application/sessionPorts.js";

export class PublicWebChatConversationUnavailableError extends Error {}
export class PublicWebChatConversationValidationError extends Error {}
export class PublicWebChatConversationInProgressError extends Error {}
export class PublicWebChatConversationRuntimeError extends Error {}

export interface PublicWebChatConversationResult { readonly message: string; }
export interface PublicWebChatHistoryResult { readonly messages: readonly { readonly direction: "inbound" | "outbound"; readonly content: string; readonly createdAt: string; }[]; }

export class PublicWebChatConversationService {
  public constructor(private readonly sessions: PublicWebChatSessionService, private readonly turns: OperationalConversationTurnService, private readonly conversations: ConversationService, private readonly limits?: RateLimitService, private readonly activation?: ActivationService, private readonly durableTurns?: PublicWebChatTurnRepositoryPort) {}

  public async history(connectionPublicId: unknown, rawSessionToken: string | null): Promise<PublicWebChatHistoryResult> {
    const session = await this.sessions.resolveSessionForConnection(connectionPublicId, rawSessionToken);
    if (!session) throw new PublicWebChatConversationUnavailableError();
    const context: WorkspaceContext = { workspaceId: session.workspaceId, workspaceKey: "public" };
    await this.limits?.enforce(abuseScope("workspace", session.workspaceId, "company", session.companyId, "conversation", session.conversationId), "actor", publicWebChatSessionLimit);
    await this.limits?.enforce(abuseScope("workspace", session.workspaceId, "company", session.companyId), "company", publicWebChatCompanyLimit);
    return Object.freeze({ messages: Object.freeze((await this.conversations.listMessages(context, session.companyId, session.conversationId))
      .map(({ direction, content, createdAt }) => Object.freeze({ direction, content, createdAt }))) });
  }

  public async sendMessage(connectionPublicId: unknown, rawSessionToken: string | null, contentValue: unknown, idempotencyKeyValue?: unknown): Promise<PublicWebChatConversationResult> {
    const content = messageContent(contentValue);
    const session = await this.sessions.resolveSessionForConnection(connectionPublicId, rawSessionToken);
    if (!session) throw new PublicWebChatConversationUnavailableError();
    const context: WorkspaceContext = { workspaceId: session.workspaceId, workspaceKey: "public" };
    const idempotencyKey = idempotencyKeyValue === undefined && !this.durableTurns ? null : idempotencyKeyValue;
    if (idempotencyKey !== null && !validIdempotencyKey(idempotencyKey)) throw new PublicWebChatConversationValidationError();
    await this.limits?.enforce(abuseScope("workspace", session.workspaceId, "company", session.companyId, "conversation", session.conversationId), "actor", publicWebChatSessionLimit);
    await this.limits?.enforce(abuseScope("workspace", session.workspaceId, "company", session.companyId), "company", publicWebChatCompanyLimit);
    const keyDigest = idempotencyKey === null ? null : digest(idempotencyKey), claim = keyDigest ? await this.durableTurns?.claim(session.sessionId, keyDigest, digest(content), new Date().toISOString()) : undefined;
    if (claim?.kind === "succeeded") return Object.freeze({ message: claim.message });
    if (claim?.kind === "failed") return Object.freeze({ message: "A team member will follow up shortly." });
    if (claim?.kind === "in_progress") throw new PublicWebChatConversationInProgressError();
    if (claim?.kind === "mismatch") throw new PublicWebChatConversationValidationError();
    let inboundId: string | null = null;
    try {
      const inbound = keyDigest ? await this.conversations.addMessage(context, session.companyId, session.conversationId, { senderParticipantId: session.visitorParticipantId, direction: "inbound", content, idempotencyKey: `public:${keyDigest}` }) : null;
      inboundId = inbound?.id ?? null;
      const result = inbound ? await this.turns.executePersistedInbound(context, session.companyId, session.conversationId, {
        assistantProfileId: session.assistantProfileId, outboundParticipantId: session.responderParticipantId, replyIdempotencyKey: `assistant:public:${keyDigest}`,
      }, inbound) : await this.turns.execute(context, session.companyId, session.conversationId, {
        assistantProfileId: session.assistantProfileId,
        inboundParticipantId: session.visitorParticipantId,
        outboundParticipantId: session.responderParticipantId,
        content,
      });
      await this.activation?.succeedForTurn(session,result.inbound.id,result.executionRecordId,result.response.outcome);
      if (keyDigest) await this.durableTurns?.succeed(session.sessionId, keyDigest, result.inbound.id, result.executionRecordId, result.outbound.content, new Date().toISOString());
      return Object.freeze({ message: result.outbound.content });
    } catch (error: unknown) {
      if (error instanceof OperationalConversationTurnInProgressError && !inboundId) {
        if (keyDigest) await this.durableTurns?.abandon(session.sessionId, keyDigest);
        throw new PublicWebChatConversationInProgressError();
      }
      await this.activation?.failForSession(session);
      if (keyDigest) {
        const completedAt = new Date().toISOString();
        await this.durableTurns?.fail(session.sessionId, keyDigest, inboundId, completedAt);
        if (inboundId) await this.durableTurns?.requestHumanHandoff(session.workspaceId, session.companyId, session.conversationId, completedAt);
        if (inboundId) return Object.freeze({ message: "A team member will follow up shortly." });
      }
      throw new PublicWebChatConversationRuntimeError();
    }
  }
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function validIdempotencyKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value); }

function messageContent(value: unknown): string {
  if (typeof value !== "string") throw new PublicWebChatConversationValidationError();
  const content = value.normalize("NFKC").trim();
  if (!content || Array.from(content).length > 4_000) throw new PublicWebChatConversationValidationError();
  return content;
}
