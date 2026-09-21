import { billingProviderKinds, type BillingProviderKind } from "../domain/billing.js";
import { StripeBillingProvider, stripeBillingProviderFromEnvironment, type StripeFetch } from "../providers/stripeBillingProvider.js";
import { mercadoPagoBillingProviderFromEnvironment } from "../providers/mercadoPagoBillingProvider.js";
import { BillingProviderRegistry } from "./billingProviderRegistry.js";
import type { BillingProvider } from "./billingProvider.js";

export class BillingProviderConfigurationError extends Error {}

export function billingProviderKindsFromEnvironment(environment:NodeJS.ProcessEnv=process.env):readonly BillingProviderKind[] {
  const value=environment.BILLING_PROVIDERS?.trim();
  if(!value)return [];
  const values=value.split(",").map(part=>part.trim());
  if(values.some(part=>!part))throw new BillingProviderConfigurationError("BILLING_PROVIDERS contains an empty provider.");
  const kinds:BillingProviderKind[]=[];
  for(const value of values){
    if(!(billingProviderKinds as readonly string[]).includes(value))throw new BillingProviderConfigurationError("BILLING_PROVIDERS contains an unsupported provider.");
    if(!kinds.includes(value as BillingProviderKind))kinds.push(value as BillingProviderKind);
  }
  return kinds;
}

export function billingProviderRegistryFromEnvironment(environment:NodeJS.ProcessEnv=process.env,fetcher:StripeFetch=fetch):BillingProviderRegistry {
  const kinds=billingProviderKindsFromEnvironment(environment);
  const entries:Array<{readonly kind:BillingProviderKind;readonly provider:BillingProvider}>=[];
  for(const kind of kinds){
    if(kind==="stripe")entries.push({kind,provider:stripeBillingProviderFromEnvironment(environment,fetcher)});
    else if(kind==="mercadopago")entries.push({kind,provider:mercadoPagoBillingProviderFromEnvironment(environment,fetcher)});
    else throw new BillingProviderConfigurationError(`Billing provider "${kind}" is configured but no implementation is available.`);
  }
  return new BillingProviderRegistry(entries);
}

/** Production-only validation keeps webhook signing material coupled to each enabled provider. */
export function validateBillingProviderProductionConfiguration(environment:NodeJS.ProcessEnv=process.env):void {
  const kinds=billingProviderKindsFromEnvironment(environment);
  billingProviderRegistryFromEnvironment(environment);
  for(const kind of kinds){
    const secret=(kind==="stripe"?environment.STRIPE_WEBHOOK_SIGNING_SECRET:environment.MERCADOPAGO_WEBHOOK_SECRET)?.trim();
    if(!secret)throw new BillingProviderConfigurationError(`${kind==="stripe"?"STRIPE_WEBHOOK_SIGNING_SECRET":"MERCADOPAGO_WEBHOOK_SECRET"} is required when ${kind} is configured.`);
  }
}
