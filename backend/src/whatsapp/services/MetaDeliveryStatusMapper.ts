import type { OutboundDeliveryState } from "../../transport/domain/providerDelivery.js";
import type { WhatsAppMessageStatusEvent } from "./WhatsAppWebhookService.js";

export interface MetaDeliveryStatusMapping { readonly state: OutboundDeliveryState; readonly safeErrorCategory: string | null; }

export class MetaDeliveryStatusMapper {
  public map(event: WhatsAppMessageStatusEvent): MetaDeliveryStatusMapping {
    const state: OutboundDeliveryState = event.status === "sent" ? "accepted" : event.status === "delivered" ? "delivered" : event.status === "read" ? "read" : "permanent_failure";
    return Object.freeze({ state, safeErrorCategory: event.status === "failed" ? "provider_unavailable" : null });
  }
}
