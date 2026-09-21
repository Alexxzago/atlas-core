import type { WebChatSession, WebChatSessionId, WebChatSessionState } from "../domain/webChatSession.js";

export interface WebChatSessionRepositoryPort {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  create(session: WebChatSession): Promise<WebChatSession>;
  findByTokenDigest(tokenDigest: string): Promise<WebChatSession | null>;
  findForCloseByTokenDigest(tokenDigest: string, connectionPublicId: string): Promise<WebChatSession | null>;
  updateLastSeen(id: WebChatSessionId, expectedState: "active", updatedAt: string, lastSeenAt: string): Promise<WebChatSession | null>;
  updateState(id: WebChatSessionId, expectedState: "active", state: WebChatSessionState, updatedAt: string): Promise<WebChatSession | null>;
}

export type PublicWebChatTurnClaim =
  | { readonly kind: "acquired" }
  | { readonly kind: "succeeded"; readonly message: string }
  | { readonly kind: "failed" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "mismatch" };

/** Durable public-turn claim; the database unique key is the multi-instance boundary. */
export interface PublicWebChatTurnRepositoryPort {
  claim(sessionId: string, idempotencyKeyDigest: string, contentDigest: string, createdAt: string): Promise<PublicWebChatTurnClaim>;
  abandon(sessionId: string, idempotencyKeyDigest: string): Promise<void>;
  succeed(sessionId: string, idempotencyKeyDigest: string, inboundMessageId: string, executionRecordId: string, message: string, completedAt: string): Promise<void>;
  fail(sessionId: string, idempotencyKeyDigest: string, inboundMessageId: string | null, completedAt: string): Promise<void>;
  requestHumanHandoff(workspaceId: number, companyId: number, conversationId: string, occurredAt: string): Promise<void>;
}

/** Temporary contract for the synchronous public web-chat runtime. */
export interface SynchronousWebChatSessionRepositoryPort {
  transaction<T>(operation: () => T): T;
  create(session: WebChatSession): WebChatSession;
  findByTokenDigest(tokenDigest: string): WebChatSession | null;
  findForCloseByTokenDigest(tokenDigest: string, connectionPublicId: string): WebChatSession | null;
  updateLastSeen(id: WebChatSessionId, expectedState: "active", updatedAt: string, lastSeenAt: string): WebChatSession | null;
  updateState(id: WebChatSessionId, expectedState: "active", state: WebChatSessionState, updatedAt: string): WebChatSession | null;
}
