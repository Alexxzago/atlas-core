import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ConversationService } from "../../conversation/services/conversationService.js";
import type { WebChatConnectionService } from "./webChatConnectionService.js";
import type { WebChatSessionRepositoryPort } from "../application/sessionPorts.js";
import { reconstructWebChatSession, webChatSessionId, type WebChatSession } from "../domain/webChatSession.js";

export class PublicWebChatSessionUnavailableError extends Error {}
export interface PublicWebChatSessionClock { now(): string; }
export interface PublicWebChatSessionResult { readonly state: "active"; readonly expiresAt: string; readonly rawToken: string; }
export interface ResolvedPublicWebChatSession { readonly workspaceId:number; readonly companyId:number; readonly assistantProfileId:string; readonly conversationId:string; readonly visitorParticipantId:string; readonly responderParticipantId:string; readonly sessionId:string; readonly expiresAt:string; }

export class PublicWebChatSessionService {
  public constructor(private readonly connections: WebChatConnectionService, private readonly conversations: ConversationService, private readonly sessions: WebChatSessionRepositoryPort, private readonly clock: PublicWebChatSessionClock, private readonly lifetimeMilliseconds = 24 * 60 * 60 * 1000) {}

  public start(connectionPublicId: unknown, currentRawToken: string | null): PublicWebChatSessionResult {
    const connection = this.connections.resolveActiveByPublicId(connectionPublicId);
    if (!connection) throw new PublicWebChatSessionUnavailableError();
    if (currentRawToken) {
      const existing = this.resolve(currentRawToken, false);
      if (existing && existing.connectionId === connection.id) return { state: "active", expiresAt: existing.context.expiresAt, rawToken: currentRawToken };
    }
    const rawToken = randomBytes(32).toString("base64url"), now = this.clock.now(), expiresAt = new Date(Date.parse(now) + this.lifetimeMilliseconds).toISOString();
    this.sessions.transaction(() => {
      const conversation = this.conversations.open({ workspaceId: connection.workspaceId, workspaceKey: "public" }, connection.companyId);
      const visitor = this.conversations.addParticipant({ workspaceId: connection.workspaceId, workspaceKey: "public" }, connection.companyId, conversation.id, { type: "anonymous_visitor", reference: null });
      const responder = this.conversations.addParticipant({ workspaceId: connection.workspaceId, workspaceKey: "public" }, connection.companyId, conversation.id, { type: "assistant", reference: connection.assistantProfileId });
      this.sessions.create(reconstructWebChatSession({ id: webChatSessionId(`wcs_${randomUUID().replaceAll("-", "")}`), webChatConnectionId: connection.id, conversationId: conversation.id, visitorParticipantId: visitor.id, responderParticipantId: responder.id, tokenDigest: digest(rawToken), state: "active", createdAt: now, updatedAt: now, expiresAt, lastSeenAt: now }));
    });
    return { state: "active", expiresAt, rawToken };
  }

  public state(connectionPublicId: unknown, rawToken: string | null): { state: "active"; expiresAt: string } {
    const connection = this.connections.resolveActiveByPublicId(connectionPublicId), resolved = rawToken ? this.resolve(rawToken, true) : null;
    if (!connection || !resolved || resolved.connectionId !== connection.id) throw new PublicWebChatSessionUnavailableError();
    return { state: "active", expiresAt: resolved.context.expiresAt };
  }

  public close(connectionPublicId: unknown, rawToken: string | null): void {
    const connection = this.connections.resolveActiveByPublicId(connectionPublicId), resolved = rawToken ? this.resolve(rawToken, false) : null;
    if (!connection || !resolved || resolved.connectionId !== connection.id) throw new PublicWebChatSessionUnavailableError();
    this.sessions.updateState(resolved.session.id, "active", "closed", this.clock.now());
  }

  public resolveSession(rawToken: string): ResolvedPublicWebChatSession | null { const resolved = this.resolve(rawToken, true); return resolved?.context ?? null; }

  private resolve(rawToken: string, touch: boolean): { session: WebChatSession; connectionId: string; context: ResolvedPublicWebChatSession } | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const session = this.sessions.findByTokenDigest(digest(rawToken));
    if (!session || session.state !== "active" || Date.parse(session.expiresAt) <= Date.parse(this.clock.now())) {
      if (session?.state === "active") this.sessions.updateState(session.id, "active", "expired", this.clock.now());
      return null;
    }
    const connection = this.connections.resolveActiveById(session.webChatConnectionId);
    if (!connection) return null;
    const updated = touch ? this.sessions.updateLastSeen(session.id, "active", this.clock.now(), this.clock.now()) ?? session : session;
    return { session: updated, connectionId: updated.webChatConnectionId, context: { workspaceId: connection.workspaceId, companyId: connection.companyId, assistantProfileId: connection.assistantProfileId, conversationId: updated.conversationId, visitorParticipantId: updated.visitorParticipantId, responderParticipantId: updated.responderParticipantId, sessionId: updated.id, expiresAt: updated.expiresAt } };
  }
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
