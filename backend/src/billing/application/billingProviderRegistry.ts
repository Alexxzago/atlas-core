import type { BillingProviderKind } from "../domain/billing.js";
import type { BillingProvider } from "./billingProvider.js";

export class BillingProviderRegistry {
  private readonly providers = new Map<BillingProviderKind, BillingProvider>();
  public constructor(entries:readonly {readonly kind:BillingProviderKind;readonly provider:BillingProvider}[] = []) { for(const entry of entries)this.register(entry.kind,entry.provider); }
  public register(kind:BillingProviderKind,provider:BillingProvider):void { if(this.providers.has(kind))throw new Error("Billing provider is already registered."); this.providers.set(kind,provider); }
  public get(kind:BillingProviderKind):BillingProvider|null{return this.providers.get(kind)??null;}
  public require(kind:BillingProviderKind):BillingProvider { const provider=this.get(kind);if(!provider)throw new Error("Billing provider is unavailable.");return provider; }
  public has(kind:BillingProviderKind):boolean{return this.providers.has(kind);}
  public get size():number{return this.providers.size;}
}
