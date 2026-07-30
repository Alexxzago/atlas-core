import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { OperationalConversationTurnSuppressedError, type OperationalConversationTurnService } from "../../assistant/services/operationalConversationTurnService.js";
import type { ConversationRepositoryPort } from "../../conversation/application/ports.js";
import { reconstructConversationControl } from "../../conversation/domain/conversationControl.js";
import { conversationMessageId, reconstructConversationMessage } from "../../conversation/domain/conversation.js";
import type { ConversationService } from "../../conversation/services/conversationService.js";
import { channelProviderEventId, reconstructChannelProviderEvent } from "../../transport/domain/providerDelivery.js";
import type { ChannelProviderEventRepositoryPort } from "../../transport/application/ports.js";
import type { ProviderMessageRecordRepositoryPort, OutboundDeliveryRepositoryPort } from "../../transport/application/ports.js";
import { outboundDeliveryId, providerMessageRecordId, reconstructOutboundDelivery, reconstructProviderMessageRecord } from "../../transport/domain/providerDelivery.js";
import type { WhatsAppCloudApiPort } from "../providers/WhatsAppCloudApiProvider.js";
import { reconstructWhatsAppConversationBinding, whatsAppConversationBindingId } from "../domain/whatsappConnection.js";
import type { WhatsAppConversationRepositoryPort, WhatsAppCredentialResolverPort } from "../application/ports.js";
import type { WhatsAppConnectionService } from "./WhatsAppConnectionService.js";
import type { WhatsAppOutboundDeliveryService } from "./WhatsAppOutboundDeliveryService.js";
import type { WhatsAppDeliveryStatusService } from "./WhatsAppDeliveryStatusService.js";

export interface WhatsAppWebhookConfiguration { readonly appSecret: string; readonly verifyToken: string; }
export interface WhatsAppInboundTextMessage { readonly phoneNumberId: string; readonly waId: string; readonly wamid: string; readonly text: string; }
export interface WhatsAppMessageStatusEvent { readonly kind: "message_status"; readonly phoneNumberId: string; readonly externalMessageId: string; readonly status: "sent" | "delivered" | "read" | "failed"; readonly providerTimestamp: string | null; readonly safeFailureCategory: "provider_unavailable" | null; }
export interface WhatsAppInboundTextEvent extends WhatsAppInboundTextMessage { readonly kind: "inbound_text"; }
export type WhatsAppWebhookEvent = WhatsAppInboundTextEvent | WhatsAppMessageStatusEvent;

export class WhatsAppWebhookService {
  public constructor(private readonly configuration: WhatsAppWebhookConfiguration, private readonly connections?: WhatsAppConnectionService, private readonly bindings?: WhatsAppConversationRepositoryPort, private readonly events?: ChannelProviderEventRepositoryPort, private readonly conversations?: ConversationService, private readonly turns?: OperationalConversationTurnService, private readonly clock: { now(): string } = { now: () => new Date().toISOString() }, private readonly messages?: ProviderMessageRecordRepositoryPort, private readonly deliveries?: OutboundDeliveryRepositoryPort, private readonly api?: WhatsAppCloudApiPort, private readonly credentials?: WhatsAppCredentialResolverPort, private readonly apiFactory?: (accessToken: string) => WhatsAppCloudApiPort, private readonly controls?: ConversationRepositoryPort, private readonly outbound?: WhatsAppOutboundDeliveryService, private readonly statuses?: WhatsAppDeliveryStatusService) {}
  public verify(mode: unknown, token: unknown, challenge: unknown): string | null { return this.configuration.verifyToken.length > 0 && mode === "subscribe" && typeof token === "string" && token === this.configuration.verifyToken && typeof challenge === "string" ? challenge : null; }
  public signatureValid(raw: Buffer, header: unknown): boolean {
    if (!this.configuration.appSecret || typeof header !== "string" || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
    const expected = Buffer.from(createHmac("sha256", this.configuration.appSecret).update(raw).digest("hex"), "hex"), provided = Buffer.from(header.slice(7), "hex");
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
  public parse(raw: Buffer): readonly WhatsAppInboundTextMessage[] { return this.parseEvents(raw).filter((event): event is WhatsAppInboundTextEvent => event.kind === "inbound_text").map(({ phoneNumberId, waId, wamid, text }) => ({ phoneNumberId, waId, wamid, text })); }
  public parseEvents(raw: Buffer): readonly WhatsAppWebhookEvent[] {
    let value: unknown; try { value = JSON.parse(raw.toString("utf8")); } catch { return []; }
    if (!value || typeof value !== "object") return [];
    const entries = (value as { entry?: unknown }).entry; if (!Array.isArray(entries)) return [];
    const messages: WhatsAppWebhookEvent[] = [];
    for (const entry of entries) if (entry && typeof entry === "object") {
      const changes = (entry as { changes?: unknown }).changes; if (!Array.isArray(changes)) continue;
      for (const change of changes) if (change && typeof change === "object") {
        const record = change as { field?: unknown; value?: unknown }; if (record.field !== "messages" || !record.value || typeof record.value !== "object") continue;
        const payload = record.value as { metadata?: { phone_number_id?: unknown }; messages?: unknown; statuses?: unknown };
        if (typeof payload.metadata?.phone_number_id !== "string") continue;
        if (Array.isArray(payload.messages)) for (const message of payload.messages) if (message && typeof message === "object") {
          const input = message as { type?: unknown; from?: unknown; id?: unknown; text?: { body?: unknown } };
          if (input.type === "text" && typeof input.from === "string" && typeof input.id === "string" && typeof input.text?.body === "string" && input.text.body.normalize("NFKC").trim()) messages.push({ kind: "inbound_text", phoneNumberId: payload.metadata.phone_number_id, waId: input.from, wamid: input.id, text: input.text.body.normalize("NFKC").trim() });
        }
        if (Array.isArray(payload.statuses)) for (const status of payload.statuses) if (status && typeof status === "object") {
          const input = status as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: unknown };
          if (typeof input.id !== "string" || (input.status !== "sent" && input.status !== "delivered" && input.status !== "read" && input.status !== "failed")) continue;
          const seconds = typeof input.timestamp === "string" && /^\d+$/.test(input.timestamp) ? Number(input.timestamp) : NaN;
          const providerTimestamp = Number.isSafeInteger(seconds) && Number.isFinite(new Date(seconds * 1000).getTime()) ? new Date(seconds * 1000).toISOString() : null;
          messages.push({ kind: "message_status", phoneNumberId: payload.metadata.phone_number_id, externalMessageId: input.id, status: input.status, providerTimestamp, safeFailureCategory: input.status === "failed" ? "provider_unavailable" : null });
        }
      }
    }
    return messages;
  }
  public async receive(raw: Buffer): Promise<void> { for (const event of this.parseEvents(raw)) { if (this.connections && "recordWebhookActivity" in this.connections) this.connections.recordWebhookActivity(event.phoneNumberId); if (event.kind === "inbound_text") await this.process(event); else this.statuses?.process(event); } }
  public async resumeIncomplete(limit = 25): Promise<void> {
    if (!this.connections || !this.bindings || !this.events || !this.conversations || !this.turns) return;
    for (const event of this.events.listRecoverable("meta_whatsapp_cloud", limit)) {
      const connection = this.connections.resolveForRecovery(event.transportConnectionId as import("../domain/whatsappConnection.js").WhatsAppConnectionId);
      if (!connection || !event.conversationId || !event.conversationMessageId) continue;
      const context = { workspaceId: connection.workspaceId, workspaceKey: "whatsapp" }, binding = this.bindings.findBindingByConversation(context, connection.companyId, event.conversationId);
      const inbound = this.conversations.listMessages(context, connection.companyId, event.conversationId).find((value) => value.id === event.conversationMessageId);
      const claimed = inbound ? this.events.acquireForRecovery(event.id, new Date(Date.parse(this.clock.now()) - 60_000).toISOString(), this.clock.now()) : null;
      if (!binding || !inbound || !claimed) continue;
      try {
        const turn = await this.turns.executePersistedInbound(context, connection.companyId, binding.conversationId, { assistantProfileId: connection.assistantProfileId, outboundParticipantId: binding.assistantParticipantId, replyIdempotencyKey: key("reply", event.externalEventId) }, inbound, { beforeRuntime: () => this.allowsAutomation(context, connection.companyId, binding.conversationId) });
        if (turn.response.outcome === "safe_fallback") this.markHumanRequired(context, connection.companyId, binding.conversationId);
        if (this.outbound) await this.outbound.deliverWhatsAppText(context, connection.companyId, { conversationId: binding.conversationId, conversationMessageId: turn.outbound.id, whatsAppConnectionId: connection.id, recipientWaId: binding.waId });
        this.events.updateState(claimed.id, "processing", "completed", this.clock.now());
      } catch { this.events.updateState(claimed.id, "processing", "failed", this.clock.now()); }
    }
  }
  private async process(message: WhatsAppInboundTextMessage): Promise<void> {
    if (!this.connections || !this.bindings || !this.events || !this.conversations || !this.turns) return;
    const connection = this.connections.resolveActiveByPhoneNumberId(message.phoneNumberId); if (!connection) return;
    const now = this.clock.now(), context = { workspaceId: connection.workspaceId, workspaceKey: "whatsapp" }, existing = this.bindings.findBinding(connection.id, message.waId);
    const binding = existing ?? (() => { const conversation = this.conversations!.open(context, connection.companyId, "whatsapp"), customer = this.conversations!.addParticipant(context, connection.companyId, conversation.id, { type: "whatsapp_contact", reference: message.waId }), assistant = this.conversations!.addParticipant(context, connection.companyId, conversation.id, { type: "assistant", reference: connection.assistantProfileId }); return this.bindings!.createBinding(reconstructWhatsAppConversationBinding({ id: whatsAppConversationBindingId(`wcb_${randomUUID().replaceAll("-", "")}`), whatsAppConnectionId: connection.id, waId: message.waId, conversationId: conversation.id, customerParticipantId: customer.id, assistantParticipantId: assistant.id, createdAt: now, updatedAt: now })); })();
    if (!binding) return;
    const initialControl = this.controls?.ensureConversationControl(context, connection.companyId, binding.conversationId);
    if (!("captureInbound" in this.events) || !("executePersistedInbound" in this.turns)) {
      await this.processLegacy(context, connection, binding, message, initialControl);
      return;
    }
    const inboundKey = key("inbound", message.wamid), replyKey = key("reply", message.wamid);
    const inboundMessageId = conversationMessageId(`cmsg_${randomUUID().replaceAll("-", "")}`);
    const captured = this.events.captureInbound(
      reconstructChannelProviderEvent({ id: channelProviderEventId(`cpe_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", transportConnectionId: connection.id, externalEventId: message.wamid, state: "claimed", conversationId: null, conversationMessageId: null, createdAt: now, updatedAt: now }),
      reconstructConversationMessage({ id: inboundMessageId, conversationId: binding.conversationId, senderParticipantId: binding.customerParticipantId, direction: "inbound", content: message.text, idempotencyKey: inboundKey, executionRecordId: null, createdAt: now }),
      reconstructProviderMessageRecord({ id: providerMessageRecordId(`pmr_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "inbound", transportConnectionId: connection.id, conversationMessageId: inboundMessageId, externalMessageId: message.wamid, createdAt: now, updatedAt: now }),
    );
    const claimed = this.events.acquireForRecovery(captured.event.id, new Date(Date.parse(now) - 60_000).toISOString(), now);
    if (!claimed) return;
    const inbound = captured.inbound;
    let turn: Awaited<ReturnType<OperationalConversationTurnService["executePersistedInbound"]>> | undefined;
    try {
      if (initialControl && initialControl.state !== "automated") {
        this.reopenForInbound(context, connection.companyId, binding.conversationId);
      } else {
        this.reopenForInbound(context, connection.companyId, binding.conversationId);
        turn = await this.turns.executePersistedInbound(context, connection.companyId, binding.conversationId, { assistantProfileId: connection.assistantProfileId, outboundParticipantId: binding.assistantParticipantId, replyIdempotencyKey: replyKey }, inbound, {
          beforeRuntime: () => this.allowsAutomation(context, connection.companyId, binding.conversationId),
        });
      }
    } catch (error: unknown) {
      if (error instanceof OperationalConversationTurnSuppressedError) {
        // The inbound row is already durable and linked to the provider event.
      } else {
        this.markHumanRequired(context, connection.companyId, binding.conversationId);
        this.events.updateState(claimed.id, "processing", "failed", this.clock.now());
        throw error;
      }
    }
    if (turn) {
      if (turn.response?.outcome === "safe_fallback") this.markHumanRequired(context, connection.companyId, binding.conversationId);
      if (this.outbound) await this.outbound.deliverWhatsAppText(context, connection.companyId, { conversationId: binding.conversationId, conversationMessageId: turn.outbound.id, whatsAppConnectionId: connection.id, recipientWaId: message.waId });
      else await this.deliverAutomatedResponse(context, connection, message, turn.outbound.id, turn.outbound.content, now);
    }
    this.events.updateState(claimed.id, "processing", "completed", this.clock.now());
  }
  private async processLegacy(context: { workspaceId: number; workspaceKey: string }, connection: { readonly id: import("../domain/whatsappConnection.js").WhatsAppConnectionId; readonly companyId: number; readonly phoneNumberId: string; readonly assistantProfileId: import("../../assistant/domain/assistantProfile.js").AssistantProfileId }, binding: import("../domain/whatsappConnection.js").WhatsAppConversationBinding, message: WhatsAppInboundTextMessage, initialControl: import("../../conversation/domain/conversationControl.js").ConversationControl | null | undefined): Promise<void> {
    const now = this.clock.now(), claimed = this.events!.claim(reconstructChannelProviderEvent({ id: channelProviderEventId(`cpe_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", transportConnectionId: connection.id, externalEventId: message.wamid, state: "claimed", conversationId: null, conversationMessageId: null, createdAt: now, updatedAt: now }));
    if (!claimed.claimed) return;
    let inbound: import("../../conversation/domain/conversation.js").ConversationMessage | undefined;
    let turn: Awaited<ReturnType<OperationalConversationTurnService["execute"]>> | undefined;
    try {
      if (initialControl && initialControl.state !== "automated") { inbound = this.conversations!.addMessage(context, connection.companyId, binding.conversationId, { senderParticipantId: binding.customerParticipantId, direction: "inbound", content: message.text }); this.reopenForInbound(context, connection.companyId, binding.conversationId); }
      else { turn = await this.turns!.execute(context, connection.companyId, binding.conversationId, { assistantProfileId: connection.assistantProfileId, inboundParticipantId: binding.customerParticipantId, outboundParticipantId: binding.assistantParticipantId, content: message.text }, { afterInbound: (created) => { inbound = created; this.reopenForInbound(context, connection.companyId, binding.conversationId); }, beforeRuntime: () => this.allowsAutomation(context, connection.companyId, binding.conversationId) }); inbound = turn.inbound; }
    } catch (error: unknown) { if (error instanceof OperationalConversationTurnSuppressedError) inbound = error.inbound; else { this.markHumanRequired(context, connection.companyId, binding.conversationId); this.events!.updateState(claimed.event.id, "claimed", "failed", this.clock.now()); throw error; } }
    if (!inbound) { this.events!.updateState(claimed.event.id, "claimed", "failed", this.clock.now()); return; }
    if (turn) { if (turn.response?.outcome === "safe_fallback") this.markHumanRequired(context, connection.companyId, binding.conversationId); if (this.outbound) await this.outbound.deliverWhatsAppText(context, connection.companyId, { conversationId: binding.conversationId, conversationMessageId: turn.outbound.id, whatsAppConnectionId: connection.id, recipientWaId: message.waId }); else await this.deliverAutomatedResponse(context, connection, message, turn.outbound.id, turn.outbound.content, now); }
    this.events!.updateState(claimed.event.id, "claimed", "completed", this.clock.now());
  }

  private reopenForInbound(context: { workspaceId: number; workspaceKey: string }, companyId: number, conversationId: import("../../conversation/domain/conversation.js").ConversationId): void {
    if (!this.controls) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = this.controls.ensureConversationControl(context, companyId, conversationId);
      if (!current) return;
      if (this.controls.clearConversationResolution(context, companyId, conversationId, current.version, this.clock.now())) return;
    }
  }

  private markHumanRequired(context: { workspaceId: number; workspaceKey: string }, companyId: number, conversationId: import("../../conversation/domain/conversation.js").ConversationId): void {
    if (!this.controls) return;
    const current = this.controls.findConversationControl(context, companyId, conversationId);
    if (!current || current.state !== "automated") return;
    const updated = reconstructConversationControl({ ...current, state: "human_required", attentionReason: "automation_failure", version: current.version + 1, updatedAt: this.clock.now() });
    this.controls.updateConversationControl(context, companyId, updated, current.version);
  }

  private allowsAutomation(context: { workspaceId: number; workspaceKey: string }, companyId: number, conversationId: import("../../conversation/domain/conversation.js").ConversationId): boolean {
    const current = this.controls?.findConversationControl(context, companyId, conversationId);
    return !current || current.state === "automated";
  }

  private createInboundRecord(connectionId: import("../domain/whatsappConnection.js").WhatsAppConnectionId, conversationMessageId: string, wamid: string, now: string): void {
    this.messages?.create(reconstructProviderMessageRecord({ id: providerMessageRecordId(`pmr_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "inbound", transportConnectionId: connectionId, conversationMessageId: conversationMessageId as import("../../conversation/domain/conversation.js").ConversationMessageId, externalMessageId: wamid, createdAt: now, updatedAt: now }));
  }

  private async deliverAutomatedResponse(context: { workspaceId: number; workspaceKey: string }, connection: { readonly id: import("../domain/whatsappConnection.js").WhatsAppConnectionId; readonly phoneNumberId: string; readonly companyId: number }, message: WhatsAppInboundTextMessage, conversationMessageId: string, content: string, now: string): Promise<void> {
    if (!this.messages || !this.deliveries || !(this.api || (this.credentials && this.apiFactory))) return;
    const outbound = this.messages.create(reconstructProviderMessageRecord({ id: providerMessageRecordId(`pmr_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "outbound", transportConnectionId: connection.id, conversationMessageId: conversationMessageId as import("../../conversation/domain/conversation.js").ConversationMessageId, externalMessageId: null, createdAt: now, updatedAt: now }));
    if (!outbound) return;
    const delivery = this.deliveries.create(reconstructOutboundDelivery({ id: outboundDeliveryId(`odl_${randomUUID().replaceAll("-", "")}`), providerMessageRecordId: outbound.id, transportConnectionId: connection.id, state: "pending", attemptCount: 0, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, safeErrorCategory: null, createdAt: now, updatedAt: now }));
    if (!delivery) return;
    try { const external = await this.sendText(context, connection.phoneNumberId, connection.companyId, connection.id, message.waId, content); this.messages.attachExternalMessageId(outbound.id, external, this.clock.now()); this.deliveries.updateState(delivery.id, "accepted", null, this.clock.now()); }
    catch { this.deliveries.updateState(delivery.id, "uncertain", "provider_unavailable", this.clock.now()); }
  }
  private async sendText(context: { workspaceId: number; workspaceKey: string }, phoneNumberId: string, companyId: number, connectionId: import("../domain/whatsappConnection.js").WhatsAppConnectionId, recipient: string, text: string): Promise<string> {
    const token = this.credentials?.resolve(context, companyId, connectionId);
    const api = token && this.apiFactory ? this.apiFactory(token) : this.api;
    if (!api) throw new Error("WhatsApp credentials are unavailable.");
    return api.sendText(phoneNumberId, recipient, text);
  }
}

function key(kind: "inbound" | "reply", wamid: string): string { return `whatsapp-${kind}:${createHash("sha256").update(wamid).digest("hex")}`; }
