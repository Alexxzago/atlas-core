import type { UserId } from "../../identity/domain/user.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AsyncWhatsAppConversationRepositoryPort } from "../../whatsapp/application/ports.js";
import { WhatsAppOutboundDeliveryService } from "../../whatsapp/services/WhatsAppOutboundDeliveryService.js";
import type { ConversationRepositoryPort } from "../application/ports.js";
import type { ConversationId } from "../domain/conversation.js";
import type { ConversationService } from "./conversationService.js";
import type { ConversationIntelligenceService } from "../../conversationIntelligence/services/conversationIntelligenceService.js";
import { abuseScope } from "../../abuse/sharedRateLimitRepository.js";
import { operatorMessageActorLimit, operatorMessageCompanyLimit, type RateLimitService } from "../../abuse/rateLimitService.js";

export class OperatorConversationMessageValidationError extends Error {}
export class OperatorConversationMessageForbiddenError extends Error {}
export class OperatorConversationMessageNotFoundError extends Error {}

export interface OperatorConversationMessageResult {
  readonly messageId: string;
  readonly message: { readonly messageId: string; readonly content: string; readonly createdAt: string };
  readonly delivery: { readonly id: string; readonly state: "pending" | "accepted" | "uncertain" };
}

export class OperatorConversationMessagingService {
  public constructor(private readonly conversations: ConversationService, private readonly repository: ConversationRepositoryPort, private readonly controls: ConversationRepositoryPort, private readonly bindings: AsyncWhatsAppConversationRepositoryPort, private readonly outbound: WhatsAppOutboundDeliveryService, private readonly clock: { now(): string }, private readonly intelligence?: ConversationIntelligenceService, private readonly limits?: RateLimitService) {}

  public async send(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): Promise<OperatorConversationMessageResult> {
    const companyId = parseCompanyId(companyIdValue), parsed = parseInput(input);
    const conversation = await this.conversations.validateOpen(context, companyId, conversationIdValue);
    const binding = await this.bindings.findBindingByConversation(context, companyId, conversation.id);
    if (!binding) throw new OperatorConversationMessageNotFoundError("WhatsApp conversation binding was not found.");
    await this.limits?.enforce(abuseScope("workspace", context.workspaceId, "company", companyId, "actor", actorId), "actor", operatorMessageActorLimit);
    await this.limits?.enforce(abuseScope("workspace", context.workspaceId, "company", companyId), "company", operatorMessageCompanyLimit);
    const persisted = await this.repository.persistOperatorMessage(context, companyId, conversation.id, actorId, parsed.content, parsed.idempotencyKey, binding.whatsAppConnectionId, this.clock.now());
    if (persisted.kind === "forbidden") throw new OperatorConversationMessageForbiddenError("Conversation is not controlled by this operator.");
    if (persisted.kind === "not_found") throw new OperatorConversationMessageNotFoundError("Conversation was not found.");
    if (persisted.kind === "idempotency_mismatch") throw new OperatorConversationMessageValidationError("Message idempotency key is invalid.");
    if (persisted.kind === "created" && this.intelligence) await this.intelligence.apply(context, companyId, persisted.message);
    const delivery = await this.outbound.deliverWhatsAppText(context, companyId, { conversationId: conversation.id, conversationMessageId: persisted.message.id, whatsAppConnectionId: binding.whatsAppConnectionId, recipientWaId: binding.waId });
    return Object.freeze({ messageId: persisted.message.id, message: { messageId: persisted.message.id, content: persisted.message.content, createdAt: persisted.message.createdAt }, delivery });
  }

}

function parseCompanyId(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new OperatorConversationMessageValidationError("Company ID is invalid."); return parsed; }
function parseInput(value: unknown): { content: string; idempotencyKey: string } { if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperatorConversationMessageValidationError("Message is invalid."); const record = value as Record<string, unknown>; if (Object.keys(record).length !== 2 || typeof record.content !== "string" || typeof record.idempotencyKey !== "string") throw new OperatorConversationMessageValidationError("Message is invalid."); const content = record.content.normalize("NFKC").trim(), idempotencyKey = record.idempotencyKey.normalize("NFKC").trim(); if (!content || Array.from(content).length > 10_000 || !idempotencyKey || Array.from(idempotencyKey).length > 256) throw new OperatorConversationMessageValidationError("Message is invalid."); return { content, idempotencyKey }; }
