export type ConversationId = string & { readonly __brand: "ConversationId" };
export type ConversationParticipantId = string & { readonly __brand: "ConversationParticipantId" };
export type ConversationMessageId = string & { readonly __brand: "ConversationMessageId" };
export type ConversationState = "open" | "closed";
export type ConversationMessageDirection = "inbound" | "outbound";

export interface Conversation {
  readonly id: ConversationId;
  readonly companyId: number;
  readonly state: ConversationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
}

export interface ConversationParticipant {
  readonly id: ConversationParticipantId;
  readonly conversationId: ConversationId;
  readonly type: string;
  readonly reference: string | null;
  readonly createdAt: string;
}

export interface ConversationMessage {
  readonly id: ConversationMessageId;
  readonly conversationId: ConversationId;
  readonly senderParticipantId: ConversationParticipantId;
  readonly direction: ConversationMessageDirection;
  readonly content: string;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
}

export class ConversationDomainError extends Error {}

function opaque<T extends string>(value: string, prefix: string): T {
  if (!new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value)) throw new ConversationDomainError("Conversation identifier is invalid.");
  return value as T;
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ConversationDomainError("Conversation timestamp is invalid.");
  return value;
}

function nonEmpty(value: string, maximum: number, label: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > maximum) throw new ConversationDomainError(`${label} is invalid.`);
  return normalized;
}

export function conversationId(value: string): ConversationId { return opaque<ConversationId>(value, "cnv"); }
export function conversationParticipantId(value: string): ConversationParticipantId { return opaque<ConversationParticipantId>(value, "cpt"); }
export function conversationMessageId(value: string): ConversationMessageId { return opaque<ConversationMessageId>(value, "cmsg"); }
export function conversationState(value: string): ConversationState { if (value !== "open" && value !== "closed") throw new ConversationDomainError("Conversation state is invalid."); return value; }
export function conversationMessageDirection(value: string): ConversationMessageDirection { if (value !== "inbound" && value !== "outbound") throw new ConversationDomainError("Conversation message direction is invalid."); return value; }

export function reconstructConversation(value: Conversation): Conversation {
  if (!Number.isSafeInteger(value.companyId) || value.companyId < 1) throw new ConversationDomainError("Conversation Company is invalid.");
  const state = conversationState(value.state), closedAt = value.closedAt === null ? null : timestamp(value.closedAt);
  if ((state === "closed") !== (closedAt !== null)) throw new ConversationDomainError("Conversation close state is invalid.");
  return Object.freeze({ ...value, id: conversationId(value.id), state, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), closedAt });
}

export function reconstructConversationParticipant(value: ConversationParticipant): ConversationParticipant {
  const type = nonEmpty(value.type, 64, "Conversation participant type");
  const reference = value.reference === null ? null : nonEmpty(value.reference, 256, "Conversation participant reference");
  return Object.freeze({ ...value, id: conversationParticipantId(value.id), conversationId: conversationId(value.conversationId), type, reference, createdAt: timestamp(value.createdAt) });
}

export function reconstructConversationMessage(value: ConversationMessage): ConversationMessage {
  const idempotencyKey = value.idempotencyKey === null ? null : nonEmpty(value.idempotencyKey, 256, "Conversation message idempotency key");
  return Object.freeze({ ...value, id: conversationMessageId(value.id), conversationId: conversationId(value.conversationId), senderParticipantId: conversationParticipantId(value.senderParticipantId), direction: conversationMessageDirection(value.direction), content: nonEmpty(value.content, 10_000, "Conversation message content"), idempotencyKey, createdAt: timestamp(value.createdAt) });
}
