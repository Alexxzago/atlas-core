import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { effectiveSubscriptionState } from "../domain/billing.js";
import { entitlementForEffectiveSubscription } from "../domain/effectiveSubscriptionMapper.js";
import type { BillingPilotReadiness } from "../services/billingEntitlementService.js";

type Row = Record<string, unknown>;

export interface AsyncBillingPilotReadinessPort { pilotReadiness(workspaceId: number): Promise<BillingPilotReadiness>; }

export class AsyncBillingPilotReadinessRepository implements AsyncBillingPilotReadinessPort {
  public constructor(private readonly database: SqlDatabase) {}

  public async pilotReadiness(workspaceId: number): Promise<BillingPilotReadiness> {
    const [controls, authority] = await Promise.all([
      this.database.query<Row>("SELECT status FROM workspace_commercial_controls WHERE workspace_id=?", [workspaceId]),
      this.database.query<Row>("SELECT s.entitlement_state,s.mutation_eligible,b.effective_state FROM billing_entitlement_snapshots s JOIN billing_accounts a ON a.id=s.billing_account_id JOIN billing_subscriptions b ON b.billing_account_id=a.id AND b.is_current=1 WHERE a.workspace_id=? AND s.is_current=1", [workspaceId]),
    ]);
    if (controls[0]?.status !== "active") return "control_suspended";
    if (!authority[0]) return "entitlement_missing";
    const value = authority[0];
    const derived = entitlementForEffectiveSubscription(effectiveSubscriptionState(value.effective_state));
    return ["enabled", "grace_enabled"].includes(String(value.entitlement_state)) && Number(value.mutation_eligible) === 1 && derived.mutationEligible ? "usable" : "entitlement_ineligible";
  }
}

export function createAsyncBillingPilotReadinessPersistence(database: SqlDatabase): AsyncBillingPilotReadinessRepository { return new AsyncBillingPilotReadinessRepository(database); }
