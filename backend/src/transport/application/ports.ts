import type { ChannelProviderEvent, ChannelProviderEventId, OutboundDelivery, OutboundDeliveryId, ProviderEventProcessingState, ProviderMessageRecord, ProviderMessageRecordId } from "../domain/providerDelivery.js";

export interface ChannelProviderEventRepositoryPort {
  claim(event: ChannelProviderEvent): { readonly event: ChannelProviderEvent; readonly claimed: boolean };
  findByTransportProviderAndExternalEventId(transportProvider: string, externalEventId: string): ChannelProviderEvent | null;
  updateState(id: ChannelProviderEventId, expectedState: ProviderEventProcessingState, state: ProviderEventProcessingState, updatedAt: string): ChannelProviderEvent | null;
}

export interface ProviderMessageRecordRepositoryPort {
  create(record: ProviderMessageRecord): ProviderMessageRecord | null;
  findByMessageAndConnection(transportProvider: string, transportConnectionId: string, conversationMessageId: string): ProviderMessageRecord | null;
  attachExternalMessageId(id: ProviderMessageRecordId, externalMessageId: string, updatedAt: string): ProviderMessageRecord | null;
}

export interface OutboundDeliveryRepositoryPort {
  create(delivery: OutboundDelivery): OutboundDelivery | null;
  findById(id: OutboundDeliveryId): OutboundDelivery | null;
}
