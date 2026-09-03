import type { SynchronousDatabase } from "../../config/synchronousDatabase.js";

export interface BillingPayerIdentity { readonly identityId:string; readonly userId:string; readonly email:string; }

export class BillingPayerIdentityResolver {
  public constructor(private readonly db:SynchronousDatabase) {}
  public resolveForBillingAccount(billingAccountId:string):BillingPayerIdentity|null {
    const row=this.db.prepare("SELECT i.id identityId,i.user_id userId,i.email email FROM billing_accounts a JOIN authentication_identities i ON i.id=a.billing_payer_identity_id JOIN memberships m ON m.user_id=i.user_id AND m.workspace_id=a.workspace_id AND m.status='active' WHERE a.id=? AND i.email_verified=1 AND length(i.email) BETWEEN 3 AND 320 AND length(i.normalized_email) BETWEEN 3 AND 320").get(billingAccountId) as {identityId:string;userId:string;email:string}|undefined;
    return row?Object.freeze({identityId:row.identityId,userId:row.userId,email:row.email}):null;
  }
}
