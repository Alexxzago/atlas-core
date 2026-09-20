import type { AsyncBillingPayerIdentityRepository } from "../infrastructure/asyncBillingCustomerPersistence.js";
export interface BillingPayerIdentity { readonly identityId:string; readonly userId:string; readonly email:string; }
export class BillingPayerIdentityResolver {
  public constructor(private readonly identities:AsyncBillingPayerIdentityRepository) {}
  public async resolveForBillingAccount(billingAccountId:string):Promise<BillingPayerIdentity|null>{return this.identities.resolve(billingAccountId);}
}
