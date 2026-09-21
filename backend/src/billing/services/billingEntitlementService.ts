import type { AsyncBillingEntitlementPort } from "../infrastructure/asyncBillingPersistence.js";
import type { AsyncBillingPilotReadinessPort } from "../infrastructure/asyncBillingPilotReadiness.js";

export type BillingCapability = "company" | "assistant_profile" | "active_channel";
export type BillingEntitlementReason = "allowed" | "administrative_suspended" | "billing_entitlement_unavailable" | "billing_restricted" | "billing_mutation_ineligible" | "effective_limit_reached";
export interface BillingEntitlementDecision { readonly allowed:boolean; readonly capability:BillingCapability; readonly currentUsage:number; readonly billingLimit:number|null; readonly administrativeLimit:number|null; readonly effectiveLimit:number|null; readonly safeReason:BillingEntitlementReason; }
export interface BillingEntitlementPort { mayCreateCompany(workspaceId:number):Promise<BillingEntitlementDecision>; mayCreateAssistantProfile(workspaceId:number):Promise<BillingEntitlementDecision>; mayActivateChannel(workspaceId:number):Promise<BillingEntitlementDecision>; }
export type BillingPilotReadiness = "usable" | "control_suspended" | "entitlement_missing" | "entitlement_ineligible";

export class BillingEntitlementService implements BillingEntitlementPort {
  public constructor(private readonly entitlements: AsyncBillingEntitlementPort, private readonly readiness: AsyncBillingPilotReadinessPort) {}
  public mayCreateCompany(workspaceId:number):Promise<BillingEntitlementDecision>{return this.entitlements.mayCreateCompany(workspaceId);}
  public mayCreateAssistantProfile(workspaceId:number):Promise<BillingEntitlementDecision>{return this.entitlements.mayCreateAssistantProfile(workspaceId);}
  public mayActivateChannel(workspaceId:number):Promise<BillingEntitlementDecision>{return this.entitlements.mayActivateChannel(workspaceId);}
  public pilotReadiness(workspaceId:number):Promise<BillingPilotReadiness>{return this.readiness.pilotReadiness(workspaceId);}
}

export function createBillingEntitlementService(entitlements: AsyncBillingEntitlementPort, readiness: AsyncBillingPilotReadinessPort): BillingEntitlementService { return new BillingEntitlementService(entitlements, readiness); }

export function assertBillingEntitlement(decision: BillingEntitlementDecision): void {
  if (!decision.allowed) throw new BillingEntitlementDeniedError();
}

export class BillingEntitlementDeniedError extends Error {
  public constructor() { super("Workspace capacity is unavailable."); }
}
