import { communicationChannel, conversationId, conversationMessageDirection, conversationMessageId, type CommunicationChannel, type ConversationId, type ConversationMessageDirection, type ConversationMessageId } from "../../conversation/domain/conversation.js";

export type ChannelProviderEventId = string & { readonly __brand: "ChannelProviderEventId" };
export type ProviderMessageRecordId = string & { readonly __brand: "ProviderMessageRecordId" };
export type OutboundDeliveryId = string & { readonly __brand: "OutboundDeliveryId" };
export type ProviderEventProcessingState = "claimed" | "processing" | "completed" | "failed";
export type OutboundDeliveryState = "pending" | "leased" | "accepted" | "retryable" | "permanent_failure" | "uncertain";

export interface ChannelProviderEvent {
  readonly id: ChannelProviderEventId;
  readonly communicationChannel: CommunicationChannel;
  readonly transportProvider: string;
  readonly transportConnectionId: string;
  readonly externalEventId: string;
  readonly state: ProviderEventProcessingState;
  readonly conversationId: ConversationId | null;
  readonly conversationMessageId: ConversationMessageId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderMessageRecord {
  readonly id: ProviderMessageRecordId;
  readonly communicationChannel: CommunicationChannel;
  readonly transportProvider: string;
  readonly direction: ConversationMessageDirection;
  readonly transportConnectionId: string;
  readonly conversationMessageId: ConversationMessageId;
  readonly externalMessageId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutboundDelivery {
  readonly id: OutboundDeliveryId;
  readonly providerMessageRecordId: ProviderMessageRecordId;
  readonly transportConnectionId: string;
  readonly state: OutboundDeliveryState;
  readonly attemptCount: number;
  readonly nextAttemptAt: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly safeErrorCategory: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ProviderDeliveryDomainError extends Error {}

function opaque<T extends string>(value: string, prefix: string): T { if (!new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value)) throw new ProviderDeliveryDomainError("Transport identifier is invalid."); return value as T; }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ProviderDeliveryDomainError("Transport timestamp is invalid."); return value; }
function value(valueToValidate: string, label: string, maximum = 256): string { const normalized = valueToValidate.normalize("NFKC").trim(); if (!normalized || Array.from(normalized).length > maximum) throw new ProviderDeliveryDomainError(`${label} is invalid.`); return normalized; }

export function channelProviderEventId(valueToValidate: string): ChannelProviderEventId { return opaque<ChannelProviderEventId>(valueToValidate, "cpe"); }
export function providerMessageRecordId(valueToValidate: string): ProviderMessageRecordId { return opaque<ProviderMessageRecordId>(valueToValidate, "pmr"); }
export function outboundDeliveryId(valueToValidate: string): OutboundDeliveryId { return opaque<OutboundDeliveryId>(valueToValidate, "odl"); }
export function transportProvider(valueToValidate: string): string { const normalized = value(valueToValidate, "Transport Provider", 64); if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) throw new ProviderDeliveryDomainError("Transport Provider is invalid."); return normalized; }
export function providerEventProcessingState(valueToValidate: string): ProviderEventProcessingState { if (valueToValidate !== "claimed" && valueToValidate !== "processing" && valueToValidate !== "completed" && valueToValidate !== "failed") throw new ProviderDeliveryDomainError("Provider event state is invalid."); return valueToValidate; }
export function outboundDeliveryState(valueToValidate: string): OutboundDeliveryState { if (valueToValidate !== "pending" && valueToValidate !== "leased" && valueToValidate !== "accepted" && valueToValidate !== "retryable" && valueToValidate !== "permanent_failure" && valueToValidate !== "uncertain") throw new ProviderDeliveryDomainError("Outbound Delivery state is invalid."); return valueToValidate; }

export function reconstructChannelProviderEvent(record: ChannelProviderEvent): ChannelProviderEvent { return Object.freeze({ ...record, id: channelProviderEventId(record.id), communicationChannel: communicationChannel(record.communicationChannel), transportProvider: transportProvider(record.transportProvider), transportConnectionId: value(record.transportConnectionId, "Transport Connection ID"), externalEventId: value(record.externalEventId, "External Event ID"), state: providerEventProcessingState(record.state), conversationId: record.conversationId === null ? null : conversationId(record.conversationId), conversationMessageId: record.conversationMessageId === null ? null : conversationMessageId(record.conversationMessageId), createdAt: timestamp(record.createdAt), updatedAt: timestamp(record.updatedAt) }); }
export function reconstructProviderMessageRecord(record: ProviderMessageRecord): ProviderMessageRecord { return Object.freeze({ ...record, id: providerMessageRecordId(record.id), communicationChannel: communicationChannel(record.communicationChannel), transportProvider: transportProvider(record.transportProvider), direction: conversationMessageDirection(record.direction), transportConnectionId: value(record.transportConnectionId, "Transport Connection ID"), conversationMessageId: conversationMessageId(record.conversationMessageId), externalMessageId: record.externalMessageId === null ? null : value(record.externalMessageId, "External Message ID"), createdAt: timestamp(record.createdAt), updatedAt: timestamp(record.updatedAt) }); }
export function reconstructOutboundDelivery(record: OutboundDelivery): OutboundDelivery { const owner = record.leaseOwner === null ? null : value(record.leaseOwner, "Lease Owner", 128), expiry = record.leaseExpiresAt === null ? null : timestamp(record.leaseExpiresAt); if ((owner === null) !== (expiry === null) || !Number.isSafeInteger(record.attemptCount) || record.attemptCount < 0) throw new ProviderDeliveryDomainError("Outbound Delivery state is invalid."); return Object.freeze({ ...record, id: outboundDeliveryId(record.id), providerMessageRecordId: providerMessageRecordId(record.providerMessageRecordId), transportConnectionId: value(record.transportConnectionId, "Transport Connection ID"), state: outboundDeliveryState(record.state), nextAttemptAt: timestamp(record.nextAttemptAt), leaseOwner: owner, leaseExpiresAt: expiry, safeErrorCategory: record.safeErrorCategory === null ? null : transportProvider(record.safeErrorCategory), createdAt: timestamp(record.createdAt), updatedAt: timestamp(record.updatedAt) }); }
