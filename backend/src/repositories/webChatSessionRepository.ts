import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WebChatSessionRepositoryPort } from "../webChat/application/sessionPorts.js";
import { conversationId, conversationParticipantId } from "../conversation/domain/conversation.js";
import { webChatConnectionId } from "../webChat/domain/webChatConnection.js";
import { reconstructWebChatSession, type WebChatSession, type WebChatSessionId, type WebChatSessionState } from "../webChat/domain/webChatSession.js";

interface Row { id:string; web_chat_connection_id:string; conversation_id:string; visitor_participant_id:string; responder_participant_id:string; token_digest:string; state:WebChatSessionState; created_at:string; updated_at:string; expires_at:string; last_seen_at:string; }
function session(row: Row): WebChatSession { return reconstructWebChatSession({ id: row.id as WebChatSessionId, webChatConnectionId: webChatConnectionId(row.web_chat_connection_id), conversationId: conversationId(row.conversation_id), visitorParticipantId: conversationParticipantId(row.visitor_participant_id), responderParticipantId: conversationParticipantId(row.responder_participant_id), tokenDigest: row.token_digest, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at }); }

export class WebChatSessionRepository implements WebChatSessionRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}
  public transaction<T>(operation: () => T): T { try { this.db.exec("BEGIN IMMEDIATE"); const result = operation(); this.db.exec("COMMIT"); return result; } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; } }
  public create(value: WebChatSession): WebChatSession {
    this.db.prepare("INSERT INTO web_chat_sessions(id,web_chat_connection_id,conversation_id,visitor_participant_id,responder_participant_id,token_digest,state,created_at,updated_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(value.id,value.webChatConnectionId,value.conversationId,value.visitorParticipantId,value.responderParticipantId,value.tokenDigest,value.state,value.createdAt,value.updatedAt,value.expiresAt,value.lastSeenAt);
    return value;
  }
  public findByTokenDigest(digest: string): WebChatSession | null { const row = this.db.prepare("SELECT s.* FROM web_chat_sessions s JOIN web_chat_connections c ON c.id=s.web_chat_connection_id JOIN companies co ON co.id=c.company_id AND co.workspace_id=c.workspace_id JOIN assistant_profiles p ON p.id=c.assistant_profile_id AND p.company_id=co.id JOIN conversations v ON v.id=s.conversation_id AND v.company_id=co.id JOIN conversation_participants visitor ON visitor.id=s.visitor_participant_id AND visitor.conversation_id=v.id JOIN conversation_participants responder ON responder.id=s.responder_participant_id AND responder.conversation_id=v.id WHERE s.token_digest=?").get(digest) as Row | undefined; return row ? session(row) : null; }
  public findForCloseByTokenDigest(digest: string, connectionPublicId: string): WebChatSession | null { const row = this.db.prepare("SELECT s.* FROM web_chat_sessions s JOIN web_chat_connections c ON c.id=s.web_chat_connection_id WHERE s.token_digest=? AND c.public_id=?").get(digest, connectionPublicId) as Row | undefined; return row ? session(row) : null; }
  public updateLastSeen(id: WebChatSessionId, expectedState: "active", updatedAt: string, lastSeenAt: string): WebChatSession | null { const result=this.db.prepare("UPDATE web_chat_sessions SET updated_at=?,last_seen_at=? WHERE id=? AND state=?").run(updatedAt,lastSeenAt,id,expectedState); return result.changes===1?this.findById(id):null; }
  public updateState(id: WebChatSessionId, expectedState: "active", state: WebChatSessionState, updatedAt: string): WebChatSession | null { const result=this.db.prepare("UPDATE web_chat_sessions SET state=?,updated_at=? WHERE id=? AND state=?").run(state,updatedAt,id,expectedState); return result.changes===1?this.findById(id):null; }
  private findById(id: WebChatSessionId): WebChatSession | null { const row=this.db.prepare("SELECT * FROM web_chat_sessions WHERE id=?").get(id) as Row|undefined; return row?session(row):null; }
}
