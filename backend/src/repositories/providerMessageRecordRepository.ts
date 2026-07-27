import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { ProviderMessageRecordRepositoryPort } from "../transport/application/ports.js";
import { reconstructProviderMessageRecord, type ProviderMessageRecord, type ProviderMessageRecordId } from "../transport/domain/providerDelivery.js";
import { communicationChannel, conversationMessageDirection, conversationMessageId } from "../conversation/domain/conversation.js";

interface Row { id:string; communication_channel:string; transport_provider:string; direction:string; transport_connection_id:string; conversation_message_id:string; external_message_id:string|null; created_at:string; updated_at:string; }
function record(row: Row): ProviderMessageRecord { return reconstructProviderMessageRecord({ id: row.id as ProviderMessageRecordId, communicationChannel: communicationChannel(row.communication_channel), transportProvider: row.transport_provider, direction: conversationMessageDirection(row.direction), transportConnectionId: row.transport_connection_id, conversationMessageId: conversationMessageId(row.conversation_message_id), externalMessageId: row.external_message_id, createdAt: row.created_at, updatedAt: row.updated_at }); }

export class ProviderMessageRecordRepository implements ProviderMessageRecordRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public create(value: ProviderMessageRecord): ProviderMessageRecord | null {
    const result = this.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) SELECT ?,?,?,?,?,cm.id,?,?,? FROM conversation_messages cm JOIN conversations c ON c.id=cm.conversation_id AND c.channel=? JOIN whatsapp_connections wc ON wc.id=? AND wc.company_id=c.company_id WHERE cm.id=?").run(value.id, value.communicationChannel, value.transportProvider, value.direction, value.transportConnectionId, value.externalMessageId, value.createdAt, value.updatedAt, value.communicationChannel, value.transportConnectionId, value.conversationMessageId);
    return result.changes === 1 ? this.findByMessageAndConnection(value.transportProvider, value.transportConnectionId, value.conversationMessageId) : null;
  }

  public findByMessageAndConnection(transportProvider: string, transportConnectionId: string, messageId: string): ProviderMessageRecord | null {
    const row = this.db.prepare("SELECT * FROM provider_message_records WHERE transport_provider=? AND transport_connection_id=? AND conversation_message_id=?").get(transportProvider, transportConnectionId, messageId) as Row | undefined;
    return row ? record(row) : null;
  }

  public attachExternalMessageId(id: ProviderMessageRecordId, externalMessageId: string, updatedAt: string): ProviderMessageRecord | null {
    const result = this.db.prepare("UPDATE provider_message_records SET external_message_id=?,updated_at=? WHERE id=? AND external_message_id IS NULL").run(externalMessageId, updatedAt, id);
    if (result.changes !== 1) return null;
    const row = this.db.prepare("SELECT * FROM provider_message_records WHERE id=?").get(id) as Row | undefined;
    return row ? record(row) : null;
  }
}
