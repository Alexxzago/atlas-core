import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { ChannelProviderEventRepositoryPort } from "../transport/application/ports.js";
import { reconstructChannelProviderEvent, type ChannelProviderEvent, type ChannelProviderEventId, type ProviderEventProcessingState } from "../transport/domain/providerDelivery.js";
import { communicationChannel, conversationId, conversationMessageId } from "../conversation/domain/conversation.js";

interface Row { id:string; communication_channel:string; transport_provider:string; transport_connection_id:string; external_event_id:string; state:ProviderEventProcessingState; conversation_id:string|null; conversation_message_id:string|null; created_at:string; updated_at:string; }
function event(row: Row): ChannelProviderEvent { return reconstructChannelProviderEvent({ id: row.id as ChannelProviderEventId, communicationChannel: communicationChannel(row.communication_channel), transportProvider: row.transport_provider, transportConnectionId: row.transport_connection_id, externalEventId: row.external_event_id, state: row.state, conversationId: row.conversation_id === null ? null : conversationId(row.conversation_id), conversationMessageId: row.conversation_message_id === null ? null : conversationMessageId(row.conversation_message_id), createdAt: row.created_at, updatedAt: row.updated_at }); }

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
}
