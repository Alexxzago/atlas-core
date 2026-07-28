import type { WebChatSession, WebChatSessionId, WebChatSessionState } from "../domain/webChatSession.js";

export interface WebChatSessionRepositoryPort {
  transaction<T>(operation: () => T): T;
  create(session: WebChatSession): WebChatSession;
  findByTokenDigest(tokenDigest: string): WebChatSession | null;
  findForCloseByTokenDigest(tokenDigest: string, connectionPublicId: string): WebChatSession | null;
  updateLastSeen(id: WebChatSessionId, expectedState: "active", updatedAt: string, lastSeenAt: string): WebChatSession | null;
  updateState(id: WebChatSessionId, expectedState: "active", state: WebChatSessionState, updatedAt: string): WebChatSession | null;
}
