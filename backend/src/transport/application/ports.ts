import type { ChannelExecutionRequest, ChannelExecutionRequestId, ChannelProviderEvent, ChannelProviderEventId, MediaGateRecomputeOutcome, OutboundDelivery, OutboundDeliveryId, ProviderEventProcessingState, ProviderMessageRecord, ProviderMessageRecordId } from "../domain/providerDelivery.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationMessage } from "../../conversation/domain/conversation.js";
import type { WhatsAppInboundMedia } from "../../whatsapp/domain/whatsappInboundMedia.js";

export interface ChannelProviderEventRepositoryPort {
  claim(event: ChannelProviderEvent): { readonly event: ChannelProviderEvent; readonly claimed: boolean };
  findByTransportProviderAndExternalEventId(transportProvider: string, externalEventId: string): ChannelProviderEvent | null;
  updateState(id: ChannelProviderEventId, expectedState: ProviderEventProcessingState, state: ProviderEventProcessingState, updatedAt: string): ChannelProviderEvent | null;
  captureInbound(event: ChannelProviderEvent, inbound: ConversationMessage, providerMessage: ProviderMessageRecord): { readonly event: ChannelProviderEvent; readonly inbound: ConversationMessage; readonly claimed: boolean };
  listRecoverable(transportProvider: string, limit: number): ChannelProviderEvent[];
  acquireForRecovery(id: ChannelProviderEventId, staleBefore: string, updatedAt: string): ChannelProviderEvent | null;
  captureInboundExecution(event: ChannelProviderEvent, inbound: ConversationMessage, providerMessage: ProviderMessageRecord, request: ChannelExecutionRequest, media?: readonly WhatsAppInboundMedia[]): { readonly event: ChannelProviderEvent; readonly inbound: ConversationMessage; readonly request: ChannelExecutionRequest; readonly media: readonly WhatsAppInboundMedia[]; readonly claimed: boolean };
  leaseExecutionRequests(owner: string, now: string, expiresAt: string, limit: number): ChannelExecutionRequest[];
  recomputeExecutionMediaGate(context: WorkspaceContext, companyId: number, connectionId: string, executionRequestId: ChannelExecutionRequestId, updatedAt: string): MediaGateRecomputeOutcome;
  completeExecutionRequest(id: ChannelExecutionRequestId, owner: string, state: "completed" | "failed", outcome: string | null, updatedAt: string): ChannelExecutionRequest | null;
  releaseExecutionRequest(id: ChannelExecutionRequestId, owner: string, updatedAt: string): ChannelExecutionRequest | null;
  captureUnsupportedExecution(event: ChannelProviderEvent, request: ChannelExecutionRequest): { readonly event: ChannelProviderEvent; readonly request: ChannelExecutionRequest; readonly claimed: boolean };
}

export interface ProviderMessageRecordRepositoryPort {
  create(record: ProviderMessageRecord): ProviderMessageRecord | null;
  findById(id: ProviderMessageRecordId): ProviderMessageRecord | null;
  findByMessageAndConnection(transportProvider: string, transportConnectionId: string, conversationMessageId: string): ProviderMessageRecord | null;
  attachExternalMessageId(id: ProviderMessageRecordId, externalMessageId: string, updatedAt: string): ProviderMessageRecord | null;
  findByTransportProviderAndExternalMessageId(transportProvider: string, externalMessageId: string): ProviderMessageRecord | null;
}

export interface OutboundDeliveryRepositoryPort {
  create(delivery: OutboundDelivery): OutboundDelivery | null;
  findById(id: OutboundDeliveryId): OutboundDelivery | null;
  findByProviderMessageRecordAndConnection(providerMessageRecordId: string, transportConnectionId: string): OutboundDelivery | null;
  updateState(id: OutboundDeliveryId, state: OutboundDelivery["state"], safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null;
  compareAndSetState(id: OutboundDeliveryId, expectedState: OutboundDelivery["state"], state: OutboundDelivery["state"], safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null;
  leaseReady(owner: string, now: string, expiresAt: string, limit: number): OutboundDelivery[];
  completeLease(id: OutboundDeliveryId, owner: string, state: "accepted" | "uncertain", safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null;
  retryLease(id: OutboundDeliveryId, owner: string, nextAttemptAt: string, safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null;
  settleLease(id: OutboundDeliveryId, owner: string, outcome: "accepted" | "retryable" | "permanent_failure", nextAttemptAt: string | null, safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null;
}
