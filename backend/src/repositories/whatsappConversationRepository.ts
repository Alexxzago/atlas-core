import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WhatsAppConversationRepositoryPort } from "../whatsapp/application/ports.js";
import { reconstructWhatsAppConversationBinding, whatsAppConnectionId, type WhatsAppConversationBinding } from "../whatsapp/domain/whatsappConnection.js";
import { conversationId, conversationParticipantId } from "../conversation/domain/conversation.js";

interface Row { id:string; whatsapp_connection_id:string; wa_id:string; conversation_id:string; customer_participant_id:string; assistant_participant_id:string; created_at:string; updated_at:string; }
function binding(row: Row): WhatsAppConversationBinding { return reconstructWhatsAppConversationBinding({ id: row.id as WhatsAppConversationBinding["id"], whatsAppConnectionId: whatsAppConnectionId(row.whatsapp_connection_id), waId: row.wa_id, conversationId: conversationId(row.conversation_id), customerParticipantId: conversationParticipantId(row.customer_participant_id), assistantParticipantId: conversationParticipantId(row.assistant_participant_id), createdAt: row.created_at, updatedAt: row.updated_at }); }

export class WhatsAppConversationRepository implements WhatsAppConversationRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public findBinding(connectionId: ReturnType<typeof whatsAppConnectionId>, waId: string): WhatsAppConversationBinding | null {
    const row = this.db.prepare("SELECT b.* FROM whatsapp_conversation_bindings b JOIN whatsapp_connections wc ON wc.id=b.whatsapp_connection_id JOIN conversations c ON c.id=b.conversation_id AND c.company_id=wc.company_id AND c.channel='whatsapp' JOIN conversation_participants customer ON customer.id=b.customer_participant_id AND customer.conversation_id=c.id JOIN conversation_participants assistant ON assistant.id=b.assistant_participant_id AND assistant.conversation_id=c.id WHERE b.whatsapp_connection_id=? AND b.wa_id=?").get(connectionId, waId) as Row | undefined;
    return row ? binding(row) : null;
  }

  public findBindingByConversation(context: import("../types/workspaceContext.js").WorkspaceContext, companyId: number, conversationIdValue: import("../conversation/domain/conversation.js").ConversationId): WhatsAppConversationBinding | null {
    const row = this.db.prepare("SELECT b.* FROM whatsapp_conversation_bindings b JOIN whatsapp_connections wc ON wc.id=b.whatsapp_connection_id JOIN companies co ON co.id=wc.company_id JOIN conversations c ON c.id=b.conversation_id AND c.company_id=wc.company_id AND c.channel='whatsapp' WHERE co.workspace_id=? AND wc.workspace_id=? AND wc.company_id=? AND c.id=?").get(context.workspaceId, context.workspaceId, companyId, conversationIdValue) as Row | undefined;
    return row ? binding(row) : null;
  }

  public createBinding(value: WhatsAppConversationBinding): WhatsAppConversationBinding | null {
    const result = this.db.prepare("INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) SELECT ?,wc.id,?,c.id,customer.id,assistant.id,?,? FROM whatsapp_connections wc JOIN conversations c ON c.id=? AND c.company_id=wc.company_id AND c.channel='whatsapp' JOIN conversation_participants customer ON customer.id=? AND customer.conversation_id=c.id JOIN conversation_participants assistant ON assistant.id=? AND assistant.conversation_id=c.id WHERE wc.id=?").run(value.id, value.waId, value.createdAt, value.updatedAt, value.conversationId, value.customerParticipantId, value.assistantParticipantId, value.whatsAppConnectionId);
    return result.changes === 1 ? this.findBinding(value.whatsAppConnectionId, value.waId) : null;
  }
}
