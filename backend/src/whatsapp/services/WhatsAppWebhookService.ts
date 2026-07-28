import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { OperationalConversationTurnService } from "../../assistant/services/operationalConversationTurnService.js";
import type { ConversationService } from "../../conversation/services/conversationService.js";
import { channelProviderEventId, reconstructChannelProviderEvent } from "../../transport/domain/providerDelivery.js";
import type { ChannelProviderEventRepositoryPort } from "../../transport/application/ports.js";
import type { ProviderMessageRecordRepositoryPort, OutboundDeliveryRepositoryPort } from "../../transport/application/ports.js";
import { outboundDeliveryId, providerMessageRecordId, reconstructOutboundDelivery, reconstructProviderMessageRecord } from "../../transport/domain/providerDelivery.js";
import type { WhatsAppCloudApiPort } from "../providers/WhatsAppCloudApiProvider.js";
import { reconstructWhatsAppConversationBinding, whatsAppConversationBindingId } from "../domain/whatsappConnection.js";
import type { WhatsAppConversationRepositoryPort } from "../application/ports.js";
import type { WhatsAppConnectionService } from "./WhatsAppConnectionService.js";

export interface WhatsAppWebhookConfiguration { readonly appSecret: string; readonly verifyToken: string; }
export interface WhatsAppInboundTextMessage { readonly phoneNumberId: string; readonly waId: string; readonly wamid: string; readonly text: string; }

export class WhatsAppWebhookService {
  public constructor(private readonly configuration: WhatsAppWebhookConfiguration, private readonly connections?: WhatsAppConnectionService, private readonly bindings?: WhatsAppConversationRepositoryPort, private readonly events?: ChannelProviderEventRepositoryPort, private readonly conversations?: ConversationService, private readonly turns?: OperationalConversationTurnService, private readonly clock: { now(): string } = { now: () => new Date().toISOString() }, private readonly messages?: ProviderMessageRecordRepositoryPort, private readonly deliveries?: OutboundDeliveryRepositoryPort, private readonly api?: WhatsAppCloudApiPort) {}
  public verify(mode: unknown, token: unknown, challenge: unknown): string | null { return this.configuration.verifyToken.length > 0 && mode === "subscribe" && typeof token === "string" && token === this.configuration.verifyToken && typeof challenge === "string" ? challenge : null; }
  public signatureValid(raw: Buffer, header: unknown): boolean {
    if (!this.configuration.appSecret || typeof header !== "string" || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
    const expected = Buffer.from(createHmac("sha256", this.configuration.appSecret).update(raw).digest("hex"), "hex"), provided = Buffer.from(header.slice(7), "hex");
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
  public parse(raw: Buffer): readonly WhatsAppInboundTextMessage[] {
    let value: unknown; try { value = JSON.parse(raw.toString("utf8")); } catch { return []; }
    if (!value || typeof value !== "object") return [];
    const entries = (value as { entry?: unknown }).entry; if (!Array.isArray(entries)) return [];
    const messages: WhatsAppInboundTextMessage[] = [];
    for (const entry of entries) if (entry && typeof entry === "object") {
      const changes = (entry as { changes?: unknown }).changes; if (!Array.isArray(changes)) continue;
      for (const change of changes) if (change && typeof change === "object") {
        const record = change as { field?: unknown; value?: unknown }; if (record.field !== "messages" || !record.value || typeof record.value !== "object") continue;
        const payload = record.value as { metadata?: { phone_number_id?: unknown }; messages?: unknown };
        if (typeof payload.metadata?.phone_number_id !== "string" || !Array.isArray(payload.messages)) continue;
        for (const message of payload.messages) if (message && typeof message === "object") {
          const input = message as { type?: unknown; from?: unknown; id?: unknown; text?: { body?: unknown } };
          if (input.type === "text" && typeof input.from === "string" && typeof input.id === "string" && typeof input.text?.body === "string") messages.push({ phoneNumberId: payload.metadata.phone_number_id, waId: input.from, wamid: input.id, text: input.text.body });
        }
      }
    }
    return messages;
  }
  public async receive(raw: Buffer): Promise<void> { for (const message of this.parse(raw)) await this.process(message); }
  private async process(message: WhatsAppInboundTextMessage): Promise<void> {
    if (!this.connections || !this.bindings || !this.events || !this.conversations || !this.turns) return;
    const connection = this.connections.resolveActiveByPhoneNumberId(message.phoneNumberId); if (!connection) return;
    const now = this.clock.now(), claimed = this.events.claim(reconstructChannelProviderEvent({ id: channelProviderEventId(`cpe_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", transportConnectionId: connection.id, externalEventId: message.wamid, state: "claimed", conversationId: null, conversationMessageId: null, createdAt: now, updatedAt: now }));
    if (!claimed.claimed) return;
    const context = { workspaceId: connection.workspaceId, workspaceKey: "whatsapp" }, existing = this.bindings.findBinding(connection.id, message.waId);
    const binding = existing ?? (() => { const conversation = this.conversations!.open(context, connection.companyId, "whatsapp"), customer = this.conversations!.addParticipant(context, connection.companyId, conversation.id, { type: "whatsapp_contact", reference: message.waId }), assistant = this.conversations!.addParticipant(context, connection.companyId, conversation.id, { type: "assistant", reference: connection.assistantProfileId }); return this.bindings!.createBinding(reconstructWhatsAppConversationBinding({ id: whatsAppConversationBindingId(`wcb_${randomUUID().replaceAll("-", "")}`), whatsAppConnectionId: connection.id, waId: message.waId, conversationId: conversation.id, customerParticipantId: customer.id, assistantParticipantId: assistant.id, createdAt: now, updatedAt: now })); })();
    if (!binding) return;
    let turn; try { turn = await this.turns.execute(context, connection.companyId, binding.conversationId, { assistantProfileId: connection.assistantProfileId, inboundParticipantId: binding.customerParticipantId, outboundParticipantId: binding.assistantParticipantId, content: message.text }); } catch (error) { this.events.updateState(claimed.event.id, "claimed", "failed", this.clock.now()); throw error; }
    if (this.messages && this.deliveries && this.api) { const inbound=this.messages.create(reconstructProviderMessageRecord({id:providerMessageRecordId(`pmr_${randomUUID().replaceAll("-","")}`),communicationChannel:"whatsapp",transportProvider:"meta_whatsapp_cloud",direction:"inbound",transportConnectionId:connection.id,conversationMessageId:turn.inbound.id,externalMessageId:message.wamid,createdAt:now,updatedAt:now})); const outbound=this.messages.create(reconstructProviderMessageRecord({id:providerMessageRecordId(`pmr_${randomUUID().replaceAll("-","")}`),communicationChannel:"whatsapp",transportProvider:"meta_whatsapp_cloud",direction:"outbound",transportConnectionId:connection.id,conversationMessageId:turn.outbound.id,externalMessageId:null,createdAt:now,updatedAt:now})); if(inbound&&outbound){const delivery=this.deliveries.create(reconstructOutboundDelivery({id:outboundDeliveryId(`odl_${randomUUID().replaceAll("-","")}`),providerMessageRecordId:outbound.id,transportConnectionId:connection.id,state:"pending",attemptCount:0,nextAttemptAt:now,leaseOwner:null,leaseExpiresAt:null,safeErrorCategory:null,createdAt:now,updatedAt:now})); if(delivery){try{const external=await this.api.sendText(connection.phoneNumberId,message.waId,turn.outbound.content);this.messages.attachExternalMessageId(outbound.id,external,this.clock.now());this.deliveries.updateState(delivery.id,"accepted",null,this.clock.now());}catch{this.deliveries.updateState(delivery.id,"uncertain","provider_unavailable",this.clock.now());}}}}
    this.events.updateState(claimed.event.id, "claimed", "completed", this.clock.now());
  }
}
