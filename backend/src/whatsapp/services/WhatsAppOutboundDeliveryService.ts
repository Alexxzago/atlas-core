import { randomUUID } from "node:crypto";
import type { ConversationRepositoryPort } from "../../conversation/application/ports.js";
import { type ConversationId, type ConversationMessageId } from "../../conversation/domain/conversation.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { OutboundDeliveryRepositoryPort, ProviderMessageRecordRepositoryPort } from "../../transport/application/ports.js";
import { outboundDeliveryId, providerMessageRecordId, reconstructOutboundDelivery, reconstructProviderMessageRecord, type OutboundDelivery } from "../../transport/domain/providerDelivery.js";
import type { WhatsAppConnectionId } from "../domain/whatsappConnection.js";
import { WhatsAppCloudApiError, type WhatsAppCloudApiPort, type WhatsAppOutboundFailureDiagnostic } from "../providers/WhatsAppCloudApiProvider.js";
import type { AsyncWhatsAppConnectionRepositoryPort, AsyncWhatsAppConversationRepositoryPort, AsyncWhatsAppCredentialResolverPort, WhatsAppConnectionRepositoryPort, WhatsAppConversationRepositoryPort, WhatsAppCredentialResolverPort } from "../application/ports.js";
import type { WhatsAppConnectionService } from "./WhatsAppConnectionService.js";
import type { AsyncVoiceLookupPort, VoiceRepositoryPort } from "../application/voicePorts.js";
import type { VoiceDeferredSemanticRecoveryService } from "./voiceDeferredSemanticRecoveryService.js";
import type { ProactiveSemanticRecoveryService } from "../../proactive/services/proactiveSemanticRecoveryService.js";
import { operationalLogger } from "../../observability/operationalLogger.js";
import type { AsyncOutboundDeliveryRepositoryPort, AsyncProviderMessageRecordRepositoryPort } from "../infrastructure/asyncWhatsAppOutboundPersistence.js";

export class WhatsAppOutboundDeliveryValidationError extends Error {}

export interface WhatsAppOutboundDeliveryResult {
  readonly id: string;
  readonly state: "pending" | "accepted" | "uncertain";
}
type OutboundFailureLog = { readonly event: "whatsapp_provider_outbound_failed"; readonly operation: "send_text"; readonly graphApiVersion: string | null; readonly httpStatus: number | null; readonly providerCode: number | null; readonly providerSubcode: number | null; readonly errorType: string | null; readonly transient: boolean | null; readonly sanitizedDetailsCategory: WhatsAppOutboundFailureDiagnostic["sanitizedDetailsCategory"]; readonly sanitizedReason: WhatsAppOutboundFailureDiagnostic["sanitizedReason"]; readonly connectionId: string; readonly outboundDeliveryId: string; readonly timestamp: string; };

export class WhatsAppOutboundDeliveryService {
  public constructor(
    private readonly conversations: ConversationRepositoryPort,
    private readonly connections: WhatsAppConnectionRepositoryPort | AsyncWhatsAppConnectionRepositoryPort,
    private readonly providerMessages: ProviderMessageRecordRepositoryPort | AsyncProviderMessageRecordRepositoryPort,
    private readonly deliveries: OutboundDeliveryRepositoryPort | AsyncOutboundDeliveryRepositoryPort,
    private readonly credentials: WhatsAppCredentialResolverPort | AsyncWhatsAppCredentialResolverPort,
    private readonly apiFactory: (accessToken: string) => WhatsAppCloudApiPort,
    private readonly clock: { now(): string },
    private readonly operationalState?: WhatsAppConnectionService,
    private readonly bindings?: WhatsAppConversationRepositoryPort | AsyncWhatsAppConversationRepositoryPort,
    private readonly voices?: Pick<AsyncVoiceLookupPort, "findUploadedProviderMediaId"> | Pick<VoiceRepositoryPort, "findUploadedProviderMediaId">,
    private readonly semanticRecovery?: VoiceDeferredSemanticRecoveryService,
    private readonly proactiveSemanticRecovery?: ProactiveSemanticRecoveryService,
  ) {}

  public async deliverWhatsAppText(context: WorkspaceContext, companyId: number, input: { conversationId: ConversationId; conversationMessageId: ConversationMessageId; whatsAppConnectionId: WhatsAppConnectionId; recipientWaId: string }): Promise<WhatsAppOutboundDeliveryResult> {
    const conversation = await this.conversations.findConversation(context, companyId, input.conversationId);
    const message = await this.conversations.findMessage(context, companyId, input.conversationMessageId);
    const connection = await this.connections.findById(context, companyId, input.whatsAppConnectionId);
    if (!conversation || !message || message.conversationId !== conversation.id || message.direction !== "outbound" || !connection || connection.status !== "active") throw new WhatsAppOutboundDeliveryValidationError("WhatsApp outbound delivery is invalid.");
    const now = this.clock.now();
    const createdRecord = await this.providerMessages.create(reconstructProviderMessageRecord({ id: providerMessageRecordId(`pmr_${randomUUID().replaceAll("-", "")}`), communicationChannel: "whatsapp", transportProvider: "meta_whatsapp_cloud", direction: "outbound", transportConnectionId: connection.id, conversationMessageId: message.id, externalMessageId: null, createdAt: now, updatedAt: now }));
    const record = createdRecord ?? await this.providerMessages.findByMessageAndConnection("meta_whatsapp_cloud", connection.id, message.id);
    if (!record) throw new WhatsAppOutboundDeliveryValidationError("WhatsApp provider message could not be persisted.");
    const createdDelivery = await this.deliveries.create(reconstructOutboundDelivery({ id: outboundDeliveryId(`odl_${randomUUID().replaceAll("-", "")}`), providerMessageRecordId: record.id, transportConnectionId: connection.id, state: "pending", attemptCount: 0, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, safeErrorCategory: null, createdAt: now, updatedAt: now }));
    const delivery = createdDelivery ?? await this.deliveries.findByProviderMessageRecordAndConnection(record.id, connection.id);
    if (!delivery) throw new WhatsAppOutboundDeliveryValidationError("WhatsApp delivery could not be persisted.");
    return safe(createdDelivery ?? delivery);
  }

  public async dispatchReady(owner: string, limit = 25): Promise<void> {
    const now = this.clock.now(), expiresAt = new Date(Date.parse(now) + 60_000).toISOString();
    for (const delivery of await this.deliveries.leaseReady(owner, now, expiresAt, limit)) await this.dispatch(owner, delivery);
  }

  private async dispatch(owner: string, delivery: OutboundDelivery): Promise<void> {
    if (delivery.payloadKind !== "text" && delivery.payloadKind !== "audio") return;
    if (delivery.payloadKind === "audio" && !this.voices) return;
    if (!await this.deliveries.authorizeLease(delivery.id, owner, this.clock.now())) return;
    const record = await this.providerMessages.findById(delivery.providerMessageRecordId);
    const connection = await this.connections.findByIdForRecovery(delivery.transportConnectionId as WhatsAppConnectionId);
    if (!record || record.direction !== "outbound" || record.communicationChannel !== "whatsapp" || !connection || connection.status !== "active") {
      await this.settle(owner, delivery, { outcome: "retryable", safeErrorCategory: "provider_unavailable" });
      return;
    }
    const context: WorkspaceContext = { workspaceId: connection.workspaceId, workspaceKey: "whatsapp" };
    const message = await this.conversations.findMessage(context, connection.companyId, record.conversationMessageId);
    const binding = message && this.bindings ? await this.bindings.findBindingByConversation(context, connection.companyId, message.conversationId) : null;
    if (!message || !binding || binding.whatsAppConnectionId !== connection.id) {
      await this.settle(owner, delivery, { outcome: "retryable", safeErrorCategory: "provider_unavailable" });
      return;
    }
    let started = false;
    try {
      const token = await this.credentials.resolve(context, connection.companyId, connection.id);
      if (!token) throw new Error("WhatsApp credentials are unavailable.");
      const providerMediaId = delivery.payloadKind === "audio" ? await this.voices?.findUploadedProviderMediaId(context, connection.companyId, delivery.id) ?? null : null;
      if (delivery.payloadKind === "audio" && !providerMediaId) { await this.settle(owner, delivery, { outcome: "retryable", safeErrorCategory: "media_unavailable" }); return; }
      if (!await this.deliveries.beginSend(delivery.id, owner, this.clock.now())) return;
      started = true;
      const api = this.apiFactory(token);
      const externalMessageId = delivery.payloadKind === "audio" ? await (api.sendAudio?.(connection.phoneNumberId, binding.waId, providerMediaId!) ?? Promise.reject(new Error("WhatsApp audio sending is unavailable."))) : await api.sendText(connection.phoneNumberId, binding.waId, message.content);
      const accepted = await this.deliveries.acceptSend(delivery.id, owner, externalMessageId, this.clock.now());
      if (accepted?.responsePolicy === "deferred_voice") await this.semanticRecovery?.recover(context, connection.companyId);
      if (accepted) await this.proactiveSemanticRecovery?.recover(context, connection.companyId);
      await this.operationalState?.recordProviderActivity(context, connection.companyId, connection.id);
    } catch (error: unknown) {
      this.logFailure(error, connection.id, delivery.id);
      if (started && error instanceof WhatsAppCloudApiError && error.status !== null) await this.settle(owner, delivery, classify(error));
      else if (started) await this.deliveries.settleUncertainSend(delivery.id, owner, "send_outcome_unknown", this.clock.now());
      else await this.settle(owner, delivery, classify(error));
      await this.operationalState?.recordProviderFailure(context, connection.companyId, connection.id);
    }
  }
  private async settle(owner: string, delivery: OutboundDelivery, result: DeliveryResult): Promise<void> {
    const now = this.clock.now();
    const outcome = result.outcome === "retryable" && delivery.attemptCount >= maximumAttempts ? "permanent_failure" : result.outcome;
    const nextAttemptAt = outcome === "retryable" ? retryAt(now, delivery.attemptCount, result.retryAfterMilliseconds) : null;
    await this.deliveries.settleLease(delivery.id, owner, outcome, nextAttemptAt, result.safeErrorCategory, now);
  }
  private logFailure(error: unknown, connectionId: string, outboundDeliveryId: string): void { const diagnostic = error instanceof WhatsAppCloudApiError ? error.diagnostic : null; operationalLogger.warn("provider_call_failed", { provider: "meta_whatsapp", operation: "send_message", whatsAppConnectionId: connectionId, outboundDeliveryId, ...(diagnostic?.httpStatus !== null && diagnostic?.httpStatus !== undefined ? { httpStatus: diagnostic.httpStatus } : {}), safeErrorCategory: diagnostic?.sanitizedReason === "rate_limited" ? "rate_limited" : "provider_rejected", outcome: "failed" }); }
}

function safe(value: OutboundDelivery): WhatsAppOutboundDeliveryResult {
  return Object.freeze({ id: value.id, state: value.state === "accepted" ? "accepted" : value.state === "pending" ? "pending" : "uncertain" });
}

const maximumAttempts = 5;
interface DeliveryResult { readonly outcome: "retryable" | "permanent_failure"; readonly safeErrorCategory: string; readonly retryAfterMilliseconds?: number | null; }
function classify(error: unknown): DeliveryResult { if (error instanceof WhatsAppCloudApiError) { if (error.status === 401 || error.status === 403) return { outcome: "permanent_failure", safeErrorCategory: "credentials_invalid" }; if (error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 429) return { outcome: "permanent_failure", safeErrorCategory: "provider_rejected" }; if (error.status === 429) return { outcome: "retryable", safeErrorCategory: "rate_limited", retryAfterMilliseconds: error.retryAfterMilliseconds }; } return { outcome: "retryable", safeErrorCategory: "provider_unavailable" }; }
function retryAt(now: string, attempt: number, retryAfterMilliseconds: number | null = null): string { const exponential = Math.min(300_000, 1_000 * 2 ** Math.min(attempt, 8)); const delay = Math.min(300_000, Math.max(exponential, retryAfterMilliseconds ?? 0)); return new Date(Date.parse(now) + delay).toISOString(); }
