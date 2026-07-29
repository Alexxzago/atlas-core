import { DeliveryLifecyclePolicy, ProviderDeliveryDomainError } from "../../transport/domain/providerDelivery.js";
import type { OutboundDeliveryRepositoryPort, ProviderMessageRecordRepositoryPort } from "../../transport/application/ports.js";
import type { WhatsAppMessageStatusEvent } from "./WhatsAppWebhookService.js";
import { MetaDeliveryStatusMapper } from "./MetaDeliveryStatusMapper.js";

export class WhatsAppDeliveryStatusService {
  public constructor(private readonly messages: ProviderMessageRecordRepositoryPort, private readonly deliveries: OutboundDeliveryRepositoryPort, private readonly mapper: MetaDeliveryStatusMapper, private readonly policy: DeliveryLifecyclePolicy, private readonly clock: { now(): string }) {}
  public process(event: WhatsAppMessageStatusEvent): void {
    const record = this.messages.findByTransportProviderAndExternalMessageId("meta_whatsapp_cloud", event.externalMessageId);
    if (!record || record.direction !== "outbound") return;
    const delivery = this.deliveries.findByProviderMessageRecordAndConnection(record.id, record.transportConnectionId);
    if (!delivery) return;
    const mapped = this.mapper.map(event);
    try { if (this.policy.transition(delivery.state, mapped.state) === "noop") return; }
    catch (error: unknown) { if (error instanceof ProviderDeliveryDomainError) return; throw error; }
    const updated = this.deliveries.compareAndSetState(delivery.id, delivery.state, mapped.state, mapped.safeErrorCategory, this.clock.now());
    if (updated) return;
    const current = this.deliveries.findById(delivery.id);
    if (!current) return;
    try { this.policy.transition(current.state, mapped.state); } catch (error: unknown) { if (error instanceof ProviderDeliveryDomainError) return; throw error; }
  }
}
