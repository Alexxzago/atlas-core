import { randomUUID } from "node:crypto";
import type { ConversationRepositoryPort } from "../../conversation/application/ports.js";
import { type ConversationId, type ConversationMessageId } from "../../conversation/domain/conversation.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { OutboundDeliveryRepositoryPort, ProviderMessageRecordRepositoryPort } from "../../transport/application/ports.js";
import { outboundDeliveryId, providerMessageRecordId, reconstructOutboundDelivery, reconstructProviderMessageRecord, type OutboundDelivery } from "../../transport/domain/providerDelivery.js";
import type { WhatsAppConnectionId } from "../domain/whatsappConnection.js";
import type { WhatsAppCloudApiPort } from "../providers/WhatsAppCloudApiProvider.js";
import type { WhatsAppConnectionRepositoryPort, WhatsAppCredentialResolverPort } from "../application/ports.js";

export class WhatsAppOutboundDeliveryValidationError extends Error {}

export interface WhatsAppOutboundDeliveryResult {
  readonly id: string;
  readonly state: "accepted" | "uncertain";
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
    if (createdDelivery === null) return safe(delivery);
    try {
      const token = this.credentials.resolve(context, companyId, connection.id);
      if (!token) throw new Error("WhatsApp credentials are unavailable.");
      const externalMessageId = await this.apiFactory(token).sendText(connection.phoneNumberId, input.recipientWaId, message.content);
      this.providerMessages.attachExternalMessageId(record.id, externalMessageId, this.clock.now());
      const accepted = this.deliveries.updateState(delivery.id, "accepted", null, this.clock.now());
      return safe(accepted ?? delivery);
    } catch {
      const uncertain = this.deliveries.updateState(delivery.id, "uncertain", "provider_unavailable", this.clock.now());
      return safe(uncertain ?? delivery);
    }
  }
}

function safe(value: OutboundDelivery): WhatsAppOutboundDeliveryResult {
  return Object.freeze({ id: value.id, state: value.state === "accepted" ? "accepted" : "uncertain" });
}
