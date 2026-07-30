import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { ChannelProviderEventRepositoryPort } from "../transport/application/ports.js";
import { reconstructChannelProviderEvent, type ChannelProviderEvent, type ChannelProviderEventId, type ProviderEventProcessingState } from "../transport/domain/providerDelivery.js";
import { communicationChannel, conversationId, conversationMessageId, reconstructConversationMessage, type ConversationMessage } from "../conversation/domain/conversation.js";

interface Row { id:string; communication_channel:string; transport_provider:string; transport_connection_id:string; external_event_id:string; state:ProviderEventProcessingState; conversation_id:string|null; conversation_message_id:string|null; created_at:string; updated_at:string; }
interface MessageRow { id:string; conversation_id:string; sender_participant_id:string; direction:"inbound"|"outbound"; content:string; idempotency_key:string|null; assistant_execution_record_id:string|null; created_at:string; }
function event(row: Row): ChannelProviderEvent { return reconstructChannelProviderEvent({ id: row.id as ChannelProviderEventId, communicationChannel: communicationChannel(row.communication_channel), transportProvider: row.transport_provider, transportConnectionId: row.transport_connection_id, externalEventId: row.external_event_id, state: row.state, conversationId: row.conversation_id === null ? null : conversationId(row.conversation_id), conversationMessageId: row.conversation_message_id === null ? null : conversationMessageId(row.conversation_message_id), createdAt: row.created_at, updatedAt: row.updated_at }); }
function message(row: MessageRow): ConversationMessage { return reconstructConversationMessage({ id: conversationMessageId(row.id), conversationId: conversationId(row.conversation_id), senderParticipantId: row.sender_participant_id as ConversationMessage["senderParticipantId"], direction: row.direction, content: row.content, idempotencyKey: row.idempotency_key, executionRecordId: row.assistant_execution_record_id, createdAt: row.created_at }); }

export class ChannelProviderEventRepository implements ChannelProviderEventRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public claim(value: ChannelProviderEvent): { readonly event: ChannelProviderEvent; readonly claimed: boolean } {
    const result = this.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transport_provider,external_event_id) DO UPDATE SET state='claimed',updated_at=excluded.updated_at WHERE channel_provider_events.state='failed'").run(value.id, value.communicationChannel, value.transportProvider, value.transportConnectionId, value.externalEventId, value.state, value.conversationId, value.conversationMessageId, value.createdAt, value.updatedAt);
    const current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId);
    if (!current) throw new Error("Channel Provider Event could not be read after claim.");
    return { event: current, claimed: result.changes === 1 };
  }

  public findByTransportProviderAndExternalEventId(transportProvider: string, externalEventId: string): ChannelProviderEvent | null {
    const row = this.db.prepare("SELECT * FROM channel_provider_events WHERE transport_provider=? AND external_event_id=?").get(transportProvider, externalEventId) as Row | undefined;
    return row ? event(row) : null;
  }

  public updateState(id: ChannelProviderEventId, expectedState: ProviderEventProcessingState, state: ProviderEventProcessingState, updatedAt: string): ChannelProviderEvent | null {
    const result = this.db.prepare("UPDATE channel_provider_events SET state=?,updated_at=? WHERE id=? AND state=?").run(state, updatedAt, id, expectedState);
    if (result.changes !== 1) return null;
    const row = this.db.prepare("SELECT * FROM channel_provider_events WHERE id=?").get(id) as Row | undefined;
    return row ? event(row) : null;
  }
  public captureInbound(value: ChannelProviderEvent, inbound: ConversationMessage, providerMessage: import("../transport/domain/providerDelivery.js").ProviderMessageRecord): { readonly event: ChannelProviderEvent; readonly inbound: ConversationMessage; readonly claimed: boolean } {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const inserted = this.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'claimed',NULL,NULL,?,?) ON CONFLICT(transport_provider,external_event_id) DO NOTHING").run(value.id, value.communicationChannel, value.transportProvider, value.transportConnectionId, value.externalEventId, value.createdAt, value.updatedAt).changes === 1;
      let current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId);
      if (!current) throw new Error("Channel Provider Event could not be read after capture.");
      if (current.conversationMessageId === null) {
        this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) SELECT ?,c.id,p.id,?,?,?,?,? FROM conversations c JOIN conversation_participants p ON p.id=? AND p.conversation_id=c.id WHERE c.id=? AND c.channel='whatsapp' ON CONFLICT DO NOTHING").run(inbound.id, inbound.direction, inbound.content, inbound.idempotencyKey, inbound.executionRecordId, inbound.createdAt, inbound.senderParticipantId, inbound.conversationId);
        const row = this.db.prepare("SELECT * FROM conversation_messages WHERE conversation_id=? AND idempotency_key=?").get(inbound.conversationId, inbound.idempotencyKey) as MessageRow | undefined;
        if (!row) throw new Error("Inbound conversation message could not be persisted.");
        const canonical = message(row);
        this.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(providerMessage.id, providerMessage.communicationChannel, providerMessage.transportProvider, providerMessage.direction, providerMessage.transportConnectionId, canonical.id, providerMessage.externalMessageId, providerMessage.createdAt, providerMessage.updatedAt);
        this.db.prepare("UPDATE channel_provider_events SET conversation_id=?,conversation_message_id=?,updated_at=? WHERE id=? AND conversation_message_id IS NULL").run(canonical.conversationId, canonical.id, value.updatedAt, current.id);
      }
      current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId);
      if (!current?.conversationMessageId) throw new Error("Inbound event could not be linked.");
      const row = this.db.prepare("SELECT * FROM conversation_messages WHERE id=?").get(current.conversationMessageId) as MessageRow | undefined;
      if (!row) throw new Error("Inbound conversation message could not be read.");
      this.db.exec("COMMIT;");
      return { event: current, inbound: message(row), claimed: inserted };
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public listRecoverable(transportProvider: string, limit: number): ChannelProviderEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    return (this.db.prepare("SELECT * FROM channel_provider_events WHERE transport_provider=? AND state!='completed' AND conversation_id IS NOT NULL AND conversation_message_id IS NOT NULL ORDER BY updated_at,id LIMIT ?").all(transportProvider, limit) as unknown as Row[]).map(event);
  }
  public acquireForRecovery(id: ChannelProviderEventId, staleBefore: string, updatedAt: string): ChannelProviderEvent | null {
    const result = this.db.prepare("UPDATE channel_provider_events SET state='processing',updated_at=? WHERE id=? AND (state IN ('claimed','failed') OR (state='processing' AND updated_at<=?))").run(updatedAt, id, staleBefore);
    if (result.changes !== 1) return null;
    const row = this.db.prepare("SELECT * FROM channel_provider_events WHERE id=?").get(id) as Row | undefined;
    return row ? event(row) : null;
  }
}
