import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { ConversationRepositoryPort } from "../conversation/application/ports.js";
import { reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant, type Conversation, type ConversationId, type ConversationMessage, type ConversationMessageId, type ConversationParticipant, type ConversationParticipantId, type ConversationState } from "../conversation/domain/conversation.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface ConversationRow { id:string; company_id:number; state:ConversationState; created_at:string; updated_at:string; closed_at:string|null; }
interface ParticipantRow { id:string; conversation_id:string; participant_type:string; reference:string|null; created_at:string; }
interface MessageRow { id:string; conversation_id:string; sender_participant_id:string; direction:"inbound"|"outbound"; content:string; idempotency_key:string|null; created_at:string; }

function conversation(row: ConversationRow): Conversation { return reconstructConversation({ id: row.id as ConversationId, companyId: row.company_id, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at }); }
function participant(row: ParticipantRow): ConversationParticipant { return reconstructConversationParticipant({ id: row.id as ConversationParticipantId, conversationId: row.conversation_id as ConversationId, type: row.participant_type, reference: row.reference, createdAt: row.created_at }); }
function message(row: MessageRow): ConversationMessage { return reconstructConversationMessage({ id: row.id as ConversationMessageId, conversationId: row.conversation_id as ConversationId, senderParticipantId: row.sender_participant_id as ConversationParticipantId, direction: row.direction, content: row.content, idempotencyKey: row.idempotency_key, createdAt: row.created_at }); }

export class ConversationRepository implements ConversationRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public findConversation(context: WorkspaceContext, companyId: number, id: ConversationId): Conversation | null {
    const row = this.db.prepare("SELECT c.* FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?").get(context.workspaceId, companyId, id) as ConversationRow | undefined;
    return row ? conversation(row) : null;
  }

  public listConversations(context: WorkspaceContext, companyId: number): Conversation[] {
    return (this.db.prepare("SELECT c.* FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? ORDER BY c.created_at DESC,c.id DESC").all(context.workspaceId, companyId) as unknown as ConversationRow[]).map(conversation);
  }

  public createConversation(context: WorkspaceContext, value: Conversation): Conversation | null {
    const result = this.db.prepare("INSERT INTO conversations(id,company_id,state,created_at,updated_at,closed_at) SELECT ?,co.id,?,?,?,? FROM companies co WHERE co.workspace_id=? AND co.id=?").run(value.id, value.state, value.createdAt, value.updatedAt, value.closedAt, context.workspaceId, value.companyId);
    return result.changes === 1 ? this.findConversation(context, value.companyId, value.id) : null;
  }

  public updateConversation(context: WorkspaceContext, companyId: number, value: Conversation, expectedState: "open"): boolean {
    return this.db.prepare("UPDATE conversations SET state=?,updated_at=?,closed_at=? WHERE id=? AND company_id=? AND company_id IN (SELECT id FROM companies WHERE workspace_id=? AND id=?) AND state=?").run(value.state, value.updatedAt, value.closedAt, value.id, companyId, context.workspaceId, companyId, expectedState).changes === 1;
  }

  public createParticipant(context: WorkspaceContext, companyId: number, value: ConversationParticipant): ConversationParticipant | null {
    const result = this.db.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) SELECT ?,c.id,?,?,? FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?").run(value.id, value.type, value.reference, value.createdAt, context.workspaceId, companyId, value.conversationId);
    return result.changes === 1 ? this.findParticipant(context, companyId, value.id) : null;
  }

  public listParticipants(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationParticipant[] {
    return (this.db.prepare("SELECT p.* FROM conversation_participants p JOIN conversations c ON c.id=p.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? ORDER BY p.created_at,p.id").all(context.workspaceId, companyId, conversationId) as unknown as ParticipantRow[]).map(participant);
  }

  public createMessage(context: WorkspaceContext, companyId: number, value: ConversationMessage): ConversationMessage | null {
    const result = this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,created_at) SELECT ?,c.id,p.id,?,?,?,? FROM conversations c JOIN conversation_participants p ON p.id=? AND p.conversation_id=c.id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?").run(value.id, value.direction, value.content, value.idempotencyKey, value.createdAt, value.senderParticipantId, context.workspaceId, companyId, value.conversationId);
    return result.changes === 1 ? this.findMessage(context, companyId, value.id) : null;
  }

  public listMessages(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationMessage[] {
    return (this.db.prepare("SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? ORDER BY m.created_at,m.id").all(context.workspaceId, companyId, conversationId) as unknown as MessageRow[]).map(message);
  }

  public findMessage(context: WorkspaceContext, companyId: number, id: ConversationMessageId): ConversationMessage | null {
    const row = this.db.prepare("SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND m.id=?").get(context.workspaceId, companyId, id) as MessageRow | undefined;
    return row ? message(row) : null;
  }

  public findParticipant(context: WorkspaceContext, companyId: number, id: ConversationParticipantId): ConversationParticipant | null {
    const row = this.db.prepare("SELECT p.* FROM conversation_participants p JOIN conversations c ON c.id=p.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND p.id=?").get(context.workspaceId, companyId, id) as ParticipantRow | undefined;
    return row ? participant(row) : null;
  }
}
