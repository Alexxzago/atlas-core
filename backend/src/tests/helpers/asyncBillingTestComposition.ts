import { BillingApplicationService } from "../../billing/application/billingApplicationService.js";
import { BillingOperationService } from "../../billing/application/billingOperationService.js";
import type { BillingProviderRegistry } from "../../billing/application/billingProviderRegistry.js";
import { createAsyncBillingPersistence } from "../../billing/infrastructure/asyncBillingFactory.js";
import { createAsyncBillingPilotReadinessPersistence } from "../../billing/infrastructure/asyncBillingPilotReadiness.js";
import { createBillingEntitlementService } from "../../billing/services/billingEntitlementService.js";
import { SynchronousSqlDatabaseAdapter } from "../../config/sqlDatabase.js";
import type { SynchronousDatabase } from "../../config/synchronousDatabase.js";

export function asyncBillingPersistence(database: SynchronousDatabase) {
  return createAsyncBillingPersistence(new SynchronousSqlDatabaseAdapter(database));
}

export function asyncBillingOperations(database: SynchronousDatabase, providers: BillingProviderRegistry, now: () => string) {
  const persistence = asyncBillingPersistence(database);
  return new BillingOperationService(persistence.customer, persistence.operations, providers, now, persistence.payerIdentities);
}

export function asyncBillingApplication(database: SynchronousDatabase, providers: BillingProviderRegistry, targets: Readonly<{ checkoutSuccess: string; checkoutCancel: string; portalReturn: string }>, now: () => string) {
  const persistence = asyncBillingPersistence(database);
  const operations = new BillingOperationService(persistence.customer, persistence.operations, providers, now, persistence.payerIdentities);
  return new BillingApplicationService(persistence.customer, persistence.payerIdentities, operations, targets, now);
}

export function asyncBillingEntitlements(database: SynchronousDatabase) {
  const sql = new SynchronousSqlDatabaseAdapter(database);
  return createBillingEntitlementService(asyncBillingPersistence(database).entitlements, createAsyncBillingPilotReadinessPersistence(sql));
}
