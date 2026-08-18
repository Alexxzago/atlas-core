import type { UserId } from "../../identity/domain/user.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConversationRepositoryPort } from "../../whatsapp/application/ports.js";
import { WhatsAppOutboundDeliveryService } from "../../whatsapp/services/WhatsAppOutboundDeliveryService.js";
import type { ConversationRepositoryPort } from "../application/ports.js";
import type { ConversationId } from "../domain/conversation.js";
import { reconstructConversationControl } from "../domain/conversationControl.js";
import type { ConversationService } from "./conversationService.js";
import type { ConversationIntelligenceService } from "../../conversationIntelligence/services/conversationIntelligenceService.js";

export class OperatorConversationMessageValidationError extends Error {}
export class OperatorConversationMessageForbiddenError extends Error {}
export class OperatorConversationMessageNotFoundError extends Error {}

export interface OperatorConversationMessageResult {
  readonly messageId: string;
  readonly delivery: { readonly id: string; readonly state: "pending" | "accepted" | "uncertain" };
}

export class OperatorConversationMessagingService {
  public constructor(private readonly conversations: ConversationService, private readonly repository: ConversationRepositoryPort, private readonly controls: ConversationRepositoryPort, private readonly bindings: WhatsAppConversationRepositoryPort, private readonly outbound: WhatsAppOutboundDeliveryService, private readonly clock: { now(): string }, private readonly intelligence?: ConversationIntelligenceService) {}

  public async send(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): Promise<OperatorConversationMessageResult> {
    const companyId = parseCompanyId(companyIdValue), parsed = parseInput(input);
    const conversation = this.conversations.validateOpen(context, companyId, conversationIdValue);
    const control = this.controls.ensureConversationControl(context, companyId, conversation.id);
    if (!control) throw new OperatorConversationMessageNotFoundError("Conversation was not found.");
    if (control.state !== "human_controlled" || control.controllingActorId !== actorId) throw new OperatorConversationMessageForbiddenError("Conversation is not controlled by this operator.");
    const binding = this.bindings.findBindingByConversation(context, companyId, conversation.id);
    if (!binding) throw new OperatorConversationMessageNotFoundError("WhatsApp conversation binding was not found.");
    const existing = this.repository.findMessageByIdempotencyKey(context, companyId, conversation.id, parsed.idempotencyKey);
    if (existing) {
      if (existing.direction !== "outbound") throw new OperatorConversationMessageValidationError("Message idempotency key is invalid.");
      const delivery = await this.outbound.deliverWhatsAppText(context, companyId, { conversationId: conversation.id, conversationMessageId: existing.id, whatsAppConnectionId: binding.whatsAppConnectionId, recipientWaId: binding.waId });
      return Object.freeze({ messageId: existing.id, delivery });
    }
    const participant = this.repository.listParticipants(context, companyId, conversation.id).find((value) => value.type === "human_operator" && value.reference === actorId)
      ?? this.conversations.addParticipant(context, companyId, conversation.id, { type: "human_operator", reference: actorId });
    if (participant.type !== "human_operator" || participant.reference !== actorId) throw new OperatorConversationMessageForbiddenError("Operator participant is invalid.");
    const message = this.conversations.addMessage(context, companyId, conversation.id, { senderParticipantId: participant.id, direction: "outbound", content: parsed.content, idempotencyKey: parsed.idempotencyKey });
    if (this.intelligence) await this.intelligence.apply(context, companyId, message);
    const delivery = await this.outbound.deliverWhatsAppText(context, companyId, { conversationId: conversation.id, conversationMessageId: message.id, whatsAppConnectionId: binding.whatsAppConnectionId, recipientWaId: binding.waId });
    this.recordActivity(context, companyId, conversation.id);
    return Object.freeze({ messageId: message.id, delivery });
  }

  private recordActivity(context: WorkspaceContext, companyId: number, conversationId: ConversationId): void {
    const current = this.controls.findConversationControl(context, companyId, conversationId);
    if (!current || current.state !== "human_controlled") return;
    const updated = reconstructConversationControl({ ...current, lastOperatorActivityAt: this.clock.now(), version: current.version + 1, updatedAt: this.clock.now() });
    this.controls.updateConversationControl(context, companyId, updated, current.version);
  }
}

function parseCompanyId(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new OperatorConversationMessageValidationError("Company ID is invalid."); return parsed; }
function parseInput(value: unknown): { content: string; idempotencyKey: string } { if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperatorConversationMessageValidationError("Message is invalid."); const record = value as Record<string, unknown>; if (Object.keys(record).length !== 2 || typeof record.content !== "string" || typeof record.idempotencyKey !== "string") throw new OperatorConversationMessageValidationError("Message is invalid."); const content = record.content.normalize("NFKC").trim(), idempotencyKey = record.idempotencyKey.normalize("NFKC").trim(); if (!content || Array.from(content).length > 10_000 || !idempotencyKey || Array.from(idempotencyKey).length > 256) throw new OperatorConversationMessageValidationError("Message is invalid."); return { content, idempotencyKey }; }
