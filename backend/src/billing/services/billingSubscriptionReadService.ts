import { effectiveSubscriptionStateForEvidence, type BillingSubscriptionEvidence } from "../domain/effectiveSubscriptionMapper.js";
import type { BillingProviderRegistry } from "../application/billingProviderRegistry.js";
import type { BillingAccountRepository, BillingSubscription, BillingSubscriptionRepository } from "../../repositories/billingRepository.js";

export type TrustedBillingSubscriptionReadResult =
  | { readonly kind:"available"; readonly subscription:BillingSubscription; readonly evidence:BillingSubscriptionEvidence; readonly effectiveState:ReturnType<typeof effectiveSubscriptionStateForEvidence> }
  | { readonly kind:"unavailable" };

export class BillingSubscriptionReadService {
  public constructor(private readonly accounts:BillingAccountRepository,private readonly subscriptions:BillingSubscriptionRepository,private readonly providers:BillingProviderRegistry) {}

  public async read(workspaceId:number):Promise<TrustedBillingSubscriptionReadResult> {
    const account=this.accounts.findByWorkspace(workspaceId);
    if(!account||account.rolloutMode!=="managed"||!account.providerKind)return {kind:"unavailable"};
    const subscription=this.subscriptions.current(account.id);
    if(!subscription||subscription.providerKind!==account.providerKind||!subscription.providerSubscriptionId)return {kind:"unavailable"};
    const provider=this.providers.get(subscription.providerKind);
    if(!provider)return {kind:"unavailable"};
    const result=await provider.readSubscription({subscriptionReference:subscription.providerSubscriptionId});
    if(result.kind!=="success"||result.evidence.providerSubscriptionId!==subscription.providerSubscriptionId)return {kind:"unavailable"};
    return Object.freeze({kind:"available",subscription,evidence:result.evidence,effectiveState:effectiveSubscriptionStateForEvidence(result.evidence)});
  }
}
