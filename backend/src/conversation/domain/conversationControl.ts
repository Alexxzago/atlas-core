import type { UserId } from "../../identity/domain/user.js";
import { conversationId, type ConversationId } from "./conversation.js";

export type ConversationControlState = "automated" | "human_required" | "human_controlled";
export type ConversationAttentionReason = "customer_request" | "automation_failure" | "policy_escalation" | "operator_follow_up";

export interface ConversationControl {
  readonly conversationId: ConversationId;
  readonly state: ConversationControlState;
  readonly controllingActorId: UserId | null;
  readonly lastControllingActorId: UserId | null;
  readonly takenAt: string | null;
  readonly releasedAt: string | null;
  readonly lastOperatorActivityAt: string | null;
  readonly attentionReason: ConversationAttentionReason | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: UserId | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ConversationControlDomainError extends Error {}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ConversationControlDomainError("Conversation control timestamp is invalid.");
  return value;
}

function actor(value: string): UserId {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > 128) throw new ConversationControlDomainError("Conversation control actor is invalid.");
  return normalized as UserId;
}

function optionalTimestamp(value: string | null): string | null { return value === null ? null : timestamp(value); }
function optionalActor(value: string | null): UserId | null { return value === null ? null : actor(value); }

export function conversationControlState(value: string): ConversationControlState {
  if (value !== "automated" && value !== "human_required" && value !== "human_controlled") throw new ConversationControlDomainError("Conversation control state is invalid.");
  return value;
}

export function conversationAttentionReason(value: string): ConversationAttentionReason {
  if (value !== "customer_request" && value !== "automation_failure" && value !== "policy_escalation" && value !== "operator_follow_up") throw new ConversationControlDomainError("Conversation attention reason is invalid.");
  return value;
}

export function reconstructConversationControl(value: ConversationControl): ConversationControl {
  const state = conversationControlState(value.state);
  const controllingActorId = optionalActor(value.controllingActorId);
  const lastControllingActorId = optionalActor(value.lastControllingActorId);
  const takenAt = optionalTimestamp(value.takenAt);
  const releasedAt = optionalTimestamp(value.releasedAt);
  const lastOperatorActivityAt = optionalTimestamp(value.lastOperatorActivityAt);
  const resolvedAt = optionalTimestamp(value.resolvedAt);
  const resolvedBy = optionalActor(value.resolvedBy);
  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt);
  if (state === "human_controlled" && (controllingActorId === null || takenAt === null)) throw new ConversationControlDomainError("Human-controlled conversations require a controller and takeover time.");
  if (state !== "human_controlled" && controllingActorId !== null) throw new ConversationControlDomainError("Non-controlled conversations cannot have an active controller.");
  if (releasedAt !== null && controllingActorId !== null) throw new ConversationControlDomainError("Released conversations cannot have an active controller.");
  if ((resolvedAt === null) !== (resolvedBy === null)) throw new ConversationControlDomainError("Conversation resolution is incomplete.");
  if (!Number.isSafeInteger(value.version) || value.version < 1) throw new ConversationControlDomainError("Conversation control version is invalid.");
  if (updatedAt < createdAt || (takenAt !== null && (takenAt < createdAt || takenAt > updatedAt)) || (releasedAt !== null && (takenAt === null || releasedAt < takenAt || releasedAt > updatedAt)) || (lastOperatorActivityAt !== null && (lastOperatorActivityAt < createdAt || lastOperatorActivityAt > updatedAt)) || (resolvedAt !== null && (resolvedAt < createdAt || resolvedAt > updatedAt))) throw new ConversationControlDomainError("Conversation control timestamps are inconsistent.");
  return Object.freeze({ ...value, conversationId: conversationId(value.conversationId), state, controllingActorId, lastControllingActorId, takenAt, releasedAt, lastOperatorActivityAt, attentionReason: value.attentionReason === null ? null : conversationAttentionReason(value.attentionReason), resolvedAt, resolvedBy, createdAt, updatedAt });
}

export interface ConversationInboxProjection {
  readonly conversationId: ConversationId;
  readonly channel: "internal" | "web_chat" | "whatsapp";
  readonly state: "open" | "closed";
  readonly controlState: ConversationControlState;
  readonly attentionReason: ConversationAttentionReason | null;
  readonly controllingActorId: string | null;
  readonly takenAt: string | null;
  readonly releasedAt: string | null;
  readonly lastOperatorActivityAt: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly controlVersion: number;
  readonly updatedAt: string;
  readonly participant: string | null;
  readonly preview: string | null;
  readonly deliveryCategory: "received" | "sent" | null;
  readonly lastActivityAt: string;
}

export interface ConversationDetailProjection extends ConversationInboxProjection {
  readonly messages: readonly ConversationDetailMessageProjection[];
}

export interface ConversationDetailMessageProjection {
  readonly messageId: string;
  readonly participant: string;
  readonly deliveryCategory: "received" | "sent";
  readonly content: string;
  readonly createdAt: string;
}
