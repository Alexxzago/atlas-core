import { DeliveryLifecyclePolicy, providerExternalMessageId, ProviderDeliveryDomainError } from "../../transport/domain/providerDelivery.js";
import type { AsyncOutboundDeliveryRepositoryPort, AsyncProviderMessageRecordRepositoryPort } from "../infrastructure/asyncWhatsAppOutboundPersistence.js";
import type { WhatsAppMessageStatusEvent } from "./WhatsAppWebhookService.js";
import { MetaDeliveryStatusMapper } from "./MetaDeliveryStatusMapper.js";

/** Async callback transition caller; webhook wiring remains intentionally outside STEP4B. */
export class AsyncWhatsAppDeliveryStatusService {
  public constructor(private readonly messages:AsyncProviderMessageRecordRepositoryPort,private readonly deliveries:AsyncOutboundDeliveryRepositoryPort,private readonly mapper:MetaDeliveryStatusMapper,private readonly policy:DeliveryLifecyclePolicy,private readonly clock:{now():string}) {}
  public async process(event:WhatsAppMessageStatusEvent):Promise<void>{let external:string;try{external=providerExternalMessageId(event.externalMessageId);}catch(error:unknown){if(error instanceof ProviderDeliveryDomainError)return;throw error;}const record=await this.messages.findByTransportProviderAndExternalMessageId("meta_whatsapp_cloud",external);if(!record||record.direction!=="outbound")return;const current=await this.deliveries.findByProviderMessageRecordAndConnection(record.id,record.transportConnectionId);if(!current)return;const mapped=this.mapper.map(event);try{if(this.policy.transition(current.state,mapped.state)==="noop")return;}catch(error:unknown){if(error instanceof ProviderDeliveryDomainError)return;throw error;}if(await this.deliveries.compareAndSetState(current.id,current.state,mapped.state,mapped.safeErrorCategory,this.clock.now()))return;const refreshed=await this.deliveries.findById(current.id);if(!refreshed)return;try{this.policy.transition(refreshed.state,mapped.state);}catch(error:unknown){if(error instanceof ProviderDeliveryDomainError)return;throw error;}}
}
