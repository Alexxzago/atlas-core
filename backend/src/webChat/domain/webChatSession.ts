import type { ConversationId, ConversationParticipantId } from "../../conversation/domain/conversation.js";
import type { WebChatConnectionId } from "./webChatConnection.js";

export type WebChatSessionId = string & { readonly __brand: "WebChatSessionId" };
export type WebChatSessionState = "active" | "expired" | "closed";

export interface WebChatSession {
  readonly id: WebChatSessionId;
  readonly webChatConnectionId: WebChatConnectionId;
  readonly conversationId: ConversationId;
  readonly visitorParticipantId: ConversationParticipantId;
  readonly responderParticipantId: ConversationParticipantId;
  readonly tokenDigest: string;
  readonly state: WebChatSessionState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

export class WebChatSessionDomainError extends Error {}
export function webChatSessionId(value: string): WebChatSessionId { if (!/^wcs_[0-9a-f]{32}$/.test(value)) throw new WebChatSessionDomainError("Web Chat Session identifier is invalid."); return value as WebChatSessionId; }
export function webChatSessionState(value: string): WebChatSessionState { if (value !== "active" && value !== "expired" && value !== "closed") throw new WebChatSessionDomainError("Web Chat Session state is invalid."); return value; }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new WebChatSessionDomainError("Web Chat Session timestamp is invalid."); return value; }

export function reconstructWebChatSession(value: WebChatSession): WebChatSession {
  const createdAt = timestamp(value.createdAt), updatedAt = timestamp(value.updatedAt), expiresAt = timestamp(value.expiresAt), lastSeenAt = timestamp(value.lastSeenAt);
  if (!/^[0-9a-f]{64}$/.test(value.tokenDigest) || Date.parse(expiresAt) <= Date.parse(createdAt) || Date.parse(lastSeenAt) < Date.parse(createdAt)) throw new WebChatSessionDomainError("Web Chat Session state is invalid.");
  return Object.freeze({ ...value, id: webChatSessionId(value.id), state: webChatSessionState(value.state), createdAt, updatedAt, expiresAt, lastSeenAt });
}
