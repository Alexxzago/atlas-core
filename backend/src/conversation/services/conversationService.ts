import { randomUUID } from "node:crypto";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { UserId } from "../../identity/domain/user.js";
import { decodeConversationInboxCursor, encodeConversationInboxCursor, type ConversationInboxFilters, type ConversationInboxPage } from "../domain/conversationInbox.js";
import type { AssistantResponseFinalizationResult, ConversationRepositoryPort } from "../application/ports.js";
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

  public async open(context: WorkspaceContext, companyIdValue: unknown, channelValue: unknown = "internal"): Promise<Conversation> {
    const companyId = parseCompanyId(companyIdValue);
    const channel = parseChannel(channelValue);
    const now = this.clock.now();
    const conversation = reconstructConversation({
      id: conversationId(`cnv_${randomUUID().replaceAll("-", "")}`), companyId, channel, state: "open", createdAt: now, updatedAt: now, closedAt: null,
    });
    const created = await this.conversations.createConversation(context, conversation);
    if (!created) throw new ConversationNotFoundError("Company was not found.");
    return created;
  }

  public async get(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): Promise<Conversation> {
    const companyId = parseCompanyId(companyIdValue), id = parseConversationId(conversationIdValue);
    const conversation = await this.conversations.findConversation(context, companyId, id);
    if (!conversation) throw new ConversationNotFoundError("Conversation was not found.");
    return conversation;
  }

  public async close(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): Promise<Conversation> {
    const current = await this.get(context, companyIdValue, conversationIdValue);
    if (current.state === "closed") throw new ConversationClosedError("Conversation is already closed.");
    const now = this.clock.now();
    const closed = reconstructConversation({ ...current, state: "closed", updatedAt: now, closedAt: now });
    if (!await this.conversations.updateConversation(context, current.companyId, closed, "open")) {
      throw new ConversationClosedError("Conversation is already closed.");
    }
    return closed;
  }

  public async addParticipant(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, value: unknown): Promise<ConversationParticipant> {
    const current = await this.get(context, companyIdValue, conversationIdValue);
    const input = participantInput(value), now = this.clock.now();
    const participant = reconstructConversationParticipant({
      id: conversationParticipantId(`cpt_${randomUUID().replaceAll("-", "")}`), conversationId: current.id, type: input.type, reference: input.reference, createdAt: now,
    });
    const created = await this.conversations.createParticipant(context, current.companyId, participant);
    if (!created) throw new ConversationNotFoundError("Conversation was not found.");
    return created;
  }

  public async addMessage(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, value: unknown): Promise<ConversationMessage> {
    const current = await this.validateOpen(context, companyIdValue, conversationIdValue);
    const input = messageInput(value);
    const sender = await this.conversations.findParticipant(context, current.companyId, input.senderParticipantId);
    if (!sender || sender.conversationId !== current.id) throw new ConversationNotFoundError("Conversation participant was not found.");
    const message = reconstructConversationMessage({
      id: conversationMessageId(`cmsg_${randomUUID().replaceAll("-", "")}`), conversationId: current.id, senderParticipantId: sender.id,
      direction: input.direction, content: input.content, idempotencyKey: input.idempotencyKey, executionRecordId: input.executionRecordId, createdAt: this.clock.now(),
    });
    const created = await this.conversations.createMessage(context, current.companyId, message);
    if (!created) throw new ConversationNotFoundError("Conversation was not found.");
    return created;
  }

  public async listMessages(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): Promise<readonly ConversationMessage[]> {
    const current = await this.get(context, companyIdValue, conversationIdValue);
    return this.conversations.listMessages(context, current.companyId, current.id);
  }
  public async findMessageByIdempotencyKey(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, idempotencyKey: string): Promise<ConversationMessage | null> {
    const current = await this.get(context, companyIdValue, conversationIdValue);
    return this.conversations.findMessageByIdempotencyKey(context, current.companyId, current.id, idempotencyKey);
  }
  public async finalizeAssistantResponse(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, input: { inboundMessageId: ConversationMessage["id"]; outboundParticipantId: ConversationParticipant["id"]; executionRecordId: string; authorityGeneration: number; content: string; idempotencyKey: string; occurredAt: string; whatsAppConnectionId?: string }): Promise<AssistantResponseFinalizationResult> {
    const current = await this.get(context, companyIdValue, conversationIdValue);
    return this.conversations.finalizeAssistantResponse(context, current.companyId, current.id, input.inboundMessageId, input.outboundParticipantId, input.executionRecordId, input.authorityGeneration, input.content, input.idempotencyKey, input.occurredAt, input.whatsAppConnectionId ?? null);
  }
  public async listInbox(context: WorkspaceContext, companyIdValue: unknown, actorId: UserId, input: unknown): Promise<ConversationInboxPage<ConversationInboxProjection>> {
    const companyId = parseCompanyId(companyIdValue);
    if (!await this.conversations.hasCompany(context, companyId)) throw new ConversationNotFoundError("Company was not found.");
    const parsed = inboxInput(input);
    const cursor = parsed.cursor === null ? null : decodeConversationInboxCursor(parsed.cursor, context.workspaceId, companyId, parsed.filters);
    if (parsed.cursor !== null && cursor === null) throw new ConversationValidationError("Conversation cursor is invalid.");
    const page = await this.conversations.listConversationInboxPage(context, companyId, actorId, parsed.filters, cursor === null ? null : { activity: cursor.a, id: cursor.i }, parsed.limit);
    const next = page.nextCursor === null ? null : JSON.parse(page.nextCursor) as { activity: string; id: string };
    return Object.freeze({ items: Object.freeze(page.items), nextCursor: next === null ? null : encodeConversationInboxCursor({ w: context.workspaceId, c: companyId, a: next.activity, i: next.id, ...parsed.filters }) });
  }
  public async detail(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, actorId?: UserId): Promise<ConversationDetailProjection> {
    const companyId = parseCompanyId(companyIdValue), id = parseConversationId(conversationIdValue);
    const detail = await this.conversations.findConversationDetail(context, companyId, id, actorId ?? ("anonymous" as UserId));
    if (!detail) throw new ConversationNotFoundError("Conversation was not found.");
    return Object.freeze({ ...detail, controlledByCurrentActor: actorId === undefined ? false : await this.conversations.isConversationControlledBy(context, companyId, detail.conversationId, actorId) });
  }
  public async markRead(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown, actorId: UserId): Promise<void> {
    const companyId = parseCompanyId(companyIdValue), id = parseConversationId(conversationIdValue);
    if (!await this.conversations.markConversationRead(context, companyId, id, actorId, this.clock.now())) throw new ConversationNotFoundError("Conversation was not found.");
  }

  public async validateOpen(context: WorkspaceContext, companyIdValue: unknown, conversationIdValue: unknown): Promise<Conversation> {
    const current = await this.get(context, companyIdValue, conversationIdValue);
    if (current.state !== "open") throw new ConversationClosedError("Conversation is closed.");
    return current;
  }
}

function parseCompanyId(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ConversationValidationError("Company ID is invalid.");
  return parsed;
}

function inboxInput(value: unknown): { readonly filters: ConversationInboxFilters; readonly cursor: string | null; readonly limit: number } {
  const record = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const one = (key: string): string | null => record[key] === undefined ? null : typeof record[key] === "string" ? record[key] : invalidInbox();
  const controlState = one("controlState"), state = one("state"), channel = one("channel"), cursor = one("cursor");
  if (controlState !== null && controlState !== "automated" && controlState !== "human_required" && controlState !== "human_controlled") invalidInbox();
  if (state !== null && state !== "open" && state !== "closed") invalidInbox();
  if (channel !== null && channel !== "internal" && channel !== "web_chat" && channel !== "whatsapp") invalidInbox();
  const unreadOnly = record.unreadOnly === undefined ? false : record.unreadOnly === "true";
  if (record.unreadOnly !== undefined && record.unreadOnly !== "true" && record.unreadOnly !== "false") invalidInbox();
  const limit = record.limit === undefined ? 30 : typeof record.limit === "string" && /^\d+$/.test(record.limit) ? Number(record.limit) : invalidInbox();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalidInbox();
  return { filters: { controlState: controlState as ConversationInboxFilters["controlState"], state: state as ConversationInboxFilters["state"], channel: channel as ConversationInboxFilters["channel"], unreadOnly }, cursor, limit };
}
function invalidInbox(): never { throw new ConversationValidationError("Conversation inbox query is invalid."); }

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
