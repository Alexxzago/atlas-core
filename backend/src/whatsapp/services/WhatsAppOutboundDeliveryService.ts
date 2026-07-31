import { randomUUID } from "node:crypto";
import type { ConversationRepositoryPort } from "../../conversation/application/ports.js";
import { type ConversationId, type ConversationMessageId } from "../../conversation/domain/conversation.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { OutboundDeliveryRepositoryPort, ProviderMessageRecordRepositoryPort } from "../../transport/application/ports.js";
import { outboundDeliveryId, providerMessageRecordId, reconstructOutboundDelivery, reconstructProviderMessageRecord, type OutboundDelivery } from "../../transport/domain/providerDelivery.js";
import type { WhatsAppConnectionId } from "../domain/whatsappConnection.js";
import { WhatsAppCloudApiError, type WhatsAppCloudApiPort } from "../providers/WhatsAppCloudApiProvider.js";
import type { WhatsAppConnectionRepositoryPort, WhatsAppConversationRepositoryPort, WhatsAppCredentialResolverPort } from "../application/ports.js";
import type { WhatsAppConnectionService } from "./WhatsAppConnectionService.js";

export class WhatsAppOutboundDeliveryValidationError extends Error {}

export interface WhatsAppOutboundDeliveryResult {
  readonly id: string;
  readonly state: "pending" | "accepted" | "uncertain";
}

export class WhatsAppOutboundDeliveryService {
  public constructor(
    private readonly conversations: ConversationRepositoryPort,
    private readonly connections: WhatsAppConnectionRepositoryPort,
    private readonly providerMessages: ProviderMessageRecordRepositoryPort,
    private readonly deliveries: OutboundDeliveryRepositoryPort,
    private readonly credentials: WhatsAppCredentialResolverPort,
    private readonly apiFactory: (accessToken: string) => WhatsAppCloudApiPort,
    private readonly clock: { now(): string },
    private readonly operationalState?: WhatsAppConnectionService,
    private readonly bindings?: WhatsAppConversationRepositoryPort,
  ) {}

  public async deliverWhatsAppText(context: WorkspaceContext, companyId: number, input: { conversationId: ConversationId; conversationMessageId: ConversationMessageId; whatsAppConnectionId: WhatsAppConnectionId; recipientWaId: string }): Promise<WhatsAppOutboundDeliveryResult> {
    const conversation = this.conversations.findConversation(context, companyId, input.conversationId);
    const message = this.conversations.findMessage(context, companyId, input.conversationMessageId);
    const connection = this.connections.findById(context, companyId, input.whatsAppConnectionId);
    if (!conversation || !message || message.conversationId !== conversation.id || message.direction !== "outbound" || !connection || connection.status !== "active") throw new WhatsAppOutboundDeliveryValidationError("WhatsApp outbound delivery is invalid.");
    const now = this.clock.now();
    const createdRecord = this.providerMessages.create(reconstructProviderMessageRecord({ id: providerMessageRecordId(`pmr_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "outbound", transportConnectionId: connection.id, conversationMessageId: message.id, externalMessageId: null, createdAt: now, updatedAt: now }));
    const record = createdRecord ?? this.providerMessages.findByMessageAndConnection("meta_whatsapp_cloud", connection.id, message.id);
    if (!record) throw new WhatsAppOutboundDeliveryValidationError("WhatsApp provider message could not be persisted.");
    const createdDelivery = this.deliveries.create(reconstructOutboundDelivery({ id: outboundDeliveryId(`odl_${randomUUID().replaceAll("-", "")}`), providerMessageRecordId: record.id, transportConnectionId: connection.id, state: "pending", attemptCount: 0, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, safeErrorCategory: null, createdAt: now, updatedAt: now }));
    const delivery = createdDelivery ?? this.deliveries.findByProviderMessageRecordAndConnection(record.id, connection.id);
    if (!delivery) throw new WhatsAppOutboundDeliveryValidationError("WhatsApp delivery could not be persisted.");
    return safe(createdDelivery ?? delivery);
  }

  public async dispatchReady(owner: string, limit = 25): Promise<void> {
    const now = this.clock.now(), expiresAt = new Date(Date.parse(now) + 60_000).toISOString();
    for (const delivery of this.deliveries.leaseReady(owner, now, expiresAt, limit)) await this.dispatch(owner, delivery);
  }

  private async dispatch(owner: string, delivery: OutboundDelivery): Promise<void> {
    const record = this.providerMessages.findById(delivery.providerMessageRecordId);
    const connection = this.connections.findByIdForRecovery(delivery.transportConnectionId as WhatsAppConnectionId);
    if (!record || record.direction !== "outbound" || record.communicationChannel !== "whatsapp" || !connection || connection.status !== "active") {
      this.settle(owner, delivery, { outcome: "retryable", safeErrorCategory: "provider_unavailable" });
      return;
    }
    const context: WorkspaceContext = { workspaceId: connection.workspaceId, workspaceKey: "whatsapp" };
    const message = this.conversations.findMessage(context, connection.companyId, record.conversationMessageId);
    const binding = message ? this.bindings?.findBindingByConversation(context, connection.companyId, message.conversationId) : null;
    if (!message || !binding || binding.whatsAppConnectionId !== connection.id) {
      this.settle(owner, delivery, { outcome: "retryable", safeErrorCategory: "provider_unavailable" });
      return;
    }
    try {
      const token = this.credentials.resolve(context, connection.companyId, connection.id);
      if (!token) throw new Error("WhatsApp credentials are unavailable.");
      const externalMessageId = await this.apiFactory(token).sendText(connection.phoneNumberId, binding.waId, message.content);
      this.providerMessages.attachExternalMessageId(record.id, externalMessageId, this.clock.now());
      this.deliveries.settleLease(delivery.id, owner, "accepted", null, null, this.clock.now());
      this.operationalState?.recordProviderActivity(context, connection.companyId, connection.id);
    } catch (error: unknown) {
      this.settle(owner, delivery, classify(error));
      this.operationalState?.recordProviderFailure(context, connection.companyId, connection.id);
    }
  }
  private settle(owner: string, delivery: OutboundDelivery, result: DeliveryResult): void {
    const now = this.clock.now();
    const outcome = result.outcome === "retryable" && delivery.attemptCount >= maximumAttempts ? "permanent_failure" : result.outcome;
    const nextAttemptAt = outcome === "retryable" ? retryAt(now, delivery.attemptCount, result.retryAfterMilliseconds) : null;
    this.deliveries.settleLease(delivery.id, owner, outcome, nextAttemptAt, result.safeErrorCategory, now);
  }
}

function safe(value: OutboundDelivery): WhatsAppOutboundDeliveryResult {
  return Object.freeze({ id: value.id, state: value.state === "accepted" ? "accepted" : value.state === "pending" ? "pending" : "uncertain" });
}

const maximumAttempts = 5;
interface DeliveryResult { readonly outcome: "retryable" | "permanent_failure"; readonly safeErrorCategory: string; readonly retryAfterMilliseconds?: number | null; }
function classify(error: unknown): DeliveryResult { if (error instanceof WhatsAppCloudApiError) { if (error.status === 401 || error.status === 403) return { outcome: "permanent_failure", safeErrorCategory: "credentials_invalid" }; if (error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 429) return { outcome: "permanent_failure", safeErrorCategory: "provider_rejected" }; if (error.status === 429) return { outcome: "retryable", safeErrorCategory: "rate_limited", retryAfterMilliseconds: error.retryAfterMilliseconds }; } return { outcome: "retryable", safeErrorCategory: "provider_unavailable" }; }
function retryAt(now: string, attempt: number, retryAfterMilliseconds: number | null = null): string { const exponential = Math.min(300_000, 1_000 * 2 ** Math.min(attempt, 8)); const delay = Math.min(300_000, Math.max(exponential, retryAfterMilliseconds ?? 0)); return new Date(Date.parse(now) + delay).toISOString(); }
