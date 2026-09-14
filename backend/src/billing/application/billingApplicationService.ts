import { createHash } from "node:crypto";
import { BillingAccountRepository, BillingCatalogRepository, BillingEntitlementSnapshotRepository, BillingSubscriptionRepository } from "../../repositories/billingRepository.js";
import { BillingOperationService, type BillingOperationOutcome, type BillingPortalOutcome } from "./billingOperationService.js";
import { BillingPayerIdentityService } from "./billingPayerIdentityService.js";

export type BillingSummaryDto = Readonly<{ rolloutMode:"unmanaged"|"managed"; subscription:Readonly<{ state:string; plan:Readonly<{ key:string; name:string; interval:"month"|"year"; currency:string; amountMinor:number }>|null }>; }>;
export type BillingEntitlementsDto = Readonly<{ state:string; maxCompanies:number|null; maxAssistantProfiles:number|null; maxActiveChannels:number|null; mutationEligible:boolean; effectiveAt:string; expiresAt:string|null; }>;
export type BillingApplicationOutcome = "succeeded"|"failed"|"uncertain"|"in_progress"|"conflict"|"invalid"|"unavailable"|"unsupported";
export type BillingCatalogDto = Readonly<{ entries:readonly Readonly<{ id:string; providerCommercialOfferId:string; key:string; version:number; name:string; interval:"month"|"year"; currency:string; amountMinor:number; }>[] }>;
export type BillingPayerIdentityOptionsDto = Readonly<{ options:readonly Readonly<{ identityId:string; email:string }>[] }>;

export class BillingApplicationService {
  private readonly accounts: BillingAccountRepository;
  private readonly catalog: BillingCatalogRepository;
  private readonly subscriptions: BillingSubscriptionRepository;
  private readonly entitlements: BillingEntitlementSnapshotRepository;
  private readonly payerIdentities: BillingPayerIdentityService;

  public constructor(database: import("../../config/synchronousDatabase.js").SynchronousDatabase, private readonly operations: BillingOperationService, private readonly targets: Readonly<{ checkoutSuccess:string; checkoutCancel:string; portalReturn:string; }>, now:()=>string=()=>new Date().toISOString()) {
    this.accounts = new BillingAccountRepository(database);
    this.catalog = new BillingCatalogRepository(database);
    this.subscriptions = new BillingSubscriptionRepository(database);
    this.entitlements = new BillingEntitlementSnapshotRepository(database);
    this.payerIdentities = new BillingPayerIdentityService(database, now);
  }

  public summary(workspaceId:number): BillingSummaryDto | null {
    const account = this.accounts.findByWorkspace(workspaceId);
    if (!account) return null;
    const subscription = this.subscriptions.current(account.id), entry = subscription?.catalogEntryId ? this.catalog.find(subscription.catalogEntryId) : null, offer=subscription?.providerCommercialOfferId?this.catalog.offer(subscription.providerCommercialOfferId):null;
    return Object.freeze({ rolloutMode:account.rolloutMode, subscription:Object.freeze({ state:subscription?.effectiveState ?? "unmanaged", plan:entry&&offer ? Object.freeze({ key:entry.planKey, name:entry.displayName, interval:offer.interval, currency:offer.currency, amountMinor:offer.amountMinor }) : null }) });
  }

  public entitlementsFor(workspaceId:number): BillingEntitlementsDto | null {
    const account = this.accounts.findByWorkspace(workspaceId), snapshot = account ? this.entitlements.current(account.id) : null;
    return snapshot ? Object.freeze({ state:snapshot.state, maxCompanies:snapshot.maxCompanies, maxAssistantProfiles:snapshot.maxAssistantProfiles, maxActiveChannels:snapshot.maxActiveChannels, mutationEligible:snapshot.mutationEligible, effectiveAt:snapshot.effectiveAt, expiresAt:snapshot.expiresAt }) : null;
  }

  public catalogForWorkspace(workspaceId:number):BillingCatalogDto|null {
    if (!this.accounts.findByWorkspace(workspaceId)) return null;
    return Object.freeze({ entries:Object.freeze(this.catalog.active().flatMap(entry=>this.catalog.sellableOffers(entry.id).map(offer=>Object.freeze({ id:entry.id, providerCommercialOfferId:offer.id, key:entry.planKey, version:entry.catalogVersion, name:entry.displayName, interval:offer.interval, currency:offer.currency, amountMinor:offer.amountMinor })))) });
  }

  public payerIdentityOptionsFor(workspaceId:number, callerIdentityId:string):BillingPayerIdentityOptionsDto|null {
    const account=this.accounts.findByWorkspace(workspaceId), options=this.payerIdentities.optionsForWorkspace({workspaceId,callerIdentityId});
    return account&&options?Object.freeze({options}):null;
  }

  public setPayerIdentity(workspaceId:number, callerIdentityId:string, identityId:string):Readonly<{status:"succeeded"|"conflict"|"invalid"}> {
    const account=this.accounts.findByWorkspace(workspaceId);
    if(!account)return Object.freeze({status:"invalid"});
    const result=this.payerIdentities.setOwnedForWorkspace({workspaceId,callerIdentityId,identityId,expectedVersion:account.version});
    return Object.freeze({status:result.kind==="succeeded"?"succeeded":result.kind==="conflict"?"conflict":"invalid"});
  }

  public clearPayerIdentity(workspaceId:number, callerIdentityId:string, identityId:string):Readonly<{status:"succeeded"|"conflict"|"invalid"}> {
    const account=this.accounts.findByWorkspace(workspaceId);
    if(!account)return Object.freeze({status:"invalid"});
    const result=this.payerIdentities.clearOwnedForWorkspace({workspaceId,callerIdentityId,identityId,expectedVersion:account.version});
    return Object.freeze({status:result.kind==="succeeded"?"succeeded":result.kind==="conflict"?"conflict":"invalid"});
  }

  public async checkout(workspaceId:number, catalogEntryId:string, providerCommercialOfferId:string, idempotencyKey:string):Promise<Readonly<{ status:BillingApplicationOutcome; redirectUrl?:string }>> {
    const result = await this.operations.checkout({ workspaceId, catalogEntryId, providerCommercialOfferId, operationId:operationId("checkout", idempotencyKey), successTarget:this.targets.checkoutSuccess, cancelTarget:this.targets.checkoutCancel });
    return operationDto(result);
  }

  public async portal(workspaceId:number):Promise<Readonly<{ status:"succeeded"|"failed"|"uncertain"|"invalid"|"unavailable"|"unsupported"; redirectUrl?:string }>> {
    const result = await this.operations.portal({ workspaceId, returnTarget:this.targets.portalReturn });
    return result.kind === "succeeded" ? Object.freeze({ status:"succeeded", ...(result.result.kind === "success" && result.result.redirectUrl ? { redirectUrl:result.result.redirectUrl } : {}) }) : Object.freeze({ status:result.kind });
  }

  public async cancel(workspaceId:number, idempotencyKey:string):Promise<Readonly<{ status:BillingApplicationOutcome }>> { return this.subscriptionMutation(workspaceId, idempotencyKey, "cancel"); }
  public async reactivate(workspaceId:number, idempotencyKey:string):Promise<Readonly<{ status:BillingApplicationOutcome }>> { return this.subscriptionMutation(workspaceId, idempotencyKey, "reactivate"); }

  private async subscriptionMutation(workspaceId:number, idempotencyKey:string, kind:"cancel"|"reactivate"):Promise<Readonly<{ status:BillingApplicationOutcome }>> {
    const account = this.accounts.findByWorkspace(workspaceId), subscription = account ? this.subscriptions.current(account.id) : null;
    if (!subscription) return Object.freeze({ status:"invalid" });
    const result = kind === "cancel" ? await this.operations.cancelAtPeriodEnd({ workspaceId, subscriptionId:subscription.id, operationId:operationId(kind, idempotencyKey) }) : await this.operations.reactivate({ workspaceId, subscriptionId:subscription.id, operationId:operationId(kind, idempotencyKey) });
    return Object.freeze({ status:result.kind });
  }
}

function operationId(kind:string, key:string):string { return `http_${kind}_${createHash("sha256").update(key).digest("hex")}`; }
function operationDto(result:BillingOperationOutcome):Readonly<{ status:BillingApplicationOutcome; redirectUrl?:string }> { if (result.kind !== "succeeded") return Object.freeze({ status:result.kind }); try { const value = result.operation?.safeResultJson ? JSON.parse(result.operation.safeResultJson) as { redirectUrl?:unknown } : {}; return Object.freeze({ status:"succeeded", ...(typeof value.redirectUrl === "string" ? { redirectUrl:value.redirectUrl } : {}) }); } catch { return Object.freeze({ status:"succeeded" }); } }
