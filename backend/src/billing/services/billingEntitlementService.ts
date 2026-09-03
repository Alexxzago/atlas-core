import type { SynchronousDatabase } from "../../config/synchronousDatabase.js";
import { BillingEntitlementSnapshotRepository, type BillingEntitlementSnapshot } from "../../repositories/billingRepository.js";
import { CommercialControlsRepository, type WorkspaceCommercialControls } from "../../repositories/commercialControlsRepository.js";
import { entitlementForEffectiveSubscription } from "../domain/effectiveSubscriptionMapper.js";

export type BillingCapability = "company" | "assistant_profile" | "active_channel";
export type BillingEntitlementReason = "allowed" | "administrative_suspended" | "billing_entitlement_unavailable" | "billing_restricted" | "billing_mutation_ineligible" | "effective_limit_reached";
export interface BillingEntitlementDecision { readonly allowed:boolean; readonly capability:BillingCapability; readonly currentUsage:number; readonly billingLimit:number|null; readonly administrativeLimit:number|null; readonly effectiveLimit:number|null; readonly safeReason:BillingEntitlementReason; }
export interface BillingEntitlementPort { mayCreateCompany(workspaceId:number):BillingEntitlementDecision; mayCreateAssistantProfile(workspaceId:number):BillingEntitlementDecision; mayActivateChannel(workspaceId:number):BillingEntitlementDecision; }

const minimum=(left:number|null,right:number|null):number|null=>left===null?right:right===null?left:Math.min(left,right);
const billingLimit=(snapshot:BillingEntitlementSnapshot,capability:BillingCapability):number|null=>capability==="company"?snapshot.maxCompanies:capability==="assistant_profile"?snapshot.maxAssistantProfiles:snapshot.maxActiveChannels;
const administrativeLimit=(controls:WorkspaceCommercialControls,capability:BillingCapability):number|null=>capability==="company"?controls.maxCompanies:capability==="assistant_profile"?controls.maxAssistantProfiles:controls.maxActiveChannels;

export class BillingEntitlementService {
  private readonly billing: BillingEntitlementSnapshotRepository;
  private readonly commercial: CommercialControlsRepository;
  public constructor(private readonly db:SynchronousDatabase) { this.billing=new BillingEntitlementSnapshotRepository(db);this.commercial=new CommercialControlsRepository(db); }
  public mayCreateCompany(workspaceId:number):BillingEntitlementDecision{return this.decide(workspaceId,"company");}
  public mayCreateAssistantProfile(workspaceId:number):BillingEntitlementDecision{return this.decide(workspaceId,"assistant_profile");}
  public mayActivateChannel(workspaceId:number):BillingEntitlementDecision{return this.decide(workspaceId,"active_channel");}
  private decide(workspaceId:number,capability:BillingCapability):BillingEntitlementDecision {
    const controls=this.commercial.workspace(workspaceId),authorities=this.billing.authorities(workspaceId,controls),usage=this.usage(workspaceId,capability);
    if(controls?.status!=="active")return this.result(false,capability,usage,null,controls?administrativeLimit(controls,capability):null,"administrative_suspended");
    if(!authorities)return this.result(false,capability,usage,null,controls?administrativeLimit(controls,capability):null,"billing_entitlement_unavailable");
    const snapshot=authorities.billing,billing=billingLimit(snapshot,capability),administrative=administrativeLimit(controls!,capability),derived=entitlementForEffectiveSubscription(authorities.subscription.effectiveState);
    if(authorities.subscription.effectiveState==="paused"&&!derived.mutationEligible)return this.result(false,capability,usage,billing,administrative,"billing_restricted");
    if(!["enabled","grace_enabled"].includes(snapshot.state))return this.result(false,capability,usage,billing,administrative,"billing_restricted");
    if(!snapshot.mutationEligible)return this.result(false,capability,usage,billing,administrative,"billing_mutation_ineligible");
    const effective=minimum(billing,administrative);return this.result(effective===null||usage<effective,capability,usage,billing,administrative,effective!==null&&usage>=effective?"effective_limit_reached":"allowed");
  }
  private result(allowed:boolean,capability:BillingCapability,currentUsage:number,billingLimit:number|null,administrativeLimit:number|null,safeReason:BillingEntitlementReason):BillingEntitlementDecision{return Object.freeze({allowed,capability,currentUsage,billingLimit,administrativeLimit,effectiveLimit:minimum(billingLimit,administrativeLimit),safeReason});}
  private usage(workspaceId:number,capability:BillingCapability):number { if(capability==="company")return Number((this.db.prepare("SELECT COUNT(*) count FROM companies WHERE workspace_id=? AND lifecycle_state!='archived'").get(workspaceId)as{count:number}).count);if(capability==="assistant_profile")return Number((this.db.prepare("SELECT COUNT(*) count FROM assistant_profiles p JOIN companies c ON c.id=p.company_id WHERE c.workspace_id=? AND p.status!='archived'").get(workspaceId)as{count:number}).count);return Number((this.db.prepare("SELECT (SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=? AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=? AND status='active') count").get(workspaceId,workspaceId)as{count:number}).count); }
}

export function assertBillingEntitlement(decision: BillingEntitlementDecision): void {
  // This is advisory preflight only; SQLite triggers remain the concurrency fence.
  if (!decision.allowed) throw new BillingEntitlementDeniedError();
}

export class BillingEntitlementDeniedError extends Error {
  public constructor() { super("Workspace capacity is unavailable."); }
}
