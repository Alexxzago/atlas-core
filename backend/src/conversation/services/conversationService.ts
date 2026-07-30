import { randomUUID } from "node:crypto";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationRepositoryPort } from "../application/ports.js";
import {
  conversationId,
  communicationChannel,
  conversationMessageDirection,
  conversationMessageId,
  conversationParticipantId,
  reconstructConversation,
  reconstructConversationMessage,
  reconstructConversationParticipant,
  type Conversation,
  type ConversationMessage,
  type ConversationParticipant,
} from "../domain/conversation.js";
import type { ConversationDetailProjection, ConversationInboxProjection } from "../domain/conversationControl.js";

export class ConversationValidationError extends Error {}
export class ConversationNotFoundError extends Error {}
export class ConversationClosedError extends Error {}

export interface ConversationClock { now(): string; }

export class ConversationService {
  public constructor(private readonly conversations: ConversationRepositoryPort, private readonly clock: ConversationClock) {}

  public open(context: WorkspaceContext, companyIdValue: unknown, channelValue: unknown = "internal"): Conversation {
    const companyId = parseCompanyId(companyIdValue);
    const channel = parseChannel(channelValue);
    const now = this.clock.now();
    const conversation = reconstructConversation({
      id: conversationId(`cnv_${randomUUID().replaceAll("-", "")}`), companyId, channel, state: "open", createdAt: now, updatedAt: now, closedAt: null,
    });
    const created = this.conversations.createConversation(context, conversation);
    if (!created) throw new ConversationNotFoundError("Company was not found.");
    return created;
  }

  public get(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): Conversation {
    const companyId = parseCompanyId(companyIdValue), id = parseConversationId(conversationIdValue);
    const conversation = this.conversations.findConversation(context, companyId, id);
    if (!conversation) throw new ConversationNotFoundError("Conversation was not found.");
    return conversation;
  }

  public close(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): Conversation {
    const current = this.get(context, companyIdValue, conversationIdValue);
    if (current.state === "closed") throw new ConversationClosedError("Conversation is already closed.");
    const now = this.clock.now();
    const closed = reconstructConversation({ ...current, state: "closed", updatedAt: now, closedAt: now });
    if (!this.conversations.updateConversation(context, current.companyId, closed, "open")) {
      throw new ConversationClosedError("Conversation is already closed.");
    }
    return closed;
  }

  public addParticipant(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, value: unknown): ConversationParticipant {
    const current = this.get(context, companyIdValue, conversationIdValue);
    const input = participantInput(value), now = this.clock.now();
    const participant = reconstructConversationParticipant({
      id: conversationParticipantId(`cpt_${randomUUID().replaceAll("-", "")}`), conversationId: current.id, type: input.type, reference: input.reference, createdAt: now,
    });
    const created = this.conversations.createParticipant(context, current.companyId, participant);
    if (!created) throw new ConversationNotFoundError("Conversation was not found.");
    return created;
  }

  public addMessage(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, value: unknown): ConversationMessage {
    const current = this.validateOpen(context, companyIdValue, conversationIdValue);
    const input = messageInput(value);
    const sender = this.conversations.findParticipant(context, current.companyId, input.senderParticipantId);
    if (!sender || sender.conversationId !== current.id) throw new ConversationNotFoundError("Conversation participant was not found.");
    const message = reconstructConversationMessage({
      id: conversationMessageId(`cmsg_${randomUUID().replaceAll("-", "")}`), conversationId: current.id, senderParticipantId: sender.id,
      direction: input.direction, content: input.content, idempotencyKey: input.idempotencyKey, executionRecordId: input.executionRecordId, createdAt: this.clock.now(),
    });
    const created = this.conversations.createMessage(context, current.companyId, message);
    if (!created) throw new ConversationNotFoundError("Conversation was not found.");
    return created;
  }

  public listMessages(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): ConversationMessage[] {
    const current = this.get(context, companyIdValue, conversationIdValue);
    return this.conversations.listMessages(context, current.companyId, current.id);
  }
  public findMessageByIdempotencyKey(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, idempotencyKey: string): ConversationMessage | null {
    const current = this.get(context, companyIdValue, conversationIdValue);
    return this.conversations.findMessageByIdempotencyKey(context, current.companyId, current.id, idempotencyKey);
  }
  public listInbox(context: WorkspaceContext, companyIdValue: unknown): ConversationInboxProjection[] {
    const companyId = parseCompanyId(companyIdValue);
    return this.conversations.listConversationInbox(context, companyId);
  }
  public detail(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): ConversationDetailProjection {
    const companyId = parseCompanyId(companyIdValue), id = parseConversationId(conversationIdValue);
    const detail = this.conversations.findConversationDetail(context, companyId, id);
    if (!detail) throw new ConversationNotFoundError("Conversation was not found.");
    return detail;
  }

  public validateOpen(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): Conversation {
    const current = this.get(context, companyIdValue, conversationIdValue);
    if (current.state !== "open") throw new ConversationClosedError("Conversation is closed.");
    return current;
  }
}

function parseCompanyId(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ConversationValidationError("Company ID is invalid.");
  return parsed;
}

function parseConversationId(value: unknown): ReturnType<typeof conversationId> {
  if (typeof value !== "string") throw new ConversationValidationError("Conversation ID is invalid.");
  try { return conversationId(value); }
  catch { throw new ConversationValidationError("Conversation ID is invalid."); }
}

function parseChannel(value: unknown): ReturnType<typeof communicationChannel> {
  if (typeof value !== "string") throw new ConversationValidationError("Conversation channel is invalid.");
  try { return communicationChannel(value); }
  catch { throw new ConversationValidationError("Conversation channel is invalid."); }
}

function participantInput(value: unknown): { type: string; reference: string | null } {
  const record = inputRecord(value, new Set(["type", "reference"]));
  if (typeof record.type !== "string") throw new ConversationValidationError("Participant type is invalid.");
  if (record.reference !== undefined && record.reference !== null && typeof record.reference !== "string") throw new ConversationValidationError("Participant reference is invalid.");
  return { type: record.type, reference: record.reference === undefined ? null : record.reference };
}

function messageInput(value: unknown): { senderParticipantId: ReturnType<typeof conversationParticipantId>; direction: "inbound" | "outbound"; content: string; idempotencyKey: string | null; executionRecordId: string | null } {
  const record = inputRecord(value, new Set(["senderParticipantId", "direction", "content", "idempotencyKey", "executionRecordId"]));
  if (typeof record.senderParticipantId !== "string" || typeof record.direction !== "string" || typeof record.content !== "string") throw new ConversationValidationError("Message is invalid.");
  if (record.idempotencyKey !== undefined && record.idempotencyKey !== null && typeof record.idempotencyKey !== "string") throw new ConversationValidationError("Message idempotency key is invalid.");
  if (record.executionRecordId !== undefined && record.executionRecordId !== null && typeof record.executionRecordId !== "string") throw new ConversationValidationError("Message execution record ID is invalid.");
  try {
    return { senderParticipantId: conversationParticipantId(record.senderParticipantId), direction: conversationMessageDirection(record.direction), content: record.content, idempotencyKey: record.idempotencyKey === undefined ? null : record.idempotencyKey, executionRecordId: record.executionRecordId === undefined ? null : record.executionRecordId };
  } catch { throw new ConversationValidationError("Message is invalid."); }
}

function inputRecord(value: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConversationValidationError("Input must be an object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new ConversationValidationError("Input contains unsupported fields.");
  return record;
}
